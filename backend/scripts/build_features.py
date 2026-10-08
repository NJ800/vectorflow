import numpy as np
import pandas as pd
from datetime import datetime
from db import get_engine
from sqlalchemy import text

def load_users(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT user_id, current_title, location, total_experience_years, skills
            FROM users
        """)).fetchall()
    return pd.DataFrame([dict(r._mapping) for r in rows])

def load_jobs(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT job_id, title, description, location, posted_at
            FROM jobs
        """)).fetchall()
    return pd.DataFrame([dict(r._mapping) for r in rows])

def load_embeddings(engine, table, id_col):
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT {id_col}, embedding FROM {table}")).fetchall()
    data = {}
    for r in rows:
        row = dict(r._mapping)
        vec = row["embedding"]
        if isinstance(vec, str):
            vec = np.array([float(x) for x in vec.strip("[]").split(",")])
        else:
            vec = np.array(vec)
        data[row[id_col]] = vec
    return data

def load_job_event_counts(engine):
    # job_totals: total interaction events for a job, across ALL users
    # user_job_dict: interaction events for a SPECIFIC (user, job) pair
    # We subtract the user's own count from the job total so a user's own
    # apply/click doesn't leak into their own row's popularity feature.
    with engine.connect() as conn:
        job_totals = conn.execute(text("""
            SELECT job_id, COUNT(*) AS total FROM interactions GROUP BY job_id
        """)).fetchall()
        user_job_counts = conn.execute(text("""
            SELECT user_id, job_id, COUNT(*) AS cnt
            FROM interactions GROUP BY user_id, job_id
        """)).fetchall()

    job_totals_dict = {r.job_id: r.total for r in job_totals}
    user_job_dict = {(r.user_id, r.job_id): r.cnt for r in user_job_counts}
    return job_totals_dict, user_job_dict

def load_user_activity(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT user_id, COUNT(*) AS activity
            FROM interactions GROUP BY user_id
        """)).fetchall()
    return {r.user_id: r.activity for r in rows}

def word_overlap(a, b):
    if not a or not b:
        return 0
    set_a = set(str(a).lower().split())
    set_b = set(str(b).lower().split())
    return len(set_a & set_b)

def skill_overlap(skills, text_blob):
    if not skills or not text_blob:
        return 0
    text_lower = str(text_blob).lower()
    return sum(1 for s in skills if s.lower() in text_lower)

def build_features():
    engine = get_engine()

    print("Loading data...")
    pairs = pd.read_csv("data/training_pairs.csv")
    users = load_users(engine).set_index("user_id")
    jobs = load_jobs(engine).set_index("job_id")
    user_emb = load_embeddings(engine, "user_embeddings", "user_id")
    job_emb = load_embeddings(engine, "job_embeddings", "job_id")
    job_totals_dict, user_job_dict = load_job_event_counts(engine)
    user_activity = load_user_activity(engine)

    print(f"Building features for {len(pairs)} pairs...")
    rows = []
    now = datetime.utcnow()

    for _, pair in pairs.iterrows():
        uid, jid, label = pair["user_id"], pair["job_id"], pair["label"]

        if uid not in users.index or jid not in jobs.index:
            continue
        if uid not in user_emb or jid not in job_emb:
            continue

        user = users.loc[uid]
        job = jobs.loc[jid]

        cosine_sim = float(np.dot(user_emb[uid], job_emb[jid]))

        same_location = int(user["location"] == job["location"]) if pd.notna(job["location"]) else 0

        posted_at = job["posted_at"]
        days_since_posted = (now - posted_at).days if pd.notna(posted_at) else 999

        user_skills = user["skills"] if isinstance(user["skills"], list) else []
        job_text_blob = f"{job['title']} {job['description'] or ''}"

        job_popularity = job_totals_dict.get(jid, 0) - user_job_dict.get((uid, jid), 0)

        rows.append({
            "user_id": uid,
            "job_id": jid,
            "cosine_similarity": cosine_sim,
            "same_location": same_location,
            "title_overlap": word_overlap(user["current_title"], job["title"]),
            "skill_overlap": skill_overlap(user_skills, job_text_blob),
            "experience_years": user["total_experience_years"],
            "days_since_posted": days_since_posted,
            "job_popularity": job_popularity,
            "user_activity_level": user_activity.get(uid, 0),
            "label": label,
        })

    df = pd.DataFrame(rows)
    df.to_csv("data/training_features.csv", index=False)
    print(f"Saved {len(df)} rows with features to data/training_features.csv")
    print("\nFeature preview:")
    print(df.head())
    print("\nFeature summary stats:")
    print(df.describe())

if __name__ == "__main__":
    build_features()