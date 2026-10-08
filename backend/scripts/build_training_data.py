import random
import pandas as pd
from db import get_engine
from sqlalchemy import text

random.seed(42)

# Graded relevance mapping from event_type -> label.
# Highest event per (user, job) pair wins if a user has multiple events on the same job
# (e.g. viewed then clicked then applied -- the apply is what matters).
EVENT_SCORES = {"view": 1, "click": 2, "save": 3, "apply": 3}

NEGATIVE_SAMPLES_PER_USER = 15  # jobs the user never interacted with, labeled 0

def fetch_interactions(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT user_id, job_id, event_type
            FROM interactions
        """)).fetchall()
    return [dict(r._mapping) for r in rows]

def fetch_all_job_ids(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT job_id FROM jobs")).fetchall()
    return [r[0] for r in rows]

def fetch_all_user_ids(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT user_id FROM users")).fetchall()
    return [r[0] for r in rows]

def build_positive_examples(interactions):
    # Collapse multiple events per (user, job) into a single max-relevance row
    best = {}
    for row in interactions:
        key = (row["user_id"], row["job_id"])
        score = EVENT_SCORES.get(row["event_type"], 0)
        if key not in best or score > best[key]:
            best[key] = score

    return [
        {"user_id": u, "job_id": j, "label": score}
        for (u, j), score in best.items()
    ]

def build_negative_examples(positive_examples, all_job_ids, all_user_ids):
    seen_pairs = {(row["user_id"], row["job_id"]) for row in positive_examples}
    user_seen_jobs = {}
    for u, j in seen_pairs:
        user_seen_jobs.setdefault(u, set()).add(j)

    negatives = []
    for user_id in all_user_ids:
        seen = user_seen_jobs.get(user_id, set())
        candidates = [j for j in all_job_ids if j not in seen]
        sampled = random.sample(candidates, k=min(NEGATIVE_SAMPLES_PER_USER, len(candidates)))
        for job_id in sampled:
            negatives.append({"user_id": user_id, "job_id": job_id, "label": 0})
    return negatives

def build_training_data():
    engine = get_engine()
    interactions = fetch_interactions(engine)
    all_job_ids = fetch_all_job_ids(engine)
    all_user_ids = fetch_all_user_ids(engine)

    positives = build_positive_examples(interactions)
    negatives = build_negative_examples(positives, all_job_ids, all_user_ids)

    print(f"Positive examples: {len(positives)}")
    print(f"Negative examples: {len(negatives)}")

    df = pd.DataFrame(positives + negatives)
    print("\nLabel distribution:")
    print(df["label"].value_counts().sort_index())

    df.to_csv("data/training_pairs.csv", index=False)
    print(f"\nSaved {len(df)} (user_id, job_id, label) rows to data/training_pairs.csv")

if __name__ == "__main__":
    build_training_data()
    