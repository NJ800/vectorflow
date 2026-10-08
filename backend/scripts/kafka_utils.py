import json
from kafka import KafkaProducer, KafkaConsumer

BOOTSTRAP_SERVERS = ["localhost:9092"]
TOPIC = "interaction-events"

def get_producer():
    return KafkaProducer(
        bootstrap_servers=BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )

def get_consumer(group_id="profile-updater"):
    return KafkaConsumer(
        TOPIC,
        bootstrap_servers=BOOTSTRAP_SERVERS,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        group_id=group_id,
        auto_offset_reset="earliest",
        # Manual commit: the offset only advances once process_event() has
        # actually succeeded (see consume_events.py). With auto-commit, a
        # message that threw partway through processing (e.g. a bad
        # user_id/job_id) still got its offset advanced on the next
        # auto-commit tick -- the event was permanently dropped with no
        # trace beyond a terminal log line nobody was watching, while the
        # API had already told the caller "published". That is the exact
        # "button says success, nothing actually happened" failure mode.
        enable_auto_commit=False,
    )