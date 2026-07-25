# JarviX — Projeto Inicial

Este é o esqueleto funcional do JarviX, cobrindo todas as funcionalidades
descritas nos documentos originais (`jarvix1.0.txt`, `layout.txt`, `apis.txt`,
`recursos.txt`). É um **ponto de partida real e rodável**, não um mockup —
mas ainda precisa de: chaves de API, execução do schema no Supabase, e
ajustes de design visual antes de virar produto.

## Arquitetura

```
frontend/   → HTML/JS (Dashboard como tela inicial, chat fullscreen + mini
              chat, feed social, Member Control). Tema escuro "tecnológico".
backend/    → Node.js (Express + Socket.io). É a "ponte": recebe requisições
              do frontend, persiste no Supabase, chama o ai-core.
ai-core/    → Python (FastAPI). É o "cérebro": decide entre modelo próprio
              e fallback Groq, gerencia memória (RAG) e gera os zips
              de projeto.
supabase/   → schema.sql com todas as tabelas (perfis, conversas, mensagens,
              memórias vetoriais, exemplos de fine-tuning, projetos
              compartilhados, uploads).
```

## Sistema de plugins e hooks

## Scripting Teacher (treino de digitação de código)

Módulo de treino: a IA gera um código-fantasma (opacidade reduzida) no
painel superior e o usuário o sobrescreve **caractere a caractere** (a letra
digitada substitui a letra fantasma na mesma posição, como um jogo de
digitação). O painel inferior é só leitura e recebe sugestões da IA a cada
linha finalizada (Enter). O chat de prompt é isolado dos dois painéis — só
serve para pedir um novo exercício. Copiar/colar (Ctrl+C/Ctrl+X) e seleção
de texto são bloqueados no editor.

Subpastas na lateral (todas "conectam com o Now", ou seja, carregar algo
ali substitui o exercício atual — o usuário é avisado antes se houver
conteúdo não exportado):

- **New Session** — pergunta se quer salvar ou descartar a sessão atual
  antes de abrir uma nova.
- **Last Session** / **Sessions** — a mais recente e as últimas 5 sessões
  finalizadas (via New Session → salvar).
- **My Archives** — exportações permanentes (máx. 15 arquivos, exclusão
  manual, downloads disponíveis aqui).
- **Projects** — upload de projetos `.zip`; duplo clique num arquivo da
  árvore abre o conteúdo no Now.

Peças novas: migração `supabase/migrations/20260723100000_scripting_teacher.sql`
(tabelas `scripting_sessions`, `scripting_archives`, `scripting_projects` —
crie também o bucket de Storage `scripting-projects`, privado), rotas
`backend/src/routes/scriptingTeacher.js`, e os endpoints
`/scripting/ghost` e `/scripting/suggest` no `ai-core/main.py`.

## Dashboard e preferências de IA

A tela inicial do app **não é mais o Chat** — é o Dashboard. Nele, o usuário
vê um resumo da própria atividade (conversas, projetos, uploads, num
gráfico de pizza) e define **preferências que a IA usa como contexto em
toda conversa**, sem precisar repeti-las:

- **Tom de resposta**: casual, formal ou técnico
- **Áreas de foco**: código, produtividade, negócios, criativo, dados, suporte
- **Objetivo atual**: texto livre curto (ex: "lançar meu SaaS de gestão")

Essas preferências ficam em `profiles.preferences` (jsonb) e são lidas no
backend (`backend/src/services/preferenceContext.js`) toda vez que uma
mensagem é enviada — tanto pelo chat fullscreen (`chat.js`) quanto pelo
mini-chat (`chatSocket.js`). O texto de contexto é injetado como uma
mensagem de sistema antes de ir pro ai-core, nunca fica salvo no histórico
de conversa.

A navegação foi simplificada: Dashboard, Chat, Feed, Cache temporário,
Member Control (admin) e um link direto para a Curadoria de IA (admin,
`/admin.html` — antes não estava linkado em lugar nenhum do app).

O backend tem um sistema de extensão parecido com o de painéis PHP
tradicionais (manifesto JSON + pasta de plugin + hooks), adaptado pro nosso
stack Node.js:

```
backend/plugins/<nome>/
  plugin.json   → manifesto: name, description, version, author, enabled, entry
  index.js      → exporta register(hooks), onde o plugin se acopla aos hooks
```

Hooks disponíveis hoje (disparados em `chat.js`, `chatSocket.js`,
`members.js` e `uploadWorker.js`):

- `chat:before_send` — antes de qualquer mensagem ir pro ai-core
- `chat:after_response` — depois que a IA respondeu e já foi salvo no banco
- `member:after_create` — depois que um membro é cadastrado no Member Control
- `upload:after_analysis` — depois que a análise de um arquivo termina

Veja `backend/plugins/example/` (desabilitado por padrão) como modelo pronto
para copiar. Plugins são listados e ligados/desligados pelo admin em
`GET/PUT /api/admin/plugins` — **é necessário reiniciar backend e worker**
para o código de um plugin ser carregado ou descarregado, já que o Node não
recarrega módulos em tempo real.

## Decisão importante: como a "IA que se atualiza sozinha" foi implementada

Você pediu fine-tuning automático real (retreino de pesos). Isso foi
implementado, mas **em lote, não em tempo real** — é a única forma de fazer
isso sem gastar uma fortuna em GPU ou arriscar o modelo degradar com dados
ruins. O fluxo completo:

1. **Conversas acontecem normalmente** — modelo próprio responde, ou cai pro
   Groq quando a confiança é baixa (`ai-core/llm/router.py`).
2. **Curadoria** (`ai-core/finetune/data_prep.py`) — transforma trocas
   bem-sucedidas em candidatos a exemplo de treino. Ficam com `approved=false`
   até alguém revisar (evita que a IA aprenda lixo).
3. **Treino em lote** (`ai-core/finetune/train_lora.py`) — quando houver
   exemplos aprovados suficientes, roda LoRA (fine-tuning leve, não retreina
   o modelo inteiro) sobre um modelo base pequeno e open-source. Isso gera
   um adaptador de poucos MB, não um modelo novo do zero.
4. **Adaptador entra em produção** — o `local_model.py` carrega o adaptador
   mais recente automaticamente.

**Isso exige GPU para rodar em tempo hábil.** Sem GPU, `USE_LOCAL_MODEL=false`
no `.env` faz o sistema usar só o Groq — o produto funciona 100% assim
enquanto vocês não tiverem infraestrutura de treino.

## Como rodar localmente

1. Crie um projeto no [Supabase](https://supabase.com), rode a migration em
   `supabase/migrations/20260712000000_initial_schema.sql` (veja `DEPLOY.md`
   pra duas formas de fazer isso), e crie os buckets de Storage `uploads` e
   `generated-projects` (detalhado em `DEPLOY.md`).
2. Copie `.env.example` para `.env` e preencha as chaves.
3. Suba tudo:
   ```bash
   docker compose up --build
   ```
4. Abra `frontend/public/index.html` no navegador (ou sirva com um
   `npx serve frontend/public`).

Serviços:
- Backend: `http://localhost:3000`
- AI Core: `http://localhost:8000` (docs automáticas em `/docs`)

## O que falta pra virar produto (próximos passos sugeridos)

- [x] Autenticação real no frontend (Supabase Auth, com RLS ativado no banco)
- [x] Design visual (primeira passada aplicada: paleta "oldschool, cores
      quentes", tipografia serifada, bolhas de chat, cards do feed. Layout
      estrutural validado — ainda dá pra refinar com uma ferramenta de
      design dedicada se quiserem algo mais autoral)
- [x] Feed social (compartilhamento de projetos/prompts, com RLS público/privado)
- [x] Fila de jobs (BullMQ) — uploads e geração de projetos rodam em
      workers separados (`backend/src/workers/`), não travam requisições
- [ ] Escolher e provisionar GPU quando for rodar o fine-tuning de verdade
      (guia em `GPU_SETUP.md` — decisão de negócio, não dá pra automatizar)
- [x] Moderação/curadoria dos exemplos de treino (`/admin.html`, protegido
      por `is_admin` + RLS)

## Deploy

Veja `DEPLOY.md` para o passo a passo de GitHub → Supabase → VPS, incluindo
o workflow de CI/CD já configurado em `.github/workflows/deploy.yml`.

## Recursos usados (por que cada um)

Ver `recursos.txt` original — este projeto já implementa a stack recomendada:
Python (FastAPI, PyTorch, Transformers, PEFT) para o núcleo de IA, Node.js
(Express, Socket.io, BullMQ) como ponte/API, Supabase como banco, e Docker
para empacotar tudo de forma consistente.
