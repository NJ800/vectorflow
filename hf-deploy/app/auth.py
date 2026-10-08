"""
Accounts, password hashing, and JWT sessions -- Part 3.

Deliberately minimal: bcrypt for hashing (used directly, not through
passlib, which has a known compatibility break with bcrypt>=4.1), and a
single HS256-signed JWT as the session token. No refresh tokens, no
revocation list -- a lost/stolen token is valid until it expires. That is a
real tradeoff, not an oversight: fine for a portfolio project, not something
you'd ship to production as-is.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from db import get_engine
from embed_utils import embed_text, vector_to_pg_literal
from generate_users import generate_profile_text, infer_domain

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is not set -- check .env (see .env.example)")

JWT_ALGORITHM = "HS256"
TOKEN_TTL_SECONDS = 7 * 24 * 3600  # 7 days: convenient for repeated manual testing

Role = Literal["job_seeker", "recruiter", "admin"]

router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


# ---------- password hashing ----------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed hash in the DB -- treat as "does not match" rather than 500.
        return False


# ---------- JWT ----------

def create_token(account_id: int, role: str, linked_user_id: Optional[int]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(account_id),
        "role": role,
        "linked_user_id": linked_user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=TOKEN_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token")


# ---------- request/response models ----------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: Role
    linked_user_id: Optional[int] = None


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: Literal["job_seeker", "recruiter"]
    # job_seeker only -- required when role="job_seeker", ignored otherwise.
    current_title: Optional[str] = None
    location: Optional[str] = None
    total_experience_years: Optional[float] = None
    skills: Optional[List[str]] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SessionResponse(BaseModel):
    access_token: str
    role: Role
    account_id: int
    linked_user_id: Optional[int] = None


class AccountOut(BaseModel):
    account_id: int
    email: str
    role: Role
    linked_user_id: Optional[int] = None
    created_at: str


# ---------- current-account dependency ----------

class CurrentAccount(BaseModel):
    account_id: int
    role: Role
    linked_user_id: Optional[int] = None
    email: str


def get_current_account(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> CurrentAccount:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    payload = _decode_token(credentials.credentials)

    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT account_id, email, role, linked_user_id FROM accounts WHERE account_id = :id"),
            {"id": int(payload["sub"])},
        ).fetchone()
    if not row:
        # Token is validly signed but the account behind it is gone.
        raise HTTPException(status_code=401, detail="Account no longer exists")

    return CurrentAccount(
        account_id=row.account_id, role=row.role, linked_user_id=row.linked_user_id, email=row.email
    )


def require_roles(*roles: Role):
    """FastAPI dependency factory: 403s unless the caller's role is in `roles`."""

    def checker(account: CurrentAccount = Depends(get_current_account)) -> CurrentAccount:
        if account.role not in roles:
            raise HTTPException(status_code=403, detail=f"This action requires role: {' or '.join(roles)}")
        return account

    return checker


# ---------- endpoints ----------

@router.post("/register", response_model=SessionResponse, status_code=201)
def register(req: RegisterRequest):
    engine = get_engine()

    if req.role == "job_seeker" and req.linked_user_id is None:
        raise HTTPException(status_code=400, detail="job_seeker accounts require linked_user_id")
    if req.role != "job_seeker" and req.linked_user_id is not None:
        raise HTTPException(status_code=400, detail="linked_user_id is only valid for the job_seeker role")

    with engine.begin() as conn:
        if req.linked_user_id is not None:
            exists = conn.execute(
                text("SELECT 1 FROM users WHERE user_id = :id"), {"id": req.linked_user_id}
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail=f"No user found with user_id={req.linked_user_id}")

        if conn.execute(text("SELECT 1 FROM accounts WHERE email = :email"), {"email": req.email}).fetchone():
            raise HTTPException(status_code=409, detail="An account with this email already exists")

        try:
            row = conn.execute(
                text("""
                    INSERT INTO accounts (email, password_hash, role, linked_user_id)
                    VALUES (:email, :password_hash, :role, :linked_user_id)
                    RETURNING account_id
                """),
                {
                    "email": req.email,
                    "password_hash": hash_password(req.password),
                    "role": req.role,
                    "linked_user_id": req.linked_user_id,
                },
            ).fetchone()
        except IntegrityError:
            # Race with another registration for the same linked_user_id
            # (the partial unique index catches this even though we already
            # checked -- TOCTOU between the SELECT above and this INSERT).
            raise HTTPException(status_code=409, detail="That user_id is already linked to another account")

    account_id = row.account_id
    token = create_token(account_id, req.role, req.linked_user_id)
    return SessionResponse(access_token=token, role=req.role, account_id=account_id, linked_user_id=req.linked_user_id)


@router.post("/signup", response_model=SessionResponse, status_code=201)
def signup(req: SignupRequest):
    """
    Self-serve signup. Unlike /register (which only ever links an account to
    a user_id that already exists), a job_seeker signup here creates a real,
    brand-new row in `users` -- built the same way
    scripts/generate_users.py builds the 500 seeded profiles -- and computes
    a real Gemini embedding for it synchronously, before the request
    returns. That's deliberate: a new job seeker's dashboard calls
    GET /recommendations/{their_id} the moment they land on it, and pgvector
    retrieval has nothing to retrieve against without a row in
    user_embeddings. Doing this async (a queue, a background job) would
    leave a real gap where a fresh signup sees an empty recommendation list
    until some later batch step runs -- worse than a slower signup request.
    """
    engine = get_engine()

    if req.role == "job_seeker":
        missing = [
            name
            for name, value in [
                ("current_title", req.current_title),
                ("location", req.location),
                ("total_experience_years", req.total_experience_years),
                ("skills", req.skills),
            ]
            if value is None
        ]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"job_seeker signup requires: {', '.join(missing)}",
            )
        if not req.skills:
            raise HTTPException(status_code=400, detail="skills must be a non-empty list")

    # Checked up front, before the (real, rate-limited) embedding call below --
    # no point spending an API call on a signup that's going to 409 anyway.
    with engine.connect() as conn:
        if conn.execute(text("SELECT 1 FROM accounts WHERE email = :email"), {"email": req.email}).fetchone():
            raise HTTPException(status_code=409, detail="An account with this email already exists")

    password_hash = hash_password(req.password)

    if req.role == "recruiter":
        with engine.begin() as conn:
            try:
                row = conn.execute(
                    text("""
                        INSERT INTO accounts (email, password_hash, role, linked_user_id)
                        VALUES (:email, :password_hash, 'recruiter', NULL)
                        RETURNING account_id
                    """),
                    {"email": req.email, "password_hash": password_hash},
                ).fetchone()
            except IntegrityError:
                raise HTTPException(status_code=409, detail="An account with this email already exists")
        token = create_token(row.account_id, "recruiter", None)
        return SessionResponse(access_token=token, role="recruiter", account_id=row.account_id, linked_user_id=None)

    # role == "job_seeker": build the same profile_text shape the seeded
    # users use, so this new profile embeds into the same space as
    # everything pgvector retrieval already knows about.
    domain = infer_domain(req.current_title)
    profile_text = generate_profile_text(req.current_title, req.total_experience_years, req.skills, domain)
    embedding = embed_text(profile_text, task_type="RETRIEVAL_QUERY")

    with engine.begin() as conn:
        new_user_id = conn.execute(text("SELECT nextval('users_new_id_seq')")).scalar()
        conn.execute(
            text("""
                INSERT INTO users (user_id, profile_text, location, current_title, total_experience_years, skills)
                VALUES (:user_id, :profile_text, :location, :current_title, :total_experience_years, :skills)
            """),
            {
                "user_id": new_user_id,
                "profile_text": profile_text,
                "location": req.location,
                "current_title": req.current_title,
                "total_experience_years": req.total_experience_years,
                "skills": req.skills,
            },
        )
        conn.execute(
            text("""
                INSERT INTO user_embeddings (user_id, embedding, updated_at)
                VALUES (:user_id, CAST(:embedding AS vector), now())
            """),
            {"user_id": new_user_id, "embedding": vector_to_pg_literal(embedding)},
        )
        try:
            row = conn.execute(
                text("""
                    INSERT INTO accounts (email, password_hash, role, linked_user_id)
                    VALUES (:email, :password_hash, 'job_seeker', :linked_user_id)
                    RETURNING account_id
                """),
                {"email": req.email, "password_hash": password_hash, "linked_user_id": new_user_id},
            ).fetchone()
        except IntegrityError:
            raise HTTPException(status_code=409, detail="An account with this email already exists")

    token = create_token(row.account_id, "job_seeker", new_user_id)
    return SessionResponse(access_token=token, role="job_seeker", account_id=row.account_id, linked_user_id=new_user_id)


@router.post("/login", response_model=SessionResponse)
def login(req: LoginRequest):
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT account_id, password_hash, role, linked_user_id FROM accounts WHERE email = :email"),
            {"email": req.email},
        ).fetchone()

    # Same error for "no such email" and "wrong password" -- don't let login
    # reveal which emails are registered.
    if not row or not verify_password(req.password, row.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = create_token(row.account_id, row.role, row.linked_user_id)
    return SessionResponse(
        access_token=token, role=row.role, account_id=row.account_id, linked_user_id=row.linked_user_id
    )


@router.get("/me", response_model=AccountOut)
def me(account: CurrentAccount = Depends(get_current_account)):
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT account_id, email, role, linked_user_id, created_at FROM accounts WHERE account_id = :id"),
            {"id": account.account_id},
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    return AccountOut(
        account_id=row.account_id,
        email=row.email,
        role=row.role,
        linked_user_id=row.linked_user_id,
        created_at=row.created_at.isoformat(),
    )
