import time
import random
import statistics
import requests
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = "http://127.0.0.1:8000"  # skip "localhost" resolution entirely -- avoids Windows IPv6-first DNS delay

def fetch_one(session, user_id):
    start = time.perf_counter()
    try:
        resp = session.get(f"{BASE_URL}/recommendations/{user_id}", timeout=10)
        resp.raise_for_status()
        elapsed_ms = (time.perf_counter() - start) * 1000
        return elapsed_ms, resp.json().get("source")
    except Exception as e:
        elapsed_ms = (time.perf_counter() - start) * 1000
        return elapsed_ms, f"error: {e}"

def make_session(pool_size):
    # A shared, connection-pooling session -- reuses TCP connections (keep-alive)
    # instead of paying setup/DNS cost on every single request.
    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=pool_size, pool_maxsize=pool_size)
    session.mount("http://", adapter)
    return session

def run_load_test(num_requests, concurrency, user_pool_size):
    user_ids = [random.randint(1, user_pool_size) for _ in range(num_requests)]
    session = make_session(concurrency)

    latencies = []
    sources = {"live": 0, "cache": 0, "error": 0}

    start_time = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(fetch_one, session, uid) for uid in user_ids]
        for future in as_completed(futures):
            elapsed_ms, source = future.result()
            latencies.append(elapsed_ms)
            if source == "live":
                sources["live"] += 1
            elif source == "cache":
                sources["cache"] += 1
            else:
                sources["error"] += 1
    total_time = time.perf_counter() - start_time

    latencies.sort()
    p50 = latencies[int(len(latencies) * 0.50)]
    p95 = latencies[int(len(latencies) * 0.95)]
    p99 = latencies[int(len(latencies) * 0.99)]

    print(f"\n{'='*50}")
    print(f"Load test: {num_requests} requests, concurrency={concurrency}")
    print(f"{'='*50}")
    print(f"Total time:       {total_time:.2f}s")
    print(f"Requests/sec:     {num_requests / total_time:.1f}")
    print(f"Cache hits:       {sources['cache']} | Live: {sources['live']} | Errors: {sources['error']}")
    print(f"\nLatency (ms):")
    print(f"  min:  {min(latencies):.2f}")
    print(f"  p50:  {p50:.2f}")
    print(f"  p95:  {p95:.2f}")
    print(f"  p99:  {p99:.2f}")
    print(f"  max:  {max(latencies):.2f}")
    print(f"  mean: {statistics.mean(latencies):.2f}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--requests", type=int, default=500)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--users", type=int, default=500, help="pool of user_ids to randomly sample from")
    args = parser.parse_args()

    run_load_test(args.requests, args.concurrency, args.users)