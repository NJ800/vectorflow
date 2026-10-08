import os
from pathlib import Path
from sqlalchemy import create_engine
from dotenv import load_dotenv

ENV_PATH = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=ENV_PATH)

_engine = None  # module-level singleton -- created once, reused by every caller

def get_engine():
    global _engine
    if _engine is not None:
        return _engine

    user = os.getenv("POSTGRES_USER")
    password = os.getenv("POSTGRES_PASSWORD")
    host = os.getenv("POSTGRES_HOST")
    port = os.getenv("POSTGRES_PORT")
    db = os.getenv("POSTGRES_DB")

    missing = [name for name, val in [
        ("POSTGRES_USER", user), ("POSTGRES_PASSWORD", password),
        ("POSTGRES_HOST", host), ("POSTGRES_PORT", port), ("POSTGRES_DB", db)
    ] if not val]

    if missing:
        raise RuntimeError(
            f"Missing env vars: {missing}. "
            f"Check that .env exists at {ENV_PATH} and is filled in correctly."
        )

    conn_str = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"
    _engine = create_engine(conn_str, pool_size=10, max_overflow=20, pool_pre_ping=True)
    return _engine