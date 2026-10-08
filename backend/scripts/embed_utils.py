import os
import time
import math
from pathlib import Path
from google import genai
from google.genai.types import EmbedContentConfig
from dotenv import load_dotenv

ENV_PATH = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=ENV_PATH)

MODEL = "gemini-embedding-001"
OUTPUT_DIM = 768
MAX_RETRIES = 5
BASE_DELAY_SECONDS = 1.0  # conservative pacing between calls; free-tier RPM isn't officially published

_client = None

def get_client():
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key or api_key == "your_key_here":
            raise RuntimeError("GEMINI_API_KEY missing or not set in .env")
        _client = genai.Client(api_key=api_key)
    return _client

def normalize(vector):
    # Required for gemini-embedding-001 when output_dimensionality < 3072 --
    # the API does NOT auto-normalize at reduced dimensions (unlike gemini-embedding-2).
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return vector
    return [v / norm for v in vector]

def embed_text(text, task_type):
    """
    task_type: 'RETRIEVAL_DOCUMENT' for jobs, 'RETRIEVAL_QUERY' for users.
    Returns a normalized 768-dim list[float]. Retries with exponential backoff on 429/5xx.
    """
    client = get_client()
    if not text or not text.strip():
        text = "(no description provided)"

    delay = BASE_DELAY_SECONDS
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.embed_content(
                model=MODEL,
                contents=text,
                config=EmbedContentConfig(
                    task_type=task_type,
                    output_dimensionality=OUTPUT_DIM,
                ),
            )
            raw_vector = response.embeddings[0].values
            return normalize(raw_vector)
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise
            wait = delay * (2 ** (attempt - 1))
            print(f"  [retry {attempt}/{MAX_RETRIES}] error: {e} -- waiting {wait:.1f}s")
            time.sleep(wait)
    raise RuntimeError("unreachable")

def vector_to_pg_literal(vector):
    # pgvector accepts this bracketed string format, cast to ::vector in SQL
    return "[" + ",".join(f"{v:.8f}" for v in vector) + "]"