import sys
import time
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from kafka.errors import KafkaError
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

sys.path.append(str(Path(__file__).parent.parent / "scripts"))
# recommend/cache/auth all live in this same app/ folder. That's only on
# sys.path automatically when uvicorn is launched with cwd=app/ (`main:app`);
# add it explicitly too so `uvicorn app.main:app` from backend/ also works.
sys.path.append(str(Path(__file__).parent))
from db import get_engine
from kafka_utils import get_producer, TOPIC as KAFKA_TOPIC
from recommend import recommend
from cache import get_cached_recommendations, set_cached_recommendations

from auth import CurrentAccount, get_current_account, require_roles, router as auth_router

app = FastAPI(title="VectorFlow Recommendation API")

# Frontend (Next.js, likely on a different port/origin) needs CORS enabled to call this API directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your actual frontend domain once deployed
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

_producer = None
def get_cached_producer():
    global _producer
    if _producer is None:
        _producer = get_producer()
    return _producer


# ---------- existing endpoint ----------

@app.get("/recommendations/{user_id}")
def get_recommendations(user_id: int, top_k: int = 10):
    start = time.perf_counter()

    cached = get_cached_recommendations(user_id, top_k)
    if cached is not None:
        elapsed_ms = (time.perf_counter() - start) * 1000
        return {"user_id": user_id, "source": "cache", "latency_ms": round(elapsed_ms, 2), "results": cached}

    results = recommend(user_id, top_k=top_k)
    if results is None:
        raise HTTPException(status_code=404, detail=f"No user found with user_id={user_id}")

    set_cached_recommendations(user_id, top_k, results)

    elapsed_ms = (time.perf_counter() - start) * 1000
    return {"user_id": user_id, "source": "live", "latency_ms": round(elapsed_ms, 2), "results": results}


# ---------- users list, for the frontend's user switcher ----------

@app.get("/users")
def list_users(search: Optional[str] = None, limit: int = 50):
    engine = get_engine()
    query = """
        SELECT user_id, current_title, location, total_experience_years
        FROM users
    """
    params = {}
    if search:
        query += " WHERE current_title ILIKE :search OR location ILIKE :search"
        params["search"] = f"%{search}%"
    query += " ORDER BY user_id LIMIT :limit"
    params["limit"] = limit

    with engine.connect() as conn:
        rows = conn.execute(text(query), params).fetchall()
    return {"users": [dict(r._mapping) for r in rows]}


@app.get("/users/{user_id}")
def get_user_detail(user_id: int):
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT user_id, current_title, location, total_experience_years, skills, profile_text
            FROM users WHERE user_id = :user_id
        """), {"user_id": user_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"No user found with user_id={user_id}")
    return dict(row._mapping)


# ---------- jobs browser (list, search, filter, detail) ----------

JOB_LIST_COLUMNS = """
    job_id, title, company, location, seniority_level,
    salary_min, salary_max, posted_at, posted_by_account_id
"""

@app.get("/jobs")
def list_jobs(
    search: Optional[str] = None,
    location: Optional[str] = None,
    seniority: Optional[str] = None,
    posted_by: Optional[int] = Query(None, description="Filter to jobs posted by this account_id (recruiter's own listings)"),
    sort: str = Query("recent", pattern="^(recent|salary_high|salary_low)$"),
    page: int = 1,
    page_size: int = 20,
):
    engine = get_engine()
    conditions = []
    params = {}

    if search:
        conditions.append("(title ILIKE :search OR company ILIKE :search OR description ILIKE :search)")
        params["search"] = f"%{search}%"
    if location:
        conditions.append("location ILIKE :location")
        params["location"] = f"%{location}%"
    if seniority:
        conditions.append("seniority_level = :seniority")
        params["seniority"] = seniority
    if posted_by is not None:
        conditions.append("posted_by_account_id = :posted_by")
        params["posted_by"] = posted_by

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    sort_map = {
        "recent": "posted_at DESC NULLS LAST",
        "salary_high": "salary_max DESC NULLS LAST",
        "salary_low": "salary_min ASC NULLS LAST",
    }
    order_clause = sort_map[sort]

    offset = (page - 1) * page_size
    params["limit"] = page_size
    params["offset"] = offset

    with engine.connect() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM jobs {where_clause}"), params).scalar()
        rows = conn.execute(text(f"""
            SELECT {JOB_LIST_COLUMNS}
            FROM jobs {where_clause}
            ORDER BY {order_clause}
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

    return {
        "jobs": [dict(r._mapping) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.get("/jobs/{job_id}")
def get_job_detail(job_id: int):
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT job_id, title, company, location, description, seniority_level,
                   salary_min, salary_max, posted_at, posted_by_account_id
            FROM jobs WHERE job_id = :job_id
        """), {"job_id": job_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"No job found with job_id={job_id}")
    return dict(row._mapping)


# ---------- jobs CRUD (Part 3: recruiter/admin only) ----------

class JobWriteRequest(BaseModel):
    title: str
    description: Optional[str] = None
    company: str
    location: str
    seniority_level: Optional[str] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None


class JobUpdateRequest(BaseModel):
    """All fields optional: PATCH only touches what's provided."""
    title: Optional[str] = None
    description: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    seniority_level: Optional[str] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None


def _fetch_job_row(conn, job_id: int):
    row = conn.execute(text("""
        SELECT job_id, title, company, location, description, seniority_level,
               salary_min, salary_max, posted_at, posted_by_account_id
        FROM jobs WHERE job_id = :job_id
    """), {"job_id": job_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"No job found with job_id={job_id}")
    return row


def _ensure_can_modify(job_row, account: CurrentAccount):
    """Admin may touch any job. A recruiter may only touch jobs they posted
    themselves -- the 5,000 seed postings have posted_by_account_id = NULL
    and are not owned by anyone, so no recruiter can claim them."""
    if account.role == "admin":
        return
    if job_row.posted_by_account_id != account.account_id:
        raise HTTPException(
            status_code=403,
            detail="You can only edit or delete jobs you posted yourself",
        )


@app.post("/jobs", status_code=201)
def create_job(req: JobWriteRequest, account: CurrentAccount = Depends(require_roles("recruiter", "admin"))):
    engine = get_engine()
    with engine.begin() as conn:
        job_id = conn.execute(text("SELECT nextval('jobs_new_id_seq')")).scalar()
        conn.execute(text("""
            INSERT INTO jobs (job_id, title, description, company, location, seniority_level,
                               salary_min, salary_max, posted_at, posted_by_account_id)
            VALUES (:job_id, :title, :description, :company, :location, :seniority_level,
                    :salary_min, :salary_max, now(), :posted_by)
        """), {
            "job_id": job_id,
            "title": req.title,
            "description": req.description,
            "company": req.company,
            "location": req.location,
            "seniority_level": req.seniority_level,
            "salary_min": req.salary_min,
            "salary_max": req.salary_max,
            "posted_by": account.account_id,
        })
        row = _fetch_job_row(conn, job_id)
    return dict(row._mapping)


@app.patch("/jobs/{job_id}")
def update_job(job_id: int, req: JobUpdateRequest, account: CurrentAccount = Depends(require_roles("recruiter", "admin"))):
    engine = get_engine()
    with engine.begin() as conn:
        current = _fetch_job_row(conn, job_id)
        _ensure_can_modify(current, account)

        updates = req.model_dump(exclude_unset=True)
        if not updates:
            return dict(current._mapping)

        set_clause = ", ".join(f"{field} = :{field}" for field in updates)
        updates["job_id"] = job_id
        conn.execute(text(f"UPDATE jobs SET {set_clause} WHERE job_id = :job_id"), updates)

        row = _fetch_job_row(conn, job_id)
    return dict(row._mapping)


@app.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: int, account: CurrentAccount = Depends(require_roles("recruiter", "admin"))):
    engine = get_engine()
    with engine.begin() as conn:
        current = _fetch_job_row(conn, job_id)
        _ensure_can_modify(current, account)
        try:
            conn.execute(text("DELETE FROM jobs WHERE job_id = :job_id"), {"job_id": job_id})
        except IntegrityError:
            # interactions.job_id and job_embeddings.job_id both reference
            # jobs with no ON DELETE CASCADE -- on purpose: silently
            # cascading would destroy interaction history. Surface it as a
            # clean, explainable 409 instead of a raw FK-violation 500.
            raise HTTPException(
                status_code=409,
                detail=(
                    "Cannot delete this job: it already has recorded interactions "
                    "or a computed embedding referencing it."
                ),
            )
    return None


# ---------- simulate interaction (publishes to the same Kafka topic the real pipeline uses) ----------

class SimulateInteractionRequest(BaseModel):
    # Only required for a recruiter/admin acting on someone else's behalf --
    # a job_seeker's own linked_user_id is always used instead (see below),
    # so they cannot simulate as anyone else.
    user_id: Optional[int] = None
    job_id: int
    event_type: str  # "view" | "click" | "apply" | "save"


@app.post("/interactions/simulate")
def simulate_interaction(req: SimulateInteractionRequest, account: CurrentAccount = Depends(get_current_account)):
    if req.event_type not in {"view", "click", "apply", "save"}:
        raise HTTPException(status_code=400, detail="event_type must be one of: view, click, apply, save")

    if account.role == "job_seeker":
        # A job seeker can only ever act as themselves -- whatever user_id
        # the client sent (if any) is ignored, not merely validated, so a
        # stale/tampered request can't simulate as a different profile.
        if account.linked_user_id is None:
            raise HTTPException(status_code=400, detail="This account has no linked job-seeker profile")
        user_id = account.linked_user_id
    else:
        # recruiter/admin: general-purpose demo/testing action, useful for
        # QA-ing the pipeline against any profile without needing a
        # job_seeker login. Still must name a real user.
        if req.user_id is None:
            raise HTTPException(status_code=400, detail="user_id is required when simulating as recruiter/admin")
        user_id = req.user_id

    engine = get_engine()
    with engine.connect() as conn:
        user_exists = conn.execute(text("SELECT 1 FROM users WHERE user_id = :id"), {"id": user_id}).fetchone()
        job_exists = conn.execute(text("SELECT 1 FROM jobs WHERE job_id = :id"), {"id": req.job_id}).fetchone()
    # Validated up front so a stale job_id (e.g. deleted by its recruiter in
    # another tab) or a bad user_id fails loudly here, instead of publishing
    # a Kafka event that the consumer can only drop later, invisibly to the
    # caller who already saw a 200.
    if not user_exists:
        raise HTTPException(status_code=404, detail=f"No user found with user_id={user_id}")
    if not job_exists:
        raise HTTPException(status_code=404, detail=f"No job found with job_id={req.job_id}")

    event = {
        "user_id": user_id,
        "job_id": req.job_id,
        "event_type": req.event_type,
        "session_id": str(uuid.uuid4()),
        "event_ts": datetime.utcnow().isoformat(),
    }

    try:
        producer = get_cached_producer()
        producer.send(KAFKA_TOPIC, value=event)
        producer.flush(timeout=5)
    except KafkaError as e:
        raise HTTPException(status_code=503, detail=f"Could not publish to Kafka: {e}")

    return {"status": "published", "event": event}


# ---------- recent activity feed (polling-based, matches actual backend architecture) ----------

@app.get("/activity/recent")
def get_recent_activity(limit: int = 30, since_id: Optional[int] = None):
    engine = get_engine()
    params = {"limit": limit}
    where_clause = ""
    if since_id:
        where_clause = "WHERE i.interaction_id > :since_id"
        params["since_id"] = since_id

    with engine.connect() as conn:
        rows = conn.execute(text(f"""
            SELECT i.interaction_id, i.user_id, i.job_id, i.event_type, i.event_ts,
                   u.current_title AS user_title, j.title AS job_title, j.company AS job_company
            FROM interactions i
            JOIN users u ON u.user_id = i.user_id
            JOIN jobs j ON j.job_id = i.job_id
            {where_clause}
            ORDER BY i.interaction_id DESC
            LIMIT :limit
        """), params).fetchall()

    return {"events": [dict(r._mapping) for r in rows]}


# ---------- admin (Part 3) ----------

@app.get("/admin/stats")
def admin_stats(account: CurrentAccount = Depends(require_roles("admin"))):
    engine = get_engine()
    with engine.connect() as conn:
        total_users = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
        total_jobs = conn.execute(text("SELECT COUNT(*) FROM jobs")).scalar()
        total_interactions = conn.execute(text("SELECT COUNT(*) FROM interactions")).scalar()
        total_accounts = conn.execute(text("SELECT COUNT(*) FROM accounts")).scalar()
        accounts_by_role_rows = conn.execute(
            text("SELECT role, COUNT(*) AS n FROM accounts GROUP BY role")
        ).fetchall()
        jobs_per_recruiter = conn.execute(text("""
            SELECT a.account_id, a.email, COUNT(j.job_id) AS job_count
            FROM accounts a
            LEFT JOIN jobs j ON j.posted_by_account_id = a.account_id
            WHERE a.role = 'recruiter'
            GROUP BY a.account_id, a.email
            ORDER BY job_count DESC, a.email
        """)).fetchall()
        # Doubles as a pipeline-liveness signal: if this timestamp isn't
        # advancing while events are being simulated, the consumer isn't
        # running -- a real, durable check, not just a frontend toast.
        latest_interaction = conn.execute(text("SELECT MAX(event_ts) FROM interactions")).scalar()

    return {
        "total_users": total_users,
        "total_jobs": total_jobs,
        "total_interactions": total_interactions,
        "total_accounts": total_accounts,
        "accounts_by_role": {r.role: r.n for r in accounts_by_role_rows},
        "jobs_per_recruiter": [
            {"account_id": r.account_id, "email": r.email, "job_count": r.job_count}
            for r in jobs_per_recruiter
        ],
        "latest_interaction_at": latest_interaction.isoformat() if latest_interaction else None,
    }


@app.get("/admin/accounts")
def admin_accounts(account: CurrentAccount = Depends(require_roles("admin"))):
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT account_id, email, role, linked_user_id, created_at
            FROM accounts ORDER BY account_id
        """)).fetchall()
    return {
        "accounts": [
            {
                "account_id": r.account_id,
                "email": r.email,
                "role": r.role,
                "linked_user_id": r.linked_user_id,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


@app.get("/health")
def health():
    return {"status": "ok"}
