import time
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent))
from recommend import (
    get_user, get_user_embedding, stage1_candidates,
    build_stage2_features, get_model
)
from db import get_engine
import xgboost as xgb

def profile_one(user_id):
    engine = get_engine()

    t0 = time.perf_counter()
    user = get_user(engine, user_id)
    t1 = time.perf_counter()

    user_emb = get_user_embedding(engine, user_id)
    t2 = time.perf_counter()

    candidates = stage1_candidates(engine, user_emb)
    t3 = time.perf_counter()

    df = build_stage2_features(user, candidates, engine)
    t4 = time.perf_counter()

    model, feature_cols = get_model()
    dmatrix = xgb.DMatrix(df[feature_cols])
    df["score"] = model.predict(dmatrix)
    t5 = time.perf_counter()

    print(f"get_user:              {(t1-t0)*1000:.2f}ms")
    print(f"get_user_embedding:    {(t2-t1)*1000:.2f}ms")
    print(f"stage1_candidates:     {(t3-t2)*1000:.2f}ms")
    print(f"build_stage2_features: {(t4-t3)*1000:.2f}ms")
    print(f"xgboost predict:       {(t5-t4)*1000:.2f}ms")
    print(f"TOTAL:                 {(t5-t0)*1000:.2f}ms")

if __name__ == "__main__":
    uid = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    print("--- Run 1 (cold, includes model load) ---")
    profile_one(uid)
    print("\n--- Run 2 (warm) ---")
    profile_one(uid)