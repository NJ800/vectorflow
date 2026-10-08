import time
from db import get_engine
from embed_utils import embed_text, vector_to_pg_literal, BASE_DELAY_SECONDS
from sqlalchemy import text

def get_users_needing_embeddings(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT u.user_id, u.profile_text
            FROM users u
            LEFT JOIN user_embeddings e ON u.user_id = e.user_id
            WHERE e.user_id IS NULL
        """)).fetchall()
    return [dict(r._mapping) for r in rows]

def embed_users():
    engine = get_engine()
    users = get_users_needing_embeddings(engine)
    print(f"{len(users)} users need embedding.")

    for i, user in enumerate(users, 1):
        vector = embed_text(user["profile_text"] or "", task_type="RETRIEVAL_QUERY")

        with engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO user_embeddings (user_id, embedding, updated_at)
                    VALUES (:user_id, CAST(:embedding AS vector), now())
                    ON CONFLICT (user_id) DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = now()
                """),
                {"user_id": user["user_id"], "embedding": vector_to_pg_literal(vector)}
            )

        if i % 50 == 0 or i == len(users):
            print(f"  embedded {i}/{len(users)} users")

        time.sleep(BASE_DELAY_SECONDS)

    print("Done embedding users.")

if __name__ == "__main__":
    embed_users()