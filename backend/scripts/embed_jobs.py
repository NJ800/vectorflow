import time
from db import get_engine
from embed_utils import embed_text, vector_to_pg_literal, BASE_DELAY_SECONDS
from sqlalchemy import text

def get_jobs_needing_embeddings(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT j.job_id, j.title, j.description
            FROM jobs j
            LEFT JOIN job_embeddings e ON j.job_id = e.job_id
            WHERE e.job_id IS NULL
        """)).fetchall()
    return [dict(r._mapping) for r in rows]

def embed_jobs():
    engine = get_engine()
    jobs = get_jobs_needing_embeddings(engine)
    print(f"{len(jobs)} jobs need embedding (already-embedded ones are skipped automatically).")

    for i, job in enumerate(jobs, 1):
        text_input = f"{job['title']}. {job['description'] or ''}"[:8000]  # keep well under token limits
        vector = embed_text(text_input, task_type="RETRIEVAL_DOCUMENT")

        with engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO job_embeddings (job_id, embedding, updated_at)
                    VALUES (:job_id, CAST(:embedding AS vector), now())
                    ON CONFLICT (job_id) DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = now()
                """),
                {"job_id": job["job_id"], "embedding": vector_to_pg_literal(vector)}
            )

        if i % 50 == 0 or i == len(jobs):
            print(f"  embedded {i}/{len(jobs)} jobs")

        time.sleep(BASE_DELAY_SECONDS)

    print("Done embedding jobs.")

if __name__ == "__main__":
    embed_jobs()