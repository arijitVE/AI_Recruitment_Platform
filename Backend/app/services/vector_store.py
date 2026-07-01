import hashlib
import logging
import math
from typing import List, Dict, Any, Optional

from openai import AsyncOpenAI
from app.config import settings

logger = logging.getLogger(__name__)

# In-memory vector store fallback for local testing without active Pinecone account
_local_vector_store: Dict[str, Dict[str, Any]] = {}

# Lazy singleton for the embedding client
_embed_client: AsyncOpenAI | None | str = "unset"  # sentinel


def _get_embed_client() -> AsyncOpenAI | None:
    key = settings.OPENAI_API_KEY
    if key and key != "test_key":
        logger.info("[VectorStore] OpenAI embedding client initialized with real API key.")
        return AsyncOpenAI(api_key=key)
    logger.warning("[VectorStore] No real OpenAI API key — using pseudo-embedding fallback.")
    return None


def get_embed_client() -> AsyncOpenAI | None:
    global _embed_client
    if _embed_client == "unset":
        _embed_client = _get_embed_client()
    return _embed_client


# Keep backward compat alias
openai_client = get_embed_client()


async def generate_embedding(text: str) -> List[float]:
    """Generate embedding vector for clean rendered profile text using OpenAI embeddings API."""
    c = get_embed_client()
    if not c:
        logger.warning("[VectorStore] generate_embedding: using deterministic pseudo-embedding.")
        # Deterministic pseudo-embedding for testing (dimension 1536)
        h = hashlib.sha256(text.encode("utf-8")).digest()
        vec = []
        for i in range(1536):
            val = ((h[i % len(h)] + i) % 256) / 255.0 - 0.5
            vec.append(val)
        # Normalize vector to unit length for cosine similarity
        norm = math.sqrt(sum(v * v for v in vec))
        return [v / norm if norm != 0 else 0.0 for v in vec]

    logger.info("[VectorStore] Calling OpenAI text-embedding-3-small.")
    try:
        response = await c.embeddings.create(
            input=text,
            model="text-embedding-3-small"
        )
        return response.data[0].embedding
    except Exception as e:
        raise RuntimeError(f"OpenAI embedding generation failed: {str(e)}")


class VectorStoreService:
    # Embedding dimension for text-embedding-3-small
    _DIMENSION = 1536

    def __init__(self):
        self.use_pinecone = bool(
            settings.PINECONE_API_KEY and settings.PINECONE_API_KEY != "test_key"
        )
        self.index = None
        if self.use_pinecone:
            self._connect()

    def _connect(self):
        """Connect to Pinecone, creating the index automatically if it does not exist."""
        try:
            from pinecone import Pinecone, ServerlessSpec
            import time

            pc = Pinecone(api_key=settings.PINECONE_API_KEY)
            index_name = settings.PINECONE_INDEX_NAME

            # List existing indexes
            existing = [idx.name for idx in pc.list_indexes()]

            if index_name not in existing:
                logger.info(
                    "[VectorStore] Index '%s' not found — creating (dim=%d, metric=cosine, serverless us-east-1).",
                    index_name, self._DIMENSION,
                )
                pc.create_index(
                    name=index_name,
                    dimension=self._DIMENSION,
                    metric="cosine",
                    spec=ServerlessSpec(cloud="aws", region=settings.PINECONE_ENVIRONMENT),
                )
                # Wait until the index is ready (poll up to 60 s)
                for _ in range(30):
                    status = pc.describe_index(index_name).status
                    if getattr(status, "ready", False):
                        break
                    logger.info("[VectorStore] Waiting for index '%s' to become ready...", index_name)
                    time.sleep(2)
                logger.info("[VectorStore] Index '%s' is ready.", index_name)
            else:
                logger.info("[VectorStore] Index '%s' already exists.", index_name)

            self.index = pc.Index(index_name)
            logger.info("[VectorStore] Connected to Pinecone index '%s'.", index_name)

        except Exception as e:
            logger.warning("[VectorStore] Pinecone init failed: %s — falling back to in-memory store.", str(e))
            self.use_pinecone = False
            self.index = None

    async def upsert_vector(self, namespace: str, vector_id: str, vector: List[float], metadata: Dict[str, Any]):
        """Upsert a candidate vector into Pinecone under the job namespace."""
        if self.use_pinecone and self.index:
            try:
                self.index.upsert(
                    vectors=[{"id": vector_id, "values": vector, "metadata": metadata}],
                    namespace=namespace
                )
                logger.info("[VectorStore] Upserted vector %s to Pinecone namespace %s.", vector_id, namespace)
                return
            except Exception as e:
                logger.warning("[VectorStore] Pinecone upsert failed: %s — falling back.", str(e))

        # Local fallback
        if namespace not in _local_vector_store:
            _local_vector_store[namespace] = {}
        _local_vector_store[namespace][vector_id] = {
            "vector": vector,
            "metadata": metadata
        }
        logger.info("[VectorStore] Stored vector %s in local in-memory store (namespace=%s).", vector_id, namespace)

    async def query_vectors(self, namespace: str, query_vector: List[float], top_k: int = 30) -> List[Dict[str, Any]]:
        """Retrieve top-K candidate vectors from Pinecone namespace by cosine similarity."""
        if self.use_pinecone and self.index:
            try:
                res = self.index.query(
                    namespace=namespace,
                    vector=query_vector,
                    top_k=top_k,
                    include_metadata=True
                )
                matches = []
                for match in res.get("matches", []):
                    matches.append({
                        "vector_id": match["id"],
                        "score": match["score"],
                        "metadata": match.get("metadata", {})
                    })
                logger.info("[VectorStore] Pinecone returned %d matches.", len(matches))
                return matches
            except Exception as e:
                logger.warning("[VectorStore] Pinecone query failed: %s — falling back to local.", str(e))

        # Local fallback cosine similarity search
        ns_data = _local_vector_store.get(namespace, {})
        results = []
        for vid, item in ns_data.items():
            vec = item["vector"]
            dot = sum(a * b for a, b in zip(query_vector, vec))
            norm_a = math.sqrt(sum(a * a for a in query_vector))
            norm_b = math.sqrt(sum(b * b for b in vec))
            sim = dot / (norm_a * norm_b) if (norm_a * norm_b) > 0 else 0.0
            results.append({
                "vector_id": vid,
                "score": sim,
                "metadata": item["metadata"]
            })
        results.sort(key=lambda x: x["score"], reverse=True)
        logger.info("[VectorStore] Local store returned %d matches for namespace %s.", len(results), namespace)
        return results[:top_k]


vector_store = VectorStoreService()
