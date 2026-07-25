"""
Memória de longo prazo (RAG) — é isto que dá pro JarviX a sensação de
"lembrar do usuário" sem precisar retreinar pesos a cada mensagem.

Fluxo:
1. Depois de cada conversa, extrai fatos relevantes (preferências, contexto)
2. Gera embedding do fato e salva em public.memories (Supabase + pgvector)
3. Antes de responder, busca as memórias mais relevantes pra injetar no prompt
"""
import os
from sentence_transformers import SentenceTransformer
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

_embedder = None
_supabase: Client | None = None


def _client() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase


def _embed_model() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        # Modelo leve (roda em CPU tranquilamente, ~80MB)
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedder


def save_memory(user_id: str, content: str, source_message_id: str | None = None):
    embedding = _embed_model().encode(content).tolist()
    _client().table("memories").insert({
        "user_id": user_id,
        "content": content,
        "embedding": embedding,
        "source_message_id": source_message_id,
    }).execute()


def search_memories(user_id: str, query: str, top_k: int = 5) -> list[str]:
    """
    Busca as memórias mais relevantes pro contexto atual.
    Usa a função de similaridade do pgvector via RPC (ver supabase/schema.sql
    — precisa criar a função match_memories no Supabase, veja README do ai-core).
    """
    query_embedding = _embed_model().encode(query).tolist()
    result = _client().rpc("match_memories", {
        "query_embedding": query_embedding,
        "match_user_id": user_id,
        "match_count": top_k,
    }).execute()
    return [row["content"] for row in (result.data or [])]
