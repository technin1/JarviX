"""
Curadoria de dados — transforma conversas reais em candidatos a exemplo
de fine-tuning. Roda ANTES do train_lora.py.

Importante: os exemplos entram como approved=false. Alguém (você, ou uma
regra automática mais rigorosa no futuro) precisa aprovar antes de irem
pro treino. Isso é o que evita que o modelo aprenda lixo/toxicidade.
"""
import os
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


def extract_candidates(min_message_length: int = 20):
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    messages = (
        client.table("messages")
        .select("*")
        .eq("source", "own_model")  # só reforça o que o modelo já acertou sozinho
        .order("created_at")
        .execute()
        .data or []
    )

    candidates = []
    for i in range(len(messages) - 1):
        current, nxt = messages[i], messages[i + 1]
        if current["role"] == "user" and nxt["role"] == "assistant":
            if len(current["content"]) >= min_message_length:
                candidates.append({
                    "prompt": current["content"],
                    "completion": nxt["content"],
                    "approved": False,
                })

    if candidates:
        client.table("finetune_examples").insert(candidates).execute()

    print(f"{len(candidates)} candidatos extraídos e aguardando aprovação.")


if __name__ == "__main__":
    extract_candidates()
