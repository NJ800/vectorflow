import random
import time
import uuid
import argparse
from datetime import datetime
from db import get_engine
from kafka_utils import get_producer
from sqlalchemy import text

random.seed()  # not fixed here -- we WANT variety across live-simulation runs

def fetch_users(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT user_id, current_title, location FROM users")).fetchall()
    return [dict(r._mapping) for r in rows]

def get_candidate_jobs_for_user(engine, user_id, top_k=30):
    # Realistic constraint: users only interact with jobs they were actually
    # shown -- i.e. Stage 1's top candidates -- never a random job from the
    # entire 5,000-job catalog.
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT j.job_id, j.title, j.location
            FROM user_embeddings ue
            JOIN job_embeddings je ON true
            JOIN jobs j ON j.job_id = je.job_id
            WHERE ue.user_id = :user_id
            ORDER BY je.embedding <=> ue.embedding
            LIMIT :k
        """), {"user_id": user_id, "k": top_k}).fetchall()
    return [dict(r._mapping) for r in rows]

def score_job_for_user(user, job):
    score = 1.0
    if user["current_title"] and job["title"]:
        overlap = len(set(user["current_title"].lower().split()) & set(job["title"].lower().split()))
        score += overlap * 5.0
    if user["location"] and job["location"] and user["location"] == job["location"]:
        score += 3.0
    return score

def pick_job_for_user(user, jobs):
    weights = [score_job_for_user(user, job) for job in jobs]
    return random.choices(jobs, weights=weights, k=1)[0]

def simulate_stream(num_events, delay_seconds, target_user_id=None, target_event_type=None):
    engine = get_engine()
    producer = get_producer()

    users = fetch_users(engine)
    if target_user_id:
        users = [u for u in users if u["user_id"] == target_user_id]
        if not users:
            print(f"No user found with user_id={target_user_id}")
            return

    print(f"Publishing {num_events} events to Kafka topic 'interaction-events'...")
    for i in range(num_events):
        user = random.choice(users)
        candidates = get_candidate_jobs_for_user(engine, user["user_id"], top_k=30)
        if not candidates:
            print(f"  [skip] no candidates found for user {user['user_id']}")
            continue

        job = pick_job_for_user(user, candidates)
        event_type = target_event_type or random.choices(
            ["view", "click", "apply", "save"], weights=[60, 27, 8, 5]
        )[0]

        event = {
            "user_id": user["user_id"],
            "job_id": job["job_id"],
            "event_type": event_type,
            "session_id": str(uuid.uuid4()),
            "event_ts": datetime.utcnow().isoformat(),
        }
        producer.send("interaction-events", value=event)
        print(f"  [{i+1}/{num_events}] user={event['user_id']} job={event['job_id']} event={event['event_type']}")
        time.sleep(delay_seconds)

    producer.flush()
    print("Done publishing.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=10, help="number of events to publish")
    parser.add_argument("--delay", type=float, default=0.5, help="seconds between events")
    parser.add_argument("--user", type=int, default=None, help="restrict to a specific user_id")
    parser.add_argument("--event", type=str, default=None, choices=["view", "click", "apply", "save"])
    args = parser.parse_args()

    simulate_stream(args.count, args.delay, target_user_id=args.user, target_event_type=args.event)