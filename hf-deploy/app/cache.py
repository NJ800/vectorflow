import json
import redis

_client = None

def get_redis():
    global _client
    if _client is None:
        _client = redis.Redis(host="localhost", port=6379, decode_responses=True)
    return _client

def cache_key(user_id, top_k):
    return f"rec:{user_id}:{top_k}"

def get_cached_recommendations(user_id, top_k):
    r = get_redis()
    raw = r.get(cache_key(user_id, top_k))
    return json.loads(raw) if raw else None

def set_cached_recommendations(user_id, top_k, results, ttl_seconds=300):
    r = get_redis()
    r.set(cache_key(user_id, top_k), json.dumps(results), ex=ttl_seconds)

def invalidate_user_cache(user_id):
    # Called whenever a user's embedding changes (Phase 4's Kafka consumer) --
    # without this, a user could apply to a job and still see stale
    # recommendations until the TTL expires, which would hide Phase 4's
    # real-time personalization behind a cache.
    r = get_redis()
    for key in r.scan_iter(match=f"rec:{user_id}:*"):
        r.delete(key)