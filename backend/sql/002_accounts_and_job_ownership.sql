-- VectorFlow: Phase 5 -- accounts, roles, and job ownership.
-- Additive only: no existing table is altered destructively. Runs
-- automatically on a brand-new database (mounted into
-- /docker-entrypoint-initdb.d alongside 001_schema.sql); apply manually
-- against an already-initialized database with:
--   docker exec vectorflow_postgres psql -U vectorflow -d vectorflow \
--     -f /docker-entrypoint-initdb.d/002_accounts_and_job_ownership.sql

-- =========================
-- ACCOUNTS (login identities -- separate from `users`, which are the
-- synthetic job-seeker profiles the recommendation model was trained on)
-- =========================
CREATE TABLE IF NOT EXISTS accounts (
    account_id      BIGSERIAL PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('job_seeker', 'recruiter', 'admin')),
    linked_user_id  BIGINT REFERENCES users(user_id),  -- NULL for recruiter/admin;
                                                         -- for job_seeker, points at
                                                         -- their existing row in `users`
    created_at      TIMESTAMP DEFAULT now()
);

-- A job_seeker account should map to at most one users row, and vice versa
-- (otherwise two accounts could both claim to "be" the same synthetic user).
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_linked_user
    ON accounts(linked_user_id)
    WHERE linked_user_id IS NOT NULL;

-- =========================
-- JOB OWNERSHIP (who posted a job, for recruiter CRUD + permission checks)
-- =========================
-- NULL for all 5,000 existing seed postings -- they predate accounts
-- entirely and are treated as house/legacy listings: editable and
-- deletable by admin only, never claimable by a recruiter.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_by_account_id BIGINT REFERENCES accounts(account_id);

CREATE INDEX IF NOT EXISTS idx_jobs_posted_by ON jobs(posted_by_account_id);

-- jobs.job_id is a plain BIGINT PRIMARY KEY (no IDENTITY/SERIAL) because the
-- 5,000 seed rows carry external CareerBuilder-style ids in the ~3.8-3.9
-- billion range. Recruiter-created jobs need their own id source that can
-- never collide with those -- a dedicated sequence starting well clear of
-- that range, rather than MAX(job_id)+1 (which races under concurrent
-- inserts with no locking).
CREATE SEQUENCE IF NOT EXISTS jobs_new_id_seq START WITH 9000000000;
