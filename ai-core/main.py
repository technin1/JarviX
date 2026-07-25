"""
JarviX AI Core — serviço Python que centraliza chat, memória e geração de
arquivos. Consumido pelo backend Node.js (não exposto direto ao frontend).

Rodar localmente:
    uvicorn main:app --reload --port 8000
"""
import os
import re
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from llm import router as llm_router
from memory import rag
from file_generator import packager

load_dotenv()

app = FastAPI(title="JarviX AI Core")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    user_id: str
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    content: str
    source: str


class GenerateProjectRequest(BaseModel):
    files: dict[str, str]  # {"caminho/arquivo.py": "conteúdo"}
    project_name: str = "jarvix_project"


class AnalyzeUploadRequest(BaseModel):
    file_url: str
    file_type: str


class SaveMemoryRequest(BaseModel):
    user_id: str
    content: str
    source_message_id: Optional[str] = None


class ScriptingGhostRequest(BaseModel):
    prompt: str
    language: str = "javascript"


class ScriptingGhostResponse(BaseModel):
    content: str


class ScriptingSuggestRequest(BaseModel):
    context: str  # tudo que o usuário já digitou no painel superior
    last_line: str = ""  # a linha que acabou de ser finalizada (Enter)
    language: str = "javascript"


class ScriptingSuggestResponse(BaseModel):
    suggestions: list[str]


# Mensagens de usuário mais curtas que isso raramente carregam um fato
# reaproveitável ("oi", "ok", "obrigado") — não vale a pena gastar embedding
# nem espaço na tabela de memórias com elas.
MIN_MEMORY_LENGTH = 20

# Convenção que o frontend usa pra extrair arquivos da resposta e oferecer
# o botão "Baixar projeto" (via /generate-project). Sem essa instrução, o
# modelo devolve código solto em blocos comuns e não há como saber onde
# termina um arquivo e começa outro.
FILE_GENERATION_SYSTEM_PROMPT = (
    "Quando o usuário pedir para você gerar um projeto completo ou vários "
    "arquivos de código para ele baixar, entregue cada arquivo em um bloco "
    "de código markdown separado, usando exatamente este formato na linha "
    "de abertura do bloco (sem espaços entre 'file:' e o caminho):\n"
    "```file:caminho/relativo/do/arquivo.ext\n"
    "<conteúdo completo do arquivo aqui>\n"
    "```\n"
    "Um bloco desses para cada arquivo, com o caminho relativo completo "
    "(incluindo subpastas quando fizer sentido, ex: src/index.js). "
    "NÃO use esse formato para trechos de código soltos, exemplos, ou "
    "quando o usuário só quer ver/entender um pedaço de código — apenas "
    "quando o pedido é claramente por arquivo(s) completos para baixar."
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Fluxo:
    1. Busca memórias relevantes do usuário
    2. Injeta como contexto de sistema
    3. Router decide: modelo próprio ou fallback Groq
    """
    last_user_msg = next((m.content for m in reversed(req.messages) if m.role == "user"), "")

    try:
        memories = rag.search_memories(req.user_id, last_user_msg)
    except Exception:
        # Memória é um "nice to have" — se falhar, não deve travar o chat.
        memories = []

    messages = [{"role": "system", "content": FILE_GENERATION_SYSTEM_PROMPT}]
    if memories:
        context = "Contexto sobre o usuário (memórias relevantes):\n" + "\n".join(f"- {m}" for m in memories)
        messages.append({"role": "system", "content": context})
    messages.extend(m.dict() for m in req.messages)

    result = await llm_router.get_response(messages)

    # Grava a mensagem do usuário como memória de longo prazo, pra poder ser
    # recuperada em conversas futuras via rag.search_memories() (acima).
    # Sem isto, a busca de memórias nunca encontrava nada — a IA "esquecia"
    # tudo entre conversas, mesmo com o RAG implementado.
    # É um "nice to have": se falhar (embedder indisponível, Supabase fora do
    # ar, etc.), não deve derrubar a resposta do chat que o usuário já recebeu.
    if last_user_msg and len(last_user_msg) >= MIN_MEMORY_LENGTH:
        try:
            rag.save_memory(req.user_id, last_user_msg)
        except Exception:
            pass

    return ChatResponse(content=result["content"], source=result["source"])


@app.post("/generate-project")
async def generate_project(req: GenerateProjectRequest):
    """
    Recebe um dicionário de arquivos já gerados pela IA (via chat/ferramentas)
    e retorna um .zip pronto pra download — conforme o requisito de
    "download focado em velocidade, projetos completos empacotados em zip".
    """
    zip_bytes = packager.build_zip_from_files(req.files)

    # project_name vem do usuário (via frontend/backend) e cai direto num
    # header HTTP — sem sanitizar, caracteres como aspas, "/" ou quebras de
    # linha podem quebrar o header ou permitir um nome de arquivo malicioso.
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", req.project_name).strip("_") or "jarvix_project"

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={safe_name}.zip"},
    )


@app.post("/memory/save")
async def save_memory_endpoint(req: SaveMemoryRequest):
    rag.save_memory(req.user_id, req.content, req.source_message_id)
    return {"status": "saved"}


@app.post("/analyze-upload")
async def analyze_upload(req: AnalyzeUploadRequest):
    """
    Processado em background pelo uploadWorker.js (fila BullMQ), não no
    caminho crítico do upload em si.

    LIMITAÇÃO ATUAL: isto manda só a URL como texto pro modelo, que não
    "vê" a imagem de verdade — serve pra validar o fluxo (fila -> resultado
    salvo), não a qualidade da análise. Pra análise real de imagem, troque
    por uma chamada multimodal (ex: baixar a imagem, converter pra base64
    e mandar como content do tipo "image" pra API do modelo escolhido).
    """
    if req.file_type.startswith("image/"):
        prompt = f"Descreva o conteúdo desta imagem em detalhes: {req.file_url}"
    else:
        prompt = f"Analise o arquivo em {req.file_url} (tipo: {req.file_type}) e resuma o conteúdo."

    result = await llm_router.get_response([{"role": "user", "content": prompt}])
    return {"analysis": result["content"]}


# --- Scripting Teacher ---
# Módulo de treino de digitação de código: a IA gera um código-fantasma
# (ghost) que o usuário sobrescreve caractere a caractere no painel superior,
# e sugestões curtas de próxima linha no painel inferior a cada Enter.

GHOST_SYSTEM_PROMPT = (
    "Você é um assistente de treino de digitação de código (Scripting Teacher). "
    "Gere APENAS o código puro no idioma/linguagem pedida, sem explicações, "
    "sem comentários de markdown (nada de ```), sem texto antes ou depois. "
    "O código deve ser curto o suficiente para um exercício de digitação "
    "(entre 5 e 25 linhas), correto e idiomático na linguagem pedida."
)


@app.post("/scripting/ghost", response_model=ScriptingGhostResponse)
async def scripting_ghost(req: ScriptingGhostRequest):
    messages = [
        {"role": "system", "content": GHOST_SYSTEM_PROMPT},
        {"role": "user", "content": f"Linguagem: {req.language}\nPedido: {req.prompt}"},
    ]
    result = await llm_router.get_response(messages)
    # Alguns modelos ainda devolvem blocos ```lang ... ``` mesmo pedindo pra não —
    # removemos as cercas de markdown se vierem, pra não poluir o código-fantasma.
    content = re.sub(r"^```[a-zA-Z]*\n?|```$", "", result["content"].strip(), flags=re.MULTILINE).strip()
    return ScriptingGhostResponse(content=content)


SUGGEST_SYSTEM_PROMPT = (
    "Você é um assistente de treino de digitação de código (Scripting Teacher). "
    "Dado o código que o usuário já escreveu e a última linha que ele acabou "
    "de finalizar, sugira de 2 a 3 alternativas curtas e plausíveis para a "
    "PRÓXIMA linha de código (não repita a linha já escrita). Responda "
    "SOMENTE com uma linha por sugestão, sem numeração, sem marcadores, sem "
    "explicações."
)


@app.post("/scripting/suggest", response_model=ScriptingSuggestResponse)
async def scripting_suggest(req: ScriptingSuggestRequest):
    user_content = (
        f"Linguagem: {req.language}\n"
        f"Código até agora:\n{req.context}\n\n"
        f"Última linha finalizada: {req.last_line}\n"
        "Sugira a próxima linha (2 a 3 alternativas)."
    )
    messages = [
        {"role": "system", "content": SUGGEST_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    result = await llm_router.get_response(messages)

    # Modelo devolve uma sugestão por linha — limpamos marcadores/numeração
    # que ele eventualmente adicione mesmo sendo instruído a não usar.
    lines = [re.sub(r"^\s*[-*\d.)]+\s*", "", line).strip() for line in result["content"].splitlines()]
    suggestions = [line for line in lines if line][:3]
    if not suggestions:
        suggestions = [result["content"].strip()]

    return ScriptingSuggestResponse(suggestions=suggestions)
