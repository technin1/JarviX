# Escolhendo e provisionando GPU para o fine-tuning

Não dá pra provisionar isso automaticamente — envolve criar conta e pagar em
um provedor externo. Aqui vai o que você precisa saber pra decidir.

## Quando você realmente precisa disso

Só quando `ai-core/finetune/train_lora.py` for rodar de verdade. Até lá,
`USE_LOCAL_MODEL=false` no `.env` mantém o produto 100% funcional usando só
o Groq — **não trave o lançamento esperando GPU**.

## Opções, da mais simples à mais barata por hora

| Provedor | Perfil | Preço aproximado (GPU pequena/média) |
|---|---|---|
| **RunPod** | Mais simples de usar, paga por hora, liga/desliga fácil | ~US$ 0,20–0,50/h (RTX 4090) |
| **Vast.ai** | Marketplace de GPUs, mais barato mas menos previsível | ~US$ 0,15–0,40/h |
| **Lambda Labs** | Boa relação custo/confiabilidade | ~US$ 0,50–1,10/h (A10/A100) |
| **AWS/GCP/Azure** | Mais caro e mais complexo, só vale a pena se já usam a nuvem por outro motivo | Variável, geralmente mais caro |

Para o modelo base sugerido (`Qwen2.5-3B-Instruct` no `.env.example`), uma
**RTX 4090 ou A10 (24GB VRAM)** já dá conta do treino LoRA tranquilamente.
Não precisa de A100 nem de multi-GPU pra esse tamanho de modelo.

## Fluxo recomendado

1. Rode `ai-core/finetune/data_prep.py` e acumule exemplos até bater o
   `--min-examples` (200 por padrão) — isso não precisa de GPU.
2. Aprove os exemplos pelo painel (`frontend/public/admin.html`).
3. Quando tiver exemplos suficientes, alugue a GPU só pelo tempo do treino
   (geralmente minutos a poucas horas pra um modelo de 3B com LoRA).
4. Rode `train_lora.py` na instância alugada, com o `.env` apontando pro
   mesmo Supabase de produção.
5. Baixe o adaptador gerado (pasta `ai-core/finetune/adapters/latest`) e
   suba pro VPS, ou rode o `ai-core` direto na instância com GPU se o
   volume de uso justificar deixá-la ligada.
6. **Desligue a instância assim que terminar** — é cobrada por hora ligada,
   não por uso.

## Estimativa de custo

Pra um treino LoRA de poucas horas por semana, você está falando de
**dezenas de dólares por mês**, não milhares — é exatamente por isso que
a arquitetura em lote (não em tempo real) foi a escolha certa.
