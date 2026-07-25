import { Router } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import { supabase } from "../services/supabaseClient.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { generateGhostCode, suggestNextLine } from "../services/aiCoreClient.js";

const router = Router();

const MAX_ARCHIVES = 15;
const MAX_HISTORY_SESSIONS = 5;
const PROJECTS_BUCKET = "scripting-projects";

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    // Aceita só .zip — o resto (extrair, ler entradas) assume esse formato.
    const isZip = file.mimetype === "application/zip" || file.originalname.toLowerCase().endsWith(".zip");
    if (!isZip) return cb(new Error("Apenas arquivos .zip são aceitos em Projects."));
    cb(null, true);
  },
});

// ---------- Now (sessão de trabalho atual) ----------

// GET /api/scripting/now — devolve a sessão "now" do usuário, criando uma
// vazia se ainda não existir (ex: primeiro acesso ao módulo).
router.get("/now", requireAuth, async (req, res) => {
  try {
    const now = await getOrCreateNow(req.user.id);
    res.json(now);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao carregar a sessão atual." });
  }
});

// PUT /api/scripting/now — autosave do que o usuário está digitando.
router.put("/now", requireAuth, async (req, res) => {
  try {
    const { title, language, content, ghostContent, cursorPos } = req.body;
    const now = await getOrCreateNow(req.user.id);

    const { data, error } = await supabase
      .from("scripting_sessions")
      .update({
        title: title ?? now.title,
        language: language ?? now.language,
        content: content ?? now.content,
        ghost_content: ghostContent ?? now.ghost_content,
        cursor_pos: cursorPos ?? now.cursor_pos,
        updated_at: new Date().toISOString(),
      })
      .eq("id", now.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao salvar automaticamente." });
  }
});

// POST /api/scripting/now/new  { action: "save" | "discard", title }
// Fecha a sessão "now" atual (New Session). Se action=save, ela vira uma
// sessão de "history" (aparece em Sessions e vira a Last Session); se
// action=discard, o conteúdo é simplesmente descartado. Nos dois casos uma
// "now" nova e vazia é criada/retornada.
router.post("/now/new", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { action = "discard", title } = req.body;
    const now = await getOrCreateNow(userId);
    const hasContent = (now.content || "").trim().length > 0;

    if (hasContent && action === "save") {
      // A linha "now" atual vira histórico (aparece em Sessions/Last Session)
      // e só então uma linha "now" nova, vazia, é criada — nunca podem
      // coexistir duas linhas com status='now' pro mesmo usuário (índice
      // único parcial na migração garante isso).
      await supabase
        .from("scripting_sessions")
        .update({ is_last: false })
        .eq("user_id", userId)
        .eq("status", "history");

      await supabase
        .from("scripting_sessions")
        .update({
          status: "history",
          is_last: true,
          title: title || now.title || "Sessão sem título",
          updated_at: new Date().toISOString(),
        })
        .eq("id", now.id);

      await trimHistory(userId);

      const { data: fresh, error } = await supabase
        .from("scripting_sessions")
        .insert({ user_id: userId, status: "now", title: "Sessão sem título", content: "", ghost_content: "" })
        .select()
        .single();
      if (error) throw error;
      return res.json(fresh);
    }

    // Descarta (ou não havia nada pra salvar): não vira histórico, só reseta
    // a própria linha "now" — sem criar uma segunda linha "now".
    const { data: reset, error } = await supabase
      .from("scripting_sessions")
      .update({
        content: "",
        ghost_content: "",
        cursor_pos: 0,
        title: "Sessão sem título",
        updated_at: new Date().toISOString(),
      })
      .eq("id", now.id)
      .select()
      .single();
    if (error) throw error;

    res.json(reset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao iniciar uma nova sessão." });
  }
});

async function getOrCreateNow(userId, forceReload = false) {
  const { data } = await supabase
    .from("scripting_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "now")
    .maybeSingle();

  if (data && !forceReload) return data;
  if (data && forceReload) {
    const { data: reloaded } = await supabase.from("scripting_sessions").select("*").eq("id", data.id).single();
    return reloaded;
  }

  const { data: created, error } = await supabase
    .from("scripting_sessions")
    .insert({ user_id: userId, status: "now", title: "Sessão sem título", content: "", ghost_content: "" })
    .select()
    .single();
  if (error) throw error;
  return created;
}

// Mantém só as últimas MAX_HISTORY_SESSIONS sessões de histórico — sem
// apagar nada de My Archives (que é a exportação intencional/permanente).
async function trimHistory(userId) {
  const { data } = await supabase
    .from("scripting_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "history")
    .order("created_at", { ascending: false });

  const overflow = (data || []).slice(MAX_HISTORY_SESSIONS);
  if (overflow.length) {
    await supabase.from("scripting_sessions").delete().in("id", overflow.map((s) => s.id));
  }
}

// ---------- Last Session / Sessions (conectam com Now) ----------

// GET /api/scripting/sessions/last
router.get("/sessions/last", requireAuth, async (req, res) => {
  const { data } = await supabase
    .from("scripting_sessions")
    .select("id, title, language, updated_at")
    .eq("user_id", req.user.id)
    .eq("status", "history")
    .eq("is_last", true)
    .maybeSingle();
  res.json(data || null);
});

// GET /api/scripting/sessions — últimas 5 sessões
router.get("/sessions", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("scripting_sessions")
    .select("id, title, language, updated_at, is_last")
    .eq("user_id", req.user.id)
    .eq("status", "history")
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_SESSIONS);

  if (error) return res.status(500).json({ error: "Falha ao listar sessões." });
  res.json(data);
});

// POST /api/scripting/sessions/:id/load — carrega uma sessão salva para dentro do Now
router.post("/sessions/:id/load", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: source, error: sourceError } = await supabase
      .from("scripting_sessions")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", userId)
      .single();
    if (sourceError || !source) return res.status(404).json({ error: "Sessão não encontrada." });

    // Carregar uma sessão salva vira um NOVO exercício de digitação: o
    // conteúdo final salvo passa a ser o código-fantasma, e o usuário
    // sobrescreve tudo de novo (é um módulo de treino, não um "continuar de
    // onde parei" — para isso já existe o autosave do próprio Now).
    const now = await getOrCreateNow(userId);
    const { data, error } = await supabase
      .from("scripting_sessions")
      .update({
        title: source.title,
        language: source.language,
        content: source.content,
        ghost_content: source.content,
        cursor_pos: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", now.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao carregar a sessão no Now." });
  }
});

// ---------- My Archives ----------

// GET /api/scripting/archives
router.get("/archives", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("scripting_archives")
    .select("id, filename, language, created_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: "Falha ao listar My Archives." });
  res.json(data);
});

// POST /api/scripting/archives  { filename } — exporta o conteúdo atual do Now
router.post("/archives", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { count } = await supabase
      .from("scripting_archives")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if ((count || 0) >= MAX_ARCHIVES) {
      return res.status(409).json({
        error: `My Archives está cheio (máximo de ${MAX_ARCHIVES} arquivos). Exclua algum arquivo antes de exportar um novo.`,
        full: true,
      });
    }

    const now = await getOrCreateNow(userId);
    const filename = (req.body.filename || now.title || "arquivo").trim();

    const { data, error } = await supabase
      .from("scripting_archives")
      .insert({
        user_id: userId,
        session_id: now.id,
        filename,
        language: now.language,
        content: now.content,
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao exportar para My Archives." });
  }
});

// GET /api/scripting/archives/:id/download
router.get("/archives/:id/download", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("scripting_archives")
    .select("filename, content")
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Arquivo não encontrado." });

  const safeName = data.filename.replace(/[^a-zA-Z0-9_.-]/g, "_") || "arquivo.txt";
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(data.content);
});

// DELETE /api/scripting/archives/:id
router.delete("/archives/:id", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("scripting_archives")
    .delete()
    .eq("id", req.params.id)
    .eq("user_id", req.user.id);

  if (error) return res.status(500).json({ error: "Falha ao excluir arquivo." });
  res.json({ status: "deleted" });
});

// ---------- Projects (upload de .zip) ----------

// GET /api/scripting/projects
router.get("/projects", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("scripting_projects")
    .select("id, name, entries, created_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: "Falha ao listar Projects." });
  res.json(data);
});

// POST /api/scripting/projects  (multipart/form-data: file)
router.post("/projects", requireAuth, zipUpload.single("file"), async (req, res) => {
  try {
    const userId = req.user.id;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Nenhum arquivo .zip enviado." });

    // Lista as entradas do zip (sem gravar os arquivos individualmente) —
    // o conteúdo de cada arquivo só é extraído sob demanda em /projects/:id/open,
    // pra não gastar storage/linhas de banco com arquivos que o usuário nunca abrir.
    const zip = new AdmZip(file.buffer);
    const entries = zip
      .getEntries()
      .filter((e) => !e.isDirectory)
      .map((e) => ({ path: e.entryName, size: e.header.size }));

    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const zipPath = `${userId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(PROJECTS_BUCKET)
      .upload(zipPath, file.buffer, { contentType: "application/zip" });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("scripting_projects")
      .insert({
        user_id: userId,
        name: file.originalname.replace(/\.zip$/i, ""),
        zip_path: zipPath,
        entries,
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao enviar o projeto." });
  }
});

// POST /api/scripting/projects/:id/open  { path }
// Duplo clique num arquivo da árvore do projeto -> extrai só esse arquivo
// do zip e joga o conteúdo dentro do Now.
router.post("/projects/:id/open", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: "Informe o caminho do arquivo dentro do projeto." });

    const { data: project, error: projectError } = await supabase
      .from("scripting_projects")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", userId)
      .single();
    if (projectError || !project) return res.status(404).json({ error: "Projeto não encontrado." });

    const { data: zipFile, error: downloadError } = await supabase.storage
      .from(PROJECTS_BUCKET)
      .download(project.zip_path);
    if (downloadError) throw downloadError;

    const buffer = Buffer.from(await zipFile.arrayBuffer());
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry(path);
    if (!entry) return res.status(404).json({ error: "Arquivo não encontrado dentro do .zip." });

    const content = entry.getData().toString("utf-8");
    const language = guessLanguageFromPath(path);

    const now = await getOrCreateNow(userId);
    const { data, error } = await supabase
      .from("scripting_sessions")
      .update({
        title: path.split("/").pop(),
        language,
        content,
        ghost_content: content,
        cursor_pos: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", now.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao abrir o arquivo do projeto no Now." });
  }
});

function guessLanguageFromPath(path) {
  const ext = path.split(".").pop().toLowerCase();
  const map = { js: "javascript", jsx: "javascript", ts: "javascript", py: "python", html: "html", css: "css", sql: "sql", json: "javascript" };
  return map[ext] || "javascript";
}

// ---------- IA: ghost code + sugestões ----------

// POST /api/scripting/ghost  { prompt, language }
// Chat isolado do módulo: pede à IA um código-fantasma pra praticar.
router.post("/ghost", requireAuth, async (req, res) => {
  try {
    const { prompt, language } = req.body;
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: "Escreva um pedido pra IA gerar o exercício." });

    const result = await generateGhostCode(prompt.trim(), language || "javascript");
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao gerar o código-fantasma." });
  }
});

// POST /api/scripting/suggest  { context, lastLine, language }
// Painel inferior: chamado a cada Enter (linha finalizada) no painel superior.
router.post("/suggest", requireAuth, async (req, res) => {
  try {
    const { context, lastLine, language } = req.body;
    const result = await suggestNextLine(context || "", lastLine || "", language || "javascript");
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao gerar sugestões." });
  }
});

export default router;
