import random
import uuid
from datetime import datetime, timedelta
import pandas as pd
from db import get_engine
from sqlalchemy import text

random.seed(42)

EVENTS_PER_USER_MIN = 15
EVENTS_PER_USER_MAX = 25

CLICK_PROB = 0.45   # chance a viewed job also gets a click
APPLY_PROB = 0.30   # chance a clicked job also gets an apply
SAVE_PROB = 0.20    # chance a clicked job also gets a save

def fetch_users(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT user_id, current_title, location FROM users")).fetchall()
    return [dict(r._mapping) for r in rows]

def fetch_jobs(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT job_id, title, location FROM jobs")).fetchall()
    return [dict(r._mapping) for r in rows]

def score_job_for_user(user, job):
    # Base weight so every job has *some* chance -- mimics organic/noisy browsing,
    # not just perfect matches. Then boost heavily for title/location overlap.
    score = 1.0
    if user["current_title"] and job["title"]:
        overlap = len(set(user["current_title"].lower().split()) & set(job["title"].lower().split()))
        score += overlap * 5.0
    if user["location"] and job["location"] and user["location"] == job["location"]:
        score += 3.0
    return score

def pick_jobs_for_user(user, jobs, k):
    weights = [score_job_for_user(user, job) for job in jobs]
    chosen = random.choices(jobs, weights=weights, k=min(k, len(jobs)))
    seen, result = set(), []
    for job in chosen:
        if job["job_id"] not in seen:
            seen.add(job["job_id"])
            result.append(job)
    return result

def generate_interactions_for_user(user, jobs):
    target_events = random.randint(EVENTS_PER_USER_MIN, EVENTS_PER_USER_MAX)
    num_jobs = max(5, target_events // 2)  # funnel expands ~1.5-2x events per job
    picked_jobs = pick_jobs_for_user(user, jobs, num_jobs)

    events = []
    now = datetime.utcnow()

    for job in picked_jobs:
        session_id = str(uuid.uuid4())
        view_ts = now - timedelta(days=random.randint(0, 60), hours=random.randint(0, 23))
        events.append({"user_id": user["user_id"], "job_id": job["job_id"],
                        "event_type": "view", "session_id": session_id, "event_ts": view_ts})

        if random.random() < CLICK_PROB:
            click_ts = view_ts + timedelta(seconds=random.randint(5, 120))
            events.append({"user_id": user["user_id"], "job_id": job["job_id"],
                            "event_type": "click", "session_id": session_id, "event_ts": click_ts})

            if random.random() < APPLY_PROB:
                apply_ts = click_ts + timedelta(minutes=random.randint(1, 30))
                events.append({"user_id": user["user_id"], "job_id": job["job_id"],
                                "event_type": "apply", "session_id": session_id, "event_ts": apply_ts})

            if random.random() < SAVE_PROB:
                save_ts = click_ts + timedelta(minutes=random.randint(1, 10))
                events.append({"user_id": user["user_id"], "job_id": job["job_id"],
                                "event_type": "save", "session_id": session_id, "event_ts": save_ts})

        if len(events) >= target_events:
            break

    return events

def load_interactions():
    engine = get_engine()
    users = fetch_users(engine)
    jobs = fetch_jobs(engine)
    print(f"Generating interactions for {len(users)} users across {len(jobs)} jobs...")

    all_events = []
    for user in users:
        all_events.extend(generate_interactions_for_user(user, jobs))

    df = pd.DataFrame(all_events)
    print(f"Generated {len(df)} total interaction events.")
    print(df["event_type"].value_counts())

    with engine.begin() as conn:
        df.to_sql("interactions", conn, if_exists="append", index=False, method="multi", chunksize=1000)

    print("Inserted interactions into the database.")

if __name__ == "__main__":
    load_interactions()