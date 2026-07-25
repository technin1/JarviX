"""
Wrapper do "modelo próprio" do JarviX.

IMPORTANTE — leia antes de mexer:
Este NÃO é um modelo treinado do zero. É um modelo base pequeno e open-source
(ex: Llama 3.2 3B, Phi-3-mini, Qwen2.5-3B — escolha conforme a GPU disponível)
com adaptadores LoRA aplicados por cima. Os adaptadores são o que o job de
fine-tuning em lote (finetune/train_lora.py) atualiza periodicamente.

Isso é o que torna "nossa própria IA que aprende com conversas" viável sem
precisar de um datacenter.
"""
import os
from pathlib import Path

BASE_MODEL_NAME = os.getenv("BASE_MODEL_NAME", "Qwen/Qwen2.5-3B-Instruct")
LORA_ADAPTER_PATH = os.getenv("LORA_ADAPTER_PATH", "./finetune/adapters/latest")

_model = None
_tokenizer = None


def _lazy_load():
    """
    Carrega o modelo só quando necessário (evita gastar memória se o
    serviço estiver rodando só com fallback Groq, por exemplo em dev).
    """
    global _model, _tokenizer
    if _model is not None:
        return

    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
    import torch

    _tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL_NAME)
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL_NAME,
        torch_dtype=torch.float16,
        device_map="auto",
    )

    if Path(LORA_ADAPTER_PATH).exists():
        _model = PeftModel.from_pretrained(base, LORA_ADAPTER_PATH)
    else:
        # Ainda não rodou nenhum treino em lote — usa o modelo base puro.
        _model = base


def generate_local(messages: list[dict], max_new_tokens: int = 512) -> tuple[str, float]:
    """
    Gera resposta com o modelo local.
    Retorna (texto, confidence) — confidence é usado pelo router.py pra
    decidir se cai pro fallback Groq.
    """
    _lazy_load()

    prompt = _tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = _tokenizer(prompt, return_tensors="pt").to(_model.device)

    outputs = _model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        do_sample=True,
        temperature=0.7,
        output_scores=True,
        return_dict_in_generate=True,
    )

    text = _tokenizer.decode(
        outputs.sequences[0][inputs["input_ids"].shape[1]:],
        skip_special_tokens=True,
    )

    # Heurística simples de confiança: média das probabilidades do token mais provável.
    # Ajuste/troque por algo mais sofisticado conforme necessário.
    confidence = _estimate_confidence(outputs)

    return text, confidence


def _estimate_confidence(outputs) -> float:
    import torch
    if not outputs.scores:
        return 0.5
    probs = [torch.softmax(s, dim=-1).max().item() for s in outputs.scores]
    return sum(probs) / len(probs)
