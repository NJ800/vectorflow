-- VectorFlow: Phase 1 schema
-- This file auto-runs when the postgres container is first created
-- (mounted into /docker-entrypoint-initdb.d)

CREATE EXTENSION IF NOT EXISTS vector;

-- =========================
-- USERS
-- =========================
CREATE TABLE IF NOT EXISTS users (
    user_id                 BIGINT PRIMARY KEY,       -- from CareerBuilder dataset's UserID
    profile_text            TEXT,                     -- concatenated resume/summary text -> gets embedded
    location                TEXT,
    current_title           TEXT,
    total_experience_years  FLOAT,
    skills                  TEXT[],                    -- simple array for now
    created_at              TIMESTAMP DEFAULT now()
);

-- =========================
-- JOBS
-- =========================
CREATE TABLE IF NOT EXISTS jobs (
    job_id            BIGINT PRIMARY KEY,             -- from CareerBuilder dataset's JobID
    title             TEXT NOT NULL,
    description       TEXT,                            -- gets embedded
    company           TEXT,
    location          TEXT,
    required_skills   TEXT[],
    seniority_level   TEXT,
    salary_min        FLOAT,
    salary_max        FLOAT,
    posted_at         TIMESTAMP
);

-- =========================
-- INTERACTIONS  (heart of the system: training data + Kafka event schema)
-- =========================
CREATE TABLE IF NOT EXISTS interactions (
    interaction_id   BIGSERIAL PRIMARY KEY,
    user_id           BIGINT REFERENCES users(user_id),
    job_id            BIGINT REFERENCES jobs(job_id),
    event_type        TEXT NOT NULL CHECK (event_type IN ('view', 'click', 'apply', 'save')),
    session_id        TEXT,
    event_ts          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_interactions_job ON interactions(job_id);
CREATE INDEX IF NOT EXISTS idx_interactions_ts ON interactions(event_ts);

-- =========================
-- JOB EMBEDDINGS (pgvector) -- populated in a later step via Gemini API
-- =========================
CREATE TABLE IF NOT EXISTS job_embeddings (
    job_id      BIGINT PRIMARY KEY REFERENCES jobs(job_id),
    embedding   VECTOR(768),               -- text-embedding-004 output size
    updated_at  TIMESTAMP DEFAULT now()
);

-- =========================
-- USER EMBEDDINGS (pgvector) -- incrementally updated later via Kafka consumer
-- =========================
CREATE TABLE IF NOT EXISTS user_embeddings (
    user_id     BIGINT PRIMARY KEY REFERENCES users(user_id),
    embedding   VECTOR(768),
    updated_at  TIMESTAMP DEFAULT now()
);

-- Approximate nearest-neighbor index (IVFFlat) -- created AFTER data is loaded,
-- since IVFFlat needs sample data to build good clusters. Placeholder note only.
-- Run this later, once job_embeddings has rows:
-- CREATE INDEX job_embeddings_ivfflat_idx ON job_embeddings
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);