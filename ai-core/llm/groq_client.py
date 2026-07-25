"""
Cliente da API Groq — usado como fallback quando o modelo próprio não tem
confiança suficiente na resposta (ver llm/router.py).

Groq roda modelos open-weight (Llama, etc.) em hardware próprio (LPU),
com latência bem mais baixa que provedores tradicionais. A API é
compatível com o formato OpenAI Chat Completions.
"""
import os
import httpx

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")


async def ask_groq(messages: list[dict], model: str = None) -> str:
    """
    messages: lista no formato [{"role": "user", "content": "..."}]
    Retorna o texto da resposta.
    """
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY não configurada no .env")

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model or GROQ_MODEL,
        "messages": messages,
        "temperature": 0.7,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(GROQ_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
