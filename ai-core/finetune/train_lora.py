"""
Job de fine-tuning EM LOTE (não em tempo real) via LoRA.

Rode isto periodicamente (ex: cron 1x por semana, ou manualmente quando
tiver acumulado exemplos suficientes). EXIGE GPU — sem ela, é inviável
em tempo hábil mesmo para um modelo pequeno.

Uso:
    python train_lora.py --min-examples 200

O que este script faz:
1. Puxa exemplos aprovados (approved=true) da tabela finetune_examples
2. Treina um adaptador LoRA sobre o modelo base (poucos MB, não o modelo inteiro)
3. Salva o adaptador em ./adapters/<timestamp> e atualiza ./adapters/latest
4. Marca os exemplos usados, pra não retreinar em cima do mesmo dado
"""
import argparse
import os
import shutil
from datetime import datetime

from datasets import Dataset
from peft import LoraConfig, get_peft_model
from supabase import create_client
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
    DataCollatorForLanguageModeling,
)

BASE_MODEL_NAME = os.getenv("BASE_MODEL_NAME", "Qwen/Qwen2.5-3B-Instruct")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
ADAPTERS_DIR = os.path.join(os.path.dirname(__file__), "adapters")


def fetch_training_examples(min_examples: int) -> list[dict]:
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    result = (
        client.table("finetune_examples")
        .select("*")
        .eq("approved", True)
        .is_("used_in_training_run", "null")
        .execute()
    )
    examples = result.data or []
    if len(examples) < min_examples:
        raise SystemExit(
            f"Só há {len(examples)} exemplos aprovados; "
            f"mínimo configurado é {min_examples}. Aguarde mais dados curados."
        )
    return examples


def build_dataset(examples: list[dict], tokenizer) -> Dataset:
    def format_example(ex):
        text = f"### Instrução:\n{ex['prompt']}\n\n### Resposta:\n{ex['completion']}"
        return tokenizer(text, truncation=True, max_length=1024, padding="max_length")

    ds = Dataset.from_list(examples)
    return ds.map(format_example, remove_columns=ds.column_names)


def train(min_examples: int):
    examples = fetch_training_examples(min_examples)
    print(f"Treinando com {len(examples)} exemplos curados.")

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL_NAME)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(BASE_MODEL_NAME, device_map="auto")

    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "v_proj"],  # ajuste conforme a arquitetura do modelo escolhido
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    dataset = build_dataset(examples, tokenizer)

    run_id = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    output_dir = os.path.join(ADAPTERS_DIR, run_id)

    training_args = TrainingArguments(
        output_dir=output_dir,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        num_train_epochs=3,
        learning_rate=2e-4,
        fp16=True,
        logging_steps=10,
        save_strategy="epoch",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
    )
    trainer.train()

    model.save_pretrained(output_dir)

    latest_path = os.path.join(ADAPTERS_DIR, "latest")
    if os.path.islink(latest_path) or os.path.exists(latest_path):
        shutil.rmtree(latest_path, ignore_errors=True)
    shutil.copytree(output_dir, latest_path)

    _mark_examples_used(examples, run_id)
    print(f"Treino concluído. Adaptador salvo em {output_dir} e promovido para 'latest'.")


def _mark_examples_used(examples: list[dict], run_id: str):
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    ids = [ex["id"] for ex in examples]
    client.table("finetune_examples").update({"used_in_training_run": run_id}).in_("id", ids).execute()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-examples", type=int, default=200)
    args = parser.parse_args()
    train(args.min_examples)
