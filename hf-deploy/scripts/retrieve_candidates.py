import sys
from db import get_engine
from sqlalchemy import text

TOP_K = 10

def get_candidates(engine, user_id, k=TOP_K):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT j.job_id, j.title, j.company, j.location,
                   1 - (je.embedding <=> ue.embedding) AS similarity
            FROM user_embeddings ue
            JOIN job_embeddings je ON true
            JOIN jobs j ON j.job_id = je.job_id
            WHERE ue.user_id = :user_id
            ORDER BY je.embedding <=> ue.embedding
            LIMIT :k
        """), {"user_id": user_id, "k": k}).fetchall()
    return [dict(r._mapping) for r in rows]

def get_user_profile(engine, user_id):
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT user_id, current_title, location, profile_text
            FROM users WHERE user_id = :user_id
        """), {"user_id": user_id}).fetchone()
    return dict(row._mapping) if row else None

if __name__ == "__main__":
    user_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    engine = get_engine()

    user = get_user_profile(engine, user_id)
    if not user:
        print(f"No user found with user_id={user_id}")
        sys.exit(1)

    print(f"\nUser #{user['user_id']}: {user['current_title']} ({user['location']})")
    print(f"Profile: {user['profile_text']}\n")
    print(f"Top {TOP_K} candidate jobs:\n")

    candidates = get_candidates(engine, user_id)
    for i, c in enumerate(candidates, 1):
        print(f"{i}. [{c['similarity']:.4f}] {c['title']} @ {c['company']} ({c['location']})")