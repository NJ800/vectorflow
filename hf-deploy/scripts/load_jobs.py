import pandas as pd
from pathlib import Path
from db import get_engine

SAMPLE_SIZE = 5000

# Resolve path relative to this script's location, not the current working directory
DATA_PATH = Path(__file__).parent.parent / "data" / "postings.csv"

def load_jobs():
    print(f"Reading {DATA_PATH} ...")
    df = pd.read_csv(DATA_PATH)
    print(f"Full dataset has {len(df)} rows.")

    df = df.dropna(subset=["title", "description"])
    df = df.sample(n=min(SAMPLE_SIZE, len(df)), random_state=42)

    jobs = pd.DataFrame({
        "job_id": df["job_id"],
        "title": df["title"],
        "description": df["description"],
        "company": df["company_name"].fillna("Unknown"),
        "location": df["location"],
        "seniority_level": df["formatted_experience_level"],
        "salary_min": df["min_salary"],
        "salary_max": df["max_salary"],
        "posted_at": pd.to_datetime(df["listed_time"], unit="ms", errors="coerce"),
    })

    engine = get_engine()
    jobs.to_sql("jobs", engine, if_exists="append", index=False, method="multi", chunksize=500)
    print(f"Inserted {len(jobs)} jobs into the database.")

if __name__ == "__main__":
    load_jobs()