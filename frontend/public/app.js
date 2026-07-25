// JarviX — SPA principal.
// Tela inicial agora é o Dashboard (perfil + preferências que a IA usa como
// contexto), não o Chat. Chat vira só mais um item de navegação.

import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";
import { supabase } from "./supabaseClient.js";
import { getSession, signUp, signIn, signOut, authHeader } from "./auth.js";
import { loadMembers } from "./members.js";
import { loadScriptingTeacher } from "./scriptingTeacher.js";

const API_URL = "/api";
let socket = null;
let currentUser = null;
let currentProfile = null;

const authScreen = document.getElementById("auth-screen");
const appEl = document.getElementById("app");
const authError = document.getElementById("auth-error");

// --- Logo (SVG único, injetado nos dois lugares em vez de duplicar HTML) ---
const LOGO_SVG = `
  <svg viewBox="0 0 230 62" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="JarviX">
    <text x="4" y="46" font-family="'JetBrains Mono', monospace" font-weight="700" font-size="40" fill="currentColor">JarviX</text>
    <path d="M6 10 C 10 4, 16 4, 18 9 C 19 5, 24 4, 27 8 C 24 6, 20 7, 18 11 C 16 7, 10 6, 6 10 Z" fill="var(--color-accent)"/>
  </svg>
`;
function renderLogo() {
  document.getElementById("logo-auth").innerHTML = LOGO_SVG;
  document.getElementById("logo-sidebar").innerHTML = LOGO_SVG;
}
renderLogo();

// --- Bootstrap: decide se mostra login ou o app ---
init();

async function init() {
  const session = await getSession();
  if (session) {
    await enterApp(session);
  } else {
    showAuthScreen();
  }

  // Reage a login/logout que aconteçam durante o uso (ex: token expirar)
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) enterApp(session);
    else showAuthScreen();
  });
}

function showAuthScreen() {
  authScreen.classList.remove("hidden");
  appEl.classList.add("hidden");
  if (socket) socket.disconnect();
}

async function enterApp(session) {
  currentUser = session.user;
  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");

  if (!socket) {
    socket = io({ auth: { token: session.access_token } }); // token validado no backend, não só o userId "por fé"
    socket.on("chat:response", (data) => {
      miniConversationId = data.conversationId;
      appendMessage(miniMessages, "assistant", data.content);
      miniHistory.push({ role: "assistant", content: data.content });
    });
    socket.on("chat:error", (data) => {
      appendMessage(miniMessages, "assistant", `Erro: ${data.error || "falha ao contatar a IA."}`, true);
    });
  }

  await loadCurrentProfile();
  await checkAdmin();
  showView("dashboard");
  loadDashboard();
}

async function loadCurrentProfile() {
  const { data } = await supabase.from("profiles").select("username, is_admin, preferences").eq("id", currentUser.id).single();
  currentProfile = data || {};
}

async function checkAdmin() {
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !currentProfile?.is_admin));
}

// --- Login / cadastro ---
document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".auth-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`${tab.dataset.tab}-form`).classList.add("active");
    authError.textContent = "";
  });
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  try {
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    await signIn(email, password);
  } catch (err) {
    authError.textContent = err.message;
  }
});

document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  try {
    const username = document.getElementById("signup-username").value;
    const email = document.getElementById("signup-email").value;
    const phone = document.getElementById("signup-phone").value;
    const password = document.getElementById("signup-password").value;
    await signUp(email, password, username, phone);
  } catch (err) {
    authError.textContent = err.message;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await signOut();
});

// --- Navegação entre views ---
function showView(viewName) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`${viewName}-view`).classList.remove("hidden");
}

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    showView(btn.dataset.view);
    if (btn.dataset.view === "dashboard") loadDashboard();
    if (btn.dataset.view === "cache") loadCache();
    if (btn.dataset.view === "feed") loadFeed();
    if (btn.dataset.view === "member-control") loadMembers();
    if (btn.dataset.view === "scripting-teacher") loadScriptingTeacher();
  });
});

// --- Chat fullscreen (request/response via REST, autenticado) ---
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const messagesDiv = document.getElementById("messages");
let history = [];
// null = "ainda sem conversa criada"; o backend cria uma na primeira mensagem
// (sempre associada ao dono certo) e devolve o id real pra reusarmos daqui pra frente.
let conversationId = null;

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  appendMessage(messagesDiv, "user", text);
  history.push({ role: "user", content: text });
  chatInput.value = "";

  const headers = { "Content-Type": "application/json", ...(await authHeader()) };
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ conversationId, messages: history }),
  });
  const data = await res.json();

  if (!res.ok || !data.content) {
    appendMessage(messagesDiv, "assistant", `Erro: ${data.error || "falha ao contatar a IA. Tente novamente."}`, true);
    return;
  }

  conversationId = data.conversationId;
  appendMessage(messagesDiv, "assistant", `${stripFileBlocksForDisplay(data.content)} (fonte: ${data.source})`);
  maybeAddProjectDownload(messagesDiv, data.content);
  history.push({ role: "assistant", content: data.content });
});

// Troca cada bloco ```file:caminho ...``` por uma linha curta "📄 caminho" —
// mostrar o conteúdo inteiro do arquivo cru na bolha do chat, com as marcações
// de markdown visíveis (appendMessage usa textContent, não renderiza markdown),
// deixaria a conversa ilegível quando a IA gera vários arquivos.
function stripFileBlocksForDisplay(text) {
  return text.replace(/```file:([^\n`]+)\n[\s\S]*?```/g, (_, path) => `📄 ${path.trim()}`).trim();
}

// --- Geração de projeto (zip) a partir de arquivos que a IA gerou no chat ---
// A IA marca cada arquivo com ```file:caminho ... ``` (ver system prompt no
// ai-core). Aqui extraímos esses blocos e, se houver algum, mostramos um
// botão pra empacotar tudo via /api/download/project (fila já existente,
// só nunca era chamada por ninguém no frontend).
function parseFileBlocks(text) {
  const regex = /```file:([^\n`]+)\n([\s\S]*?)```/g;
  const files = {};
  let match;
  while ((match = regex.exec(text))) {
    const path = match[1].trim();
    if (path) files[path] = match[2].replace(/\n$/, "");
  }
  return files;
}

function maybeAddProjectDownload(container, text) {
  const files = parseFileBlocks(text);
  const count = Object.keys(files).length;
  if (!count) return;

  const row = document.createElement("div");
  row.className = "project-download-row";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-secondary";
  btn.textContent = `📦 Baixar projeto (${count} arquivo${count > 1 ? "s" : ""})`;
  btn.onclick = () => downloadProject(files, btn);
  row.appendChild(btn);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

async function downloadProject(files, btn) {
  btn.disabled = true;
  btn.textContent = "Gerando zip...";
  try {
    const headers = { "Content-Type": "application/json", ...(await authHeader()) };
    const res = await fetch(`${API_URL}/download/project`, {
      method: "POST",
      headers,
      body: JSON.stringify({ files, projectName: `jarvix_projeto_${Date.now()}` }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao iniciar a geração do projeto.");
    pollProjectStatus(data.jobId, files, btn);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `Erro: ${err.message}`;
  }
}

async function pollProjectStatus(jobId, files, btn) {
  try {
    const headers = await authHeader();
    const res = await fetch(`${API_URL}/download/project/${jobId}/status`, { headers });
    const data = await res.json();

    if (data.status === "completed") {
      btn.disabled = false;
      btn.textContent = "✅ Baixar .zip";
      btn.onclick = () => window.open(data.result.downloadUrl, "_blank");
    } else if (data.status === "failed") {
      btn.disabled = false;
      btn.textContent = "❌ Falha ao gerar — tentar de novo";
      btn.onclick = () => downloadProject(files, btn);
    } else {
      setTimeout(() => pollProjectStatus(jobId, files, btn), 2000);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `Erro: ${err.message}`;
  }
}

// --- Upload de arquivos (fotos, código, documentos) ---
async function uploadFile(file, convId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("conversationId", convId);

  const headers = await authHeader(); // não define Content-Type: o browser
                                       // cuida do multipart/form-data sozinho
  const res = await fetch(`${API_URL}/upload`, { method: "POST", headers, body: formData });
  if (!res.ok) throw new Error((await res.json()).error || "Falha no upload.");
  return res.json(); // { url, type, status }
}

document.getElementById("chat-attach-btn").addEventListener("click", () => {
  document.getElementById("chat-file-input").click();
});
document.getElementById("chat-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  appendMessage(messagesDiv, "user", `📎 Enviando: ${file.name}...`);
  try {
    const { url } = await uploadFile(file, conversationId);
    appendMessage(messagesDiv, "assistant", `Arquivo recebido, analisando em segundo plano (${url})`);
  } catch (err) {
    appendMessage(messagesDiv, "assistant", `Erro: ${err.message}`, true);
  }
  e.target.value = "";
});

document.getElementById("mini-attach-btn").addEventListener("click", () => {
  document.getElementById("mini-file-input").click();
});
document.getElementById("mini-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentUser) return;
  appendMessage(miniMessages, "user", `📎 ${file.name}`);
  try {
    // Corrigido: o mini-chat tem sua própria conversa (miniConversationId),
    // usar o conversationId do chat fullscreen aqui era um bug — o arquivo
    // acabava associado à conversa errada.
    await uploadFile(file, miniConversationId);
    appendMessage(miniMessages, "assistant", "Arquivo recebido, analisando...");
  } catch (err) {
    appendMessage(miniMessages, "assistant", `Erro: ${err.message}`, true);
  }
  e.target.value = "";
});

// --- Mini chat (via socket, tempo real) ---
const miniHeader = document.getElementById("mini-chat-header");
const miniChat = document.getElementById("mini-chat");
miniHeader.addEventListener("click", () => miniChat.classList.toggle("collapsed"));

const miniForm = document.getElementById("mini-chat-form");
const miniInput = document.getElementById("mini-chat-input");
const miniMessages = document.getElementById("mini-messages");
let miniHistory = [];
let miniConversationId = null; // criado pelo backend na primeira mensagem, autenticado via token

miniForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = miniInput.value.trim();
  if (!text || !currentUser) return;

  appendMessage(miniMessages, "user", text);
  miniHistory.push({ role: "user", content: text });
  miniInput.value = "";

  socket.emit("chat:message", { conversationId: miniConversationId, messages: miniHistory });
});

// --- Feed social ---
const shareForm = document.getElementById("share-form");
shareForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const headers = { "Content-Type": "application/json", ...(await authHeader()) };
  await fetch(`${API_URL}/feed`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: document.getElementById("share-title").value,
      description: document.getElementById("share-description").value,
      prompt: document.getElementById("share-prompt").value,
      isPublic: document.getElementById("share-public").checked,
    }),
  });
  shareForm.reset();
  loadFeed();
});

async function loadFeed() {
  const res = await fetch(`${API_URL}/feed`);
  const items = await res.json();
  const list = document.getElementById("feed-list");
  list.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "feed-card";
    card.innerHTML = `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || "")}</p>`;
    list.appendChild(card);
  });
}

function appendMessage(container, role, text, isError = false) {
  const el = document.createElement("div");
  el.className = `message message-${role}${isError ? " message-error" : ""}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// --- Dashboard: saudação + resumo de atividade (donut) + preferências de IA ---
async function loadDashboard() {
  document.getElementById("dashboard-greeting").textContent =
    `Olá, ${currentProfile?.username || "usuário"}. Aqui está seu resumo e o contexto que a IA vai usar nas conversas.`;

  await loadActivitySummary();
  loadPreferencesForm();
}

async function loadActivitySummary() {
  const [{ count: uploadsCount }, { count: projectsCount }, { count: conversationsCount }] = await Promise.all([
    supabase.from("uploads").select("id", { count: "exact", head: true }).eq("user_id", currentUser.id),
    supabase.from("shared_projects").select("id", { count: "exact", head: true }).eq("owner_id", currentUser.id),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", currentUser.id),
  ]);

  const segments = [
    { label: "Conversas", value: conversationsCount || 0, color: "var(--color-primary)" },
    { label: "Projetos compartilhados", value: projectsCount || 0, color: "var(--color-accent)" },
    { label: "Arquivos enviados", value: uploadsCount || 0, color: "var(--color-success)" },
  ];

  renderDonut(document.getElementById("profile-chart-wrap"), segments);

  const legend = document.getElementById("profile-legend");
  legend.innerHTML = segments
    .map((s) => `<li><span class="dot" style="background:${s.color}"></span>${escapeHtml(s.label)}: <strong>${s.value}</strong></li>`)
    .join("");
}

function renderDonut(container, segments) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  let cumulative = 0;
  const stops = segments.map((s) => {
    const start = (cumulative / total) * 360;
    cumulative += s.value;
    const end = (cumulative / total) * 360;
    return `${s.color} ${start}deg ${end}deg`;
  });

  container.innerHTML = `
    <div class="donut" style="background: conic-gradient(${stops.join(", ")});">
      <div class="donut-hole">${total}<span>total</span></div>
    </div>
  `;
}

// --- Preferências da IA (tom, foco, objetivo) — vira contexto no backend ---
const preferencesForm = document.getElementById("preferences-form");
const focusChips = document.querySelectorAll("#pref-focus-chips .chip");

function loadPreferencesForm() {
  const prefs = currentProfile?.preferences || {};

  document.getElementById("pref-tone").value = prefs.tone || "casual";
  document.getElementById("pref-goal").value = prefs.goal || "";

  const activeFocus = new Set(prefs.focus || []);
  focusChips.forEach((chip) => chip.classList.toggle("active", activeFocus.has(chip.dataset.focus)));
}

focusChips.forEach((chip) => {
  chip.addEventListener("click", () => chip.classList.toggle("active"));
});

preferencesForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const savedMsg = document.getElementById("preferences-saved");
  savedMsg.textContent = "";

  const preferences = {
    tone: document.getElementById("pref-tone").value,
    focus: [...focusChips].filter((c) => c.classList.contains("active")).map((c) => c.dataset.focus),
    goal: document.getElementById("pref-goal").value.trim(),
  };

  const { error } = await supabase.from("profiles").update({ preferences }).eq("id", currentUser.id);
  if (error) {
    savedMsg.textContent = "Erro ao salvar preferências.";
    savedMsg.classList.add("error-text");
    return;
  }

  currentProfile.preferences = preferences;
  savedMsg.classList.remove("error-text");
  savedMsg.textContent = "Preferências salvas — a IA já vai usar isso na próxima mensagem.";
  setTimeout(() => (savedMsg.textContent = ""), 4000);
});

// --- Cache temporário: uploads recentes do usuário ---
let cachePollTimer = null;

async function loadCache() {
  const { data, error } = await supabase
    .from("uploads")
    .select("id, file_url, file_type, analyzed, analysis_result, created_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const list = document.getElementById("cache-list");
  if (error || !data?.length) {
    list.innerHTML = `<p class="hint">Nenhum arquivo enviado ainda.</p>`;
    return;
  }

  list.innerHTML = data
    .map(
      (u) => `
      <div class="feed-card">
        <h3>${escapeHtml(u.file_type || "arquivo")}</h3>
        <p>${u.analyzed ? "✅ Analisado" : "⏳ Em análise"} — ${new Date(u.created_at).toLocaleString("pt-BR")}</p>
        ${u.analyzed && u.analysis_result ? `<p class="analysis-result">${escapeHtml(u.analysis_result)}</p>` : ""}
      </div>`
    )
    .join("");

  // Se ainda há item em análise, busca de novo em alguns segundos — sem isso,
  // o usuário só via o resultado se saísse da tela e voltasse manualmente.
  clearTimeout(cachePollTimer);
  if (data.some((u) => !u.analyzed)) {
    cachePollTimer = setTimeout(() => {
      if (!document.getElementById("cache-view").classList.contains("hidden")) loadCache();
    }, 4000);
  }
}
