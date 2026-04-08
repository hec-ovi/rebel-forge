"""
Embedding provider using BAAI/bge-m3 via sentence-transformers.
Loads the model on first use, reuses for subsequent calls.
"""
import logging
from functools import lru_cache

logger = logging.getLogger("rebel_forge_backend.embeddings")

MODEL_NAME = "BAAI/bge-m3"
EMBEDDING_DIM = 1024  # bge-m3 output dimension


@lru_cache(maxsize=1)
def _get_model():
    """Load the embedding model once and cache it."""
    from sentence_transformers import SentenceTransformer
    logger.info("[embeddings] Loading %s...", MODEL_NAME)
    model = SentenceTransformer(MODEL_NAME)
    logger.info("[embeddings] Model loaded")
    return model


def embed_text(text: str) -> list[float]:
    """Embed a single text string. Returns a list of floats."""
    model = _get_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed multiple texts. Returns a list of embedding vectors."""
    model = _get_model()
    embeddings = model.encode(texts, normalize_embeddings=True)
    return [e.tolist() for e in embeddings]
