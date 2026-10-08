import sys
import time
from pathlib import Path

import numpy as np
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from db import get_engine
from kafka_utils import get_consumer
from embed_utils import vector_to_pg_literal

sys.path.append(str(Path(__file__).parent.parent / "app"))
from cache import invalidate_user_cache

# Event strength -> how much this event nudges the user's embedding.
# Kept deliberately gentle: a single apply should reinforce a profile,
# not overwrite most of it. apply/save = strongest, click = medium, view = weakest.
ALPHA_BY_EVENT = {"view": 0.01, "click": 0.03, "apply": 0.08, "save": 0.08}

def get_job_embedding(engine, job_id):
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT embedding FROM job_embeddings WHERE job_id = :job_id"),
            {"job_id": job_id}
        ).fetchone()
    if not row:
        return None
    vec = row[0]
    if isinstance(vec, str):
        vec = [float(x) for x in vec.strip("[]").split(",")]
    return np.array(vec)

def get_user_embedding(engine, user_id):
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT embedding FROM user_embeddings WHERE user_id = :user_id"),
            {"user_id": user_id}
        ).fetchone()
    if not row:
        return None
    vec = row[0]
    if isinstance(vec, str):
        vec = [float(x) for x in vec.strip("[]").split(",")]
    return np.array(vec)

def update_user_embedding(engine, user_id, job_embedding, alpha):
    old_embedding = get_user_embedding(engine, user_id)
    if old_embedding is None:
        return  # shouldn't happen for our seeded users, but guard anyway

    # Exponential moving average: blend old profile toward the new job's embedding,
    # strength controlled by alpha (stronger for apply/save, weaker for view).
    new_embedding = (1 - alpha) * old_embedding + alpha * job_embedding

    # Re-normalize to unit length -- required since we're using cosine similarity
    # throughout, and a blended vector won't automatically stay normalized.
    norm = np.linalg.norm(new_embedding)
    if norm > 0:
        new_embedding = new_embedding / norm

    with engine.begin() as conn:
        conn.execute(
            text("""
                UPDATE user_embeddings
                SET embedding = CAST(:embedding AS vector), updated_at = now()
                WHERE user_id = :user_id
            """),
            {"user_id": user_id, "embedding": vector_to_pg_literal(new_embedding.tolist())}
        )

    invalidate_user_cache(user_id)

def insert_interaction(engine, event):
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO interactions (user_id, job_id, event_type, session_id, event_ts)
                VALUES (:user_id, :job_id, :event_type, :session_id, :event_ts)
            """),
            event
        )

def process_event(engine, event):
    insert_interaction(engine, event)

    job_embedding = get_job_embedding(engine, event["job_id"])
    if job_embedding is None:
        print(f"  [skip] no embedding found for job_id={event['job_id']}", flush=True)
        return

    alpha = ALPHA_BY_EVENT.get(event["event_type"], 0.01)
    update_user_embedding(engine, event["user_id"], job_embedding, alpha)

    print(f"  processed: user={event['user_id']} job={event['job_id']} "
          f"event={event['event_type']} (alpha={alpha}) -> profile updated", flush=True)

def run_consumer():
    engine = get_engine()
    consumer = get_consumer()

    print("Listening for events on 'interaction-events'... (Ctrl+C to stop)", flush=True)
    for message in consumer:
        event = message.value
        try:
            process_event(engine, event)
        except IntegrityError as e:
            # user_id or job_id doesn't exist (e.g. a job was deleted by its
            # recruiter after the event was published, or a bad id was sent
            # directly to the API). This data will never become valid, so
            # retrying it forever on restart would just wedge the consumer
            # on a poison message -- log it loudly and move past it.
            print(f"  [dropped] invalid reference in event {event}: {e.orig}", flush=True)
            consumer.commit()
        except Exception as e:
            # Anything else (DB hiccup, etc.) is treated as possibly
            # transient: the offset is NOT committed, so restarting the
            # consumer re-delivers this message instead of losing it
            # silently. Within this same run we still move on to the next
            # message rather than blocking the whole topic.
            print(f"  [error] failed to process event {event}: {e} "
                  f"(offset not committed -- will retry on consumer restart)", flush=True)
        else:
            consumer.commit()

if __name__ == "__main__":
    run_consumer()