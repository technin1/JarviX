"""
Decide se responde com o modelo próprio ou cai pro fallback Groq.
"""
import os

from . import groq_client
from . import local_model

CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.55"))
USE_LOCAL_MODEL = os.getenv("USE_LOCAL_MODEL", "false").lower() == "true"


async def get_response(messages: list[dict]) -> dict:
    """
    Retorna {"content": str, "source": "own_model" | "groq"}
    """
    if USE_LOCAL_MODEL:
        text, confidence = local_model.generate_local(messages)
        if confidence >= CONFIDENCE_THRESHOLD:
            return {"content": text, "source": "own_model", "confidence": confidence}

    # Fallback: modelo local desligado (ex: ainda não treinado / sem GPU
    # disponível em dev) ou confiança baixa na resposta local.
    text = await groq_client.ask_groq(messages)
    return {"content": text, "source": "groq"}
