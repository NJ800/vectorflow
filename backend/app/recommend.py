import sys
import pickle
import numpy as np
import pandas as pd
import xgboost as xgb
from pathlib import Path
from datetime import datetime
from sqlalchemy import text

sys.path.append(str(Path(__file__).parent.parent / "scripts"))
from db import get_engine
from embed_utils import vector_to_pg_literal

MODEL_PATH = Path(__file__).parent.parent / "data" / "xgboost_ranker.json"
FEATURE_COLS_PATH = Path(__file__).parent.parent / "data" / "feature_cols.pkl"

STAGE1_CANDIDATE_COUNT = 50  # how many jobs pgvector retrieves before XGBoost re-ranks
TOP_K_RESULTS = 10

_model = None
_feature_cols = None

def get_model():
    global _model, _feature_cols
    if _model is None:
        _model = xgb.Booster()
        _model.load_model(str(MODEL_PATH))
        with open(FEATURE_COLS_PATH, "rb") as f:
            _feature_cols = pickle.load(f)
    return _model, _feature_cols

def get_user(engine, user_id):
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT user_id, current_title, location, total_experience_years, skills
            FROM users WHERE user_id = :user_id
        """), {"user_id": user_id}).fetchone()
    return dict(row._mapping) if row else None

def get_user_embedding(engine, user_id):
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT embedding FROM user_embeddings WHERE user_id = :user_id
        """), {"user_id": user_id}).fetchone()
    if not row:
        return None
    vec = row[0]
    if isinstance(vec, str):
        vec = [float(x) for x in vec.strip("[]").split(",")]
    return np.array(vec)

def stage1_candidates(engine, user_embedding, k=STAGE1_CANDIDATE_COUNT):
    # Passing the user's embedding as a bound literal (not via a JOIN) is what
    # lets Postgres use the IVFFlat index -- the index can only accelerate
    # "ORDER BY embedding <=> [a fixed vector]", not a per-row joined value
    # whose value isn't known until execution time.
    embedding_literal = vector_to_pg_literal(user_embedding.tolist())
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT j.job_id, j.title, j.company, j.location, j.description, j.posted_at,
                   1 - (je.embedding <=> CAST(:emb AS vector)) AS similarity
            FROM job_embeddings je
            JOIN jobs j ON j.job_id = je.job_id
            ORDER BY je.embedding <=> CAST(:emb AS vector)
            LIMIT :k
        """), {"emb": embedding_literal, "k": k}).fetchall()
    return [dict(r._mapping) for r in rows]

def get_job_event_counts(engine, job_ids, user_id):
    with engine.connect() as conn:
        totals = conn.execute(text("""
            SELECT job_id, COUNT(*) AS total FROM interactions
            WHERE job_id = ANY(:job_ids) GROUP BY job_id
        """), {"job_ids": job_ids}).fetchall()
        own = conn.execute(text("""
            SELECT job_id, COUNT(*) AS cnt FROM interactions
            WHERE user_id = :user_id AND job_id = ANY(:job_ids) GROUP BY job_id
        """), {"user_id": user_id, "job_ids": job_ids}).fetchall()
    totals_dict = {r.job_id: r.total for r in totals}
    own_dict = {r.job_id: r.cnt for r in own}
    return totals_dict, own_dict

def get_user_activity(engine, user_id):
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT COUNT(*) AS activity FROM interactions WHERE user_id = :user_id
        """), {"user_id": user_id}).fetchone()
    return row.activity if row else 0

def word_overlap(a, b):
    if not a or not b:
        return 0
    return len(set(str(a).lower().split()) & set(str(b).lower().split()))

def skill_overlap(skills, text_blob):
    if not skills or not text_blob:
        return 0
    text_lower = str(text_blob).lower()
    return sum(1 for s in skills if s.lower() in text_lower)

def build_stage2_features(user, candidates, engine):
    job_ids = [c["job_id"] for c in candidates]
    job_totals, own_counts = get_job_event_counts(engine, job_ids, user["user_id"])
    user_activity = get_user_activity(engine, user["user_id"])
    now = datetime.utcnow()
    user_skills = user["skills"] if isinstance(user["skills"], list) else []

    rows = []
    for c in candidates:
        posted_at = c["posted_at"]
        days_since_posted = (now - posted_at).days if posted_at else 999
        same_location = int(user["location"] == c["location"]) if c["location"] else 0
        job_text_blob = f"{c['title']} {c['description'] or ''}"
        job_popularity = job_totals.get(c["job_id"], 0) - own_counts.get(c["job_id"], 0)

        rows.append({
            "job_id": c["job_id"],
            "title": c["title"],
            "company": c["company"],
            "location": c["location"],
            "cosine_similarity": c["similarity"],
            "same_location": same_location,
            "title_overlap": word_overlap(user["current_title"], c["title"]),
            "skill_overlap": skill_overlap(user_skills, job_text_blob),
            "experience_years": user["total_experience_years"],
            "days_since_posted": days_since_posted,
            "job_popularity": job_popularity,
            "user_activity_level": user_activity,
        })
    return pd.DataFrame(rows)

def recommend(user_id, top_k=TOP_K_RESULTS):
    engine = get_engine()

    user = get_user(engine, user_id)
    if not user:
        return None

    user_emb = get_user_embedding(engine, user_id)
    if user_emb is None:
        return None

    candidates = stage1_candidates(engine, user_emb)
    if not candidates:
        return []

    df = build_stage2_features(user, candidates, engine)

    model, feature_cols = get_model()
    dmatrix = xgb.DMatrix(df[feature_cols])
    df["score"] = model.predict(dmatrix)

    df = df.sort_values("score", ascending=False).head(top_k)

    return df[["job_id", "title", "company", "location", "score", "cosine_similarity"]].to_dict("records")

if __name__ == "__main__":
    import sys as _sys
    uid = int(_sys.argv[1]) if len(_sys.argv) > 1 else 1
    results = recommend(uid)
    for i, r in enumerate(results, 1):
        print(f"{i}. [{r['score']:.4f}] {r['title']} @ {r['company']} ({r['location']})")