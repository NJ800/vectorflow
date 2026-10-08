"""
Seeds test accounts for Part 3 (auth & roles): one admin, a handful of
recruiters, and job_seeker logins for the first 20 synthetic users.

Requires sql/002_accounts_and_job_ownership.sql to already be applied.
Safe to re-run -- existing emails are left untouched, not duplicated.

    python scripts/seed_accounts.py
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent))
sys.path.append(str(Path(__file__).parent.parent / "app"))

from sqlalchemy import text

from db import get_engine
from auth import hash_password

ADMIN_EMAIL = "admin@vectorflow.dev"
ADMIN_PASSWORD = "AdminPass123!"

RECRUITER_PASSWORD = "RecruiterPass123!"  # same for every seeded recruiter
# (email, made-up company name -- the accounts table has no company column,
# so this is only used for the printed instructions below: type this name
# into the "company" field when this recruiter posts a job.)
RECRUITER_COMPANIES = [
    ("recruiter1@vectorflow.dev", "Northwind Talent Partners"),
    ("recruiter2@vectorflow.dev", "Beacon Hill Staffing Group"),
    ("recruiter3@vectorflow.dev", "Fulcrum Recruiting Co."),
    ("recruiter4@vectorflow.dev", "Alder & Vine Executive Search"),
]

JOB_SEEKER_PASSWORD = "JobSeekerPass123!"  # same for every seeded job seeker
JOB_SEEKER_USER_ID_RANGE = range(1, 21)  # user1..user20@vectorflow.dev


def upsert_account(conn, email, password, role, linked_user_id=None):
    existing = conn.execute(
        text("SELECT account_id FROM accounts WHERE email = :email"), {"email": email}
    ).fetchone()
    if existing:
        return existing.account_id, False

    row = conn.execute(
        text("""
            INSERT INTO accounts (email, password_hash, role, linked_user_id)
            VALUES (:email, :password_hash, :role, :linked_user_id)
            RETURNING account_id
        """),
        {
            "email": email,
            "password_hash": hash_password(password),
            "role": role,
            "linked_user_id": linked_user_id,
        },
    ).fetchone()
    return row.account_id, True


def main():
    engine = get_engine()
    rows = []  # (label, email, password, account_id, was_created)

    with engine.begin() as conn:
        account_id, created = upsert_account(conn, ADMIN_EMAIL, ADMIN_PASSWORD, "admin")
        rows.append(("admin", ADMIN_EMAIL, ADMIN_PASSWORD, account_id, created))

        for email, company in RECRUITER_COMPANIES:
            account_id, created = upsert_account(conn, email, RECRUITER_PASSWORD, "recruiter")
            rows.append((f"recruiter · {company}", email, RECRUITER_PASSWORD, account_id, created))

        skipped_missing_user = []
        for user_id in JOB_SEEKER_USER_ID_RANGE:
            if not conn.execute(text("SELECT 1 FROM users WHERE user_id = :id"), {"id": user_id}).fetchone():
                skipped_missing_user.append(user_id)
                continue
            email = f"user{user_id}@vectorflow.dev"
            account_id, created = upsert_account(
                conn, email, JOB_SEEKER_PASSWORD, "job_seeker", linked_user_id=user_id
            )
            rows.append((f"job_seeker · users.user_id={user_id}", email, JOB_SEEKER_PASSWORD, account_id, created))

    label_w = max(len(r[0]) for r in rows) + 2
    email_w = max(len(r[1]) for r in rows) + 2

    print("=" * 90)
    print("VectorFlow seeded accounts")
    print("=" * 90)
    for label, email, password, account_id, created in rows:
        status = "created" if created else "already existed"
        print(f"{label:<{label_w}}{email:<{email_w}}pw={password:<20}account_id={account_id:<5}[{status}]")
    print("=" * 90)
    print(f"Admin login:       {ADMIN_EMAIL}  /  {ADMIN_PASSWORD}")
    print(f"Recruiter login:   any recruiterN@vectorflow.dev above  /  {RECRUITER_PASSWORD}")
    print(f"Job seeker login:  userN@vectorflow.dev (N = 1..20)  /  {JOB_SEEKER_PASSWORD}")
    if skipped_missing_user:
        print(f"Note: skipped user_id(s) not present in `users`: {skipped_missing_user}")
    print("=" * 90)


if __name__ == "__main__":
    main()
