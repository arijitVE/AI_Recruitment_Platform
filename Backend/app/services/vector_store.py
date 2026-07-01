import hashlib
import math
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from app.config import settings

openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY) if settings.OPENAI_API_KEY and settings.OPENAI_API_KEY != "test_key" else None

# In-memory vector store fallback for local testing without active Pinecone account
_local_vector_store: Dict[str, Dict[str, Any]] = {}


async def generate_embedding(text: str) -> List[float]:
    """Generate embedding vector for clean rendered profile text using OpenAI embeddings API."""
    if not openai_client:
        # Deterministic pseudo-embedding for testing (dimension 1536)
        h = hashlib.sha256(text.encode("utf-8")).digest()
        vec = []
        for i in range(1536):
            val = ((h[i % len(h)] + i) % 256) / 255.0 - 0.5
            vec.append(val)
        # Normalize vector to unit length for cosine similarity
        norm = math.sqrt(sum(v * v for v in vec))
        return [v / norm if norm != 0 else 0.0 for v in vec]

    try:
        response = await openai_client.embeddings.create(
            input=text,
            model="text-embedding-3-small"
        )
        return response.data[0].embedding
    except Exception as e:
        raise RuntimeError(f"OpenAI embedding generation failed: {str(e)}")


class VectorStoreService:
    def __init__(self):
        self.use_pinecone = settings.PINECONE_API_KEY and settings.PINECONE_API_KEY != "test_key"
        self.index = None
        if self.use_pinecone:
            try:
                from pinecone import Pinecone
                pc = Pinecone(api_key=settings.PINECONE_API_KEY)
                self.index = pc.Index(settings.PINECONE_INDEX_NAME)
            except Exception:
                self.use_pinecone = False

    async def upsert_vector(self, namespace: str, vector_id: str, vector: List[float], metadata: Dict[str, Any]):
        """Upsert a candidate vector into Pinecone under the job namespace."""
        if self.use_pinecone and self.index:
            try:
                self.index.upsert(
                    vectors=[{"id": vector_id, "values": vector, "metadata": metadata}],
                    namespace=namespace
                )
                return
            except Exception:
                pass
        
        # Local fallback
        if namespace not in _local_vector_store:
            _local_vector_store[namespace] = {}
        _local_vector_store[namespace][vector_id] = {
            "vector": vector,
            "metadata": metadata
        }

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
                return matches
            except Exception:
                pass

        # Local fallback cosine similarity search
        ns_data = _local_vector_store.get(namespace, {})
        results = []
        for vid, item in ns_data.items():
            vec = item["vector"]
            # Cosine similarity calculation
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
        return results[:top_k]


vector_store = VectorStoreService()
