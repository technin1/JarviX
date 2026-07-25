// Scripting Teacher — módulo de treino de digitação de código.
//
// Modelo do editor (painel superior): o texto vive em duas partes.
//   1) região "fantasma" (ghostChars, tamanho fixo por exercício): cada
//      posição tem, opcionalmente, um caractere digitado por cima (typed[i]).
//      Digitar SEMPRE sobrescreve a posição atual do cursor (nunca insere) —
//      é o comportamento pedido: "a letra digitada substitui a letra
//      fantasma na mesma posição".
//   2) região "extra": se o usuário continuar digitando além do fim do
//      fantasma, o texto simplesmente é acrescentado (sem fantasma).
//
// O painel inferior é só leitura, alimentado pela IA a cada Enter.
// O chat de prompt é isolado dos dois painéis: só serve para pedir a geração
// de um novo código-fantasma.

import { authHeader } from "./auth.js";

const API = "/api/scripting";

let initialized = false;

// Estado do exercício atual
let nowSessionId = null;
let ghostChars = []; // array de 1 caractere cada
let typed = []; // mesmo tamanho de ghostChars; null = ainda fantasma
let extra = ""; // texto digitado além do fim do fantasma
let cursor = 0; // posição dentro de ghostChars (0..ghostChars.length); se >= length, resto vira "extra"
let dirty = false; // há conteúdo digitado ainda não exportado
let autosaveTimer = null;
let pendingAction = null; // ação aguardando confirmação no modal

// Elementos
let editorEl, suggestionsEl, titleInput, languageSelect, saveIndicator;

export function loadScriptingTeacher() {
  if (!initialized) {
    initialized = true;
    setupDom();
  }
  refreshNow();
  refreshLastSession();
  refreshSessions();
  refreshArchives();
  refreshProjects();
}

function setupDom() {
  editorEl = document.getElementById("st-editor");
  suggestionsEl = document.getElementById("st-suggestions");
  titleInput = document.getElementById("st-session-title");
  languageSelect = document.getElementById("st-language");
  saveIndicator = document.getElementById("st-save-indicator");

  // ---- editor: teclado ----
  editorEl.addEventListener("keydown", onEditorKeydown);
  editorEl.addEventListener("click", () => editorEl.focus());

  // ---- bloqueio de cópia (Ctrl+C / seleção) ----
  // Treino não pode ser "resolvido" copiando o código-fantasma pra fora e
  // colando de volta já pronto.
  editorEl.addEventListener("copy", (e) => e.preventDefault());
  editorEl.addEventListener("cut", (e) => e.preventDefault());
  editorEl.addEventListener("contextmenu", (e) => e.preventDefault());
  editorEl.addEventListener("selectstart", (e) => e.preventDefault());
  editorEl.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === "c" || key === "x" || key === "a")) {
      e.preventDefault();
    }
  });

  // ---- subpastas ----
  const toggleTargets = {
    last: "st-last-session",
    sessions: "st-sessions-list",
    archives: "st-archives-list",
    projects: "st-projects-panel",
  };
  document.querySelectorAll("[data-st-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(toggleTargets[btn.dataset.stToggle])?.classList.toggle("hidden");
    });
  });

  document.getElementById("st-new-session-btn").addEventListener("click", () => {
    confirmIfDirty(() => startNewSession());
  });

  document.getElementById("st-export-btn").addEventListener("click", exportToArchives);

  // ---- chat isolado (pedir código-fantasma novo) ----
  const promptForm = document.getElementById("st-prompt-form");
  const promptInput = document.getElementById("st-prompt-input");
  promptInput.addEventListener("input", () => {
    promptInput.style.height = "auto";
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 90)}px`;
  });
  promptForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = promptInput.value.trim();
    if (!text) return;
    confirmIfDirty(() => requestGhost(text, promptInput));
  });

  titleInput.addEventListener("change", () => scheduleAutosave());
  languageSelect.addEventListener("change", () => scheduleAutosave());

  // ---- upload de projetos (.zip) ----
  document.getElementById("st-project-upload").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await uploadProject(file);
    e.target.value = "";
  });

  // ---- modal de confirmação ----
  document.getElementById("st-confirm-save").addEventListener("click", async () => {
    hideConfirmModal();
    await exportToArchives();
    await finalizeNow("save");
    pendingAction?.();
    pendingAction = null;
  });
  document.getElementById("st-confirm-discard").addEventListener("click", async () => {
    hideConfirmModal();
    await finalizeNow("discard");
    pendingAction?.();
    pendingAction = null;
  });
  document.getElementById("st-confirm-cancel").addEventListener("click", () => {
    hideConfirmModal();
    pendingAction = null;
  });
}

function confirmIfDirty(action) {
  if (!dirty) return action();
  pendingAction = action;
  document.getElementById("st-confirm-modal").classList.remove("hidden");
}
function hideConfirmModal() {
  document.getElementById("st-confirm-modal").classList.add("hidden");
}

// ---------- Now: carregar / renderizar ----------

async function refreshNow() {
  const res = await authedFetch("/now");
  if (!res) return;
  const data = await res.json();
  loadIntoNow(data);
}

// Recebe uma sessão do backend e monta o estado local do editor a partir dela.
function loadIntoNow(session) {
  nowSessionId = session.id;
  titleInput.value = session.title || "";
  languageSelect.value = session.language || "javascript";

  const ghost = session.ghost_content || "";
  const content = session.content || "";
  const cursorPos = Math.min(session.cursor_pos || 0, ghost.length);

  ghostChars = ghost.split("");
  typed = ghostChars.map((_, i) => (i < cursorPos ? content[i] ?? ghostChars[i] : null));
  extra = content.length > ghost.length ? content.slice(ghost.length) : "";
  cursor = cursorPos;

  dirty = content.trim().length > 0;
  clearSuggestions("Comece a digitar no painel de cima; as sugestões aparecem aqui a cada linha finalizada.");
  render();
  updateSaveIndicator();
}

function render() {
  const frag = document.createDocumentFragment();
  ghostChars.forEach((ch, i) => {
    const span = document.createElement("span");
    const isTyped = typed[i] !== null;
    span.className = isTyped ? "st-typed" : "st-ghost";
    if (i === cursor) span.classList.add("st-cursor");
    span.textContent = isTyped ? typed[i] : ch;
    frag.appendChild(span);
  });

  extra.split("").forEach((ch, i) => {
    const absoluteIndex = ghostChars.length + i;
    const span = document.createElement("span");
    span.className = "st-extra";
    if (absoluteIndex === cursor) span.classList.add("st-cursor");
    span.textContent = ch;
    frag.appendChild(span);
  });

  // Cursor no fim absoluto do texto (depois do último caractere)
  if (cursor >= ghostChars.length + extra.length) {
    const caret = document.createElement("span");
    caret.className = "st-cursor";
    caret.textContent = "\u200b"; // espaço zero-width só pra ter onde desenhar o cursor
    frag.appendChild(caret);
  }

  editorEl.innerHTML = "";
  editorEl.appendChild(frag);
}

function renderedText(uptoCursor = false) {
  const merged = ghostChars.map((ch, i) => (typed[i] !== null ? typed[i] : ch)).join("") + extra;
  if (!uptoCursor) return merged;
  return merged.slice(0, cursor);
}

// ---------- Editor: digitação ----------

function onEditorKeydown(e) {
  const key = e.key;

  if ((e.ctrlKey || e.metaKey) && key.length === 1) return; // atalhos tratados à parte

  if (key === "Backspace") {
    e.preventDefault();
    handleBackspace();
    return;
  }

  if (key === "Enter") {
    e.preventDefault();
    handleTypedChar("\n");
    onLineFinished();
    return;
  }

  if (key === "Tab") {
    e.preventDefault();
    "  ".split("").forEach((c) => handleTypedChar(c));
    return;
  }

  // Só caracteres imprimíveis de 1 posição (letras, números, símbolos, espaço)
  if (key.length === 1) {
    e.preventDefault();
    handleTypedChar(key);
  }
}

function handleTypedChar(ch) {
  if (cursor < ghostChars.length) {
    typed[cursor] = ch; // sobrescreve a posição do fantasma
  } else {
    extra += ch; // além do fantasma: acrescenta livremente
  }
  cursor++;
  dirty = true;
  render();
  scheduleAutosave();
}

function handleBackspace() {
  if (cursor === 0) return;
  cursor--;
  if (cursor < ghostChars.length) {
    typed[cursor] = null; // volta a mostrar o fantasma nessa posição
  } else {
    extra = extra.slice(0, -1);
  }
  render();
  scheduleAutosave();
}

function onLineFinished() {
  const fullText = renderedText(true);
  const lastNewline = fullText.lastIndexOf("\n", fullText.length - 2);
  const lastLine = fullText.slice(lastNewline + 1, fullText.length - 1);
  if (!lastLine.trim()) return;
  fetchSuggestions(fullText, lastLine);
}

// ---------- Painel inferior: sugestões da IA ----------

async function fetchSuggestions(context, lastLine) {
  renderSuggestionsLoading();
  const res = await authedFetch("/suggest", {
    method: "POST",
    body: JSON.stringify({ context, lastLine, language: languageSelect.value }),
  });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) return renderSuggestionsError(data.error);
  renderSuggestions(data.suggestions || []);
}

function renderSuggestionsLoading() {
  suggestionsEl.innerHTML = `<p class="hint">Pensando em alternativas...</p>`;
}
function renderSuggestionsError(msg) {
  suggestionsEl.innerHTML = `<p class="error-text">${escapeHtml(msg || "Falha ao buscar sugestões.")}</p>`;
}
function clearSuggestions(hint) {
  suggestionsEl.innerHTML = `<p class="hint">${escapeHtml(hint)}</p>`;
}

function renderSuggestions(suggestions) {
  suggestionsEl.innerHTML = "";
  if (!suggestions.length) {
    suggestionsEl.innerHTML = `<p class="hint">Sem sugestões para esta linha.</p>`;
    return;
  }
  const group = document.createElement("div");
  group.className = "st-suggestion-group";
  const title = document.createElement("div");
  title.className = "st-suggestion-group-title";
  title.textContent = "Clique para inserir como próxima linha:";
  group.appendChild(title);

  suggestions.forEach((s) => {
    const el = document.createElement("div");
    el.className = "st-suggestion";
    el.textContent = s;
    el.addEventListener("click", () => acceptSuggestion(s));
    group.appendChild(el);
  });
  suggestionsEl.appendChild(group);
}

// Clicar numa sugestão "consome" o restante do fantasma a partir do cursor
// (o exercício original termina ali) e insere a sugestão como texto normal,
// já digitado, na região "extra" — o usuário segue treinando dali em diante.
function acceptSuggestion(text) {
  if (cursor < ghostChars.length) {
    ghostChars = ghostChars.slice(0, cursor);
    typed = typed.slice(0, cursor);
  }
  extra += (extra && !extra.endsWith("\n") ? "\n" : "") + text + "\n";
  cursor = ghostChars.length + extra.length;
  dirty = true;
  render();
  scheduleAutosave();
  onLineFinished();
}

// ---------- Chat isolado: gerar novo código-fantasma ----------

async function requestGhost(prompt, inputEl) {
  const logEl = document.getElementById("st-prompt-log");
  logEl.classList.remove("hidden");
  appendPromptLog("Você", prompt);
  inputEl.value = "";
  inputEl.style.height = "auto";
  appendPromptLog("IA", "Gerando exercício...", true);

  const res = await authedFetch("/ghost", {
    method: "POST",
    body: JSON.stringify({ prompt, language: languageSelect.value }),
  });
  removeLastPromptLog();

  if (!res) return;
  const data = await res.json();
  if (!res.ok) {
    appendPromptLog("IA", data.error || "Falha ao gerar o código-fantasma.", true);
    return;
  }

  appendPromptLog("IA", "Exercício pronto — sobrescreva no painel de cima.");

  ghostChars = (data.content || "").split("");
  typed = ghostChars.map(() => null);
  extra = "";
  cursor = 0;
  dirty = false;
  render();
  clearSuggestions("Comece a digitar no painel de cima; as sugestões aparecem aqui a cada linha finalizada.");
  await saveNow({ ghostContent: data.content, content: data.content, cursorPos: 0 });
  editorEl.focus();
}

function appendPromptLog(who, text, transient = false) {
  const logEl = document.getElementById("st-prompt-log");
  const line = document.createElement("div");
  line.textContent = `${who}: ${text}`;
  if (transient) line.dataset.transient = "1";
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function removeLastPromptLog() {
  const logEl = document.getElementById("st-prompt-log");
  const transient = logEl.querySelector('[data-transient="1"]');
  transient?.remove();
}

// ---------- Autosave ----------

function scheduleAutosave() {
  updateSaveIndicator("Digitando...");
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveNow(), 900);
}

async function saveNow(overrides = {}) {
  const payload = {
    title: titleInput.value,
    language: languageSelect.value,
    content: renderedText(),
    ghostContent: ghostChars.join(""),
    cursorPos: cursor,
    ...overrides,
  };
  const res = await authedFetch("/now", { method: "PUT", body: JSON.stringify(payload) });
  if (res && res.ok) updateSaveIndicator("Salvo");
}

function updateSaveIndicator(text) {
  saveIndicator.textContent = text || (dirty ? "Não exportado" : "");
}

// ---------- New Session ----------

async function startNewSession() {
  await finalizeNow("discard");
}

async function finalizeNow(action) {
  const res = await authedFetch("/now/new", {
    method: "POST",
    body: JSON.stringify({ action, title: titleInput.value }),
  });
  if (!res) return;
  const data = await res.json();
  loadIntoNow(data);
  refreshLastSession();
  refreshSessions();
  refreshArchives();
}

// ---------- Last Session / Sessions ----------

async function refreshLastSession() {
  const res = await authedFetch("/sessions/last");
  const container = document.getElementById("st-last-session");
  if (!res) return;
  const data = await res.json();
  if (!data) {
    container.innerHTML = `<p class="hint">Nenhuma sessão salva ainda.</p>`;
    return;
  }
  container.innerHTML = "";
  container.appendChild(buildSessionItem(data));
}

async function refreshSessions() {
  const res = await authedFetch("/sessions");
  const container = document.getElementById("st-sessions-list");
  if (!res) return;
  const data = await res.json();
  container.innerHTML = "";
  if (!data.length) {
    container.innerHTML = `<p class="hint">Nenhuma sessão ainda.</p>`;
    return;
  }
  data.forEach((s) => container.appendChild(buildSessionItem(s)));
}

function buildSessionItem(session) {
  const item = document.createElement("div");
  item.className = "st-item";
  const name = document.createElement("span");
  name.className = "st-item-name";
  name.textContent = `${session.title || "Sessão sem título"} (${session.language})`;
  item.appendChild(name);
  item.addEventListener("click", () => {
    confirmIfDirty(() => loadSessionIntoNow(session.id));
  });
  return item;
}

async function loadSessionIntoNow(sessionId) {
  const res = await authedFetch(`/sessions/${sessionId}/load`, { method: "POST" });
  if (!res) return;
  const data = await res.json();
  loadIntoNow(data);
  editorEl.focus();
}

// ---------- My Archives ----------

async function refreshArchives() {
  const res = await authedFetch("/archives");
  const container = document.getElementById("st-archives-list");
  const counter = document.getElementById("st-archives-count");
  if (!res) return;
  const data = await res.json();

  counter.textContent = `${data.length}/15`;
  counter.classList.toggle("badge-full", data.length >= 15);

  container.innerHTML = "";
  if (!data.length) {
    container.innerHTML = `<p class="hint">Nenhum arquivo exportado ainda.</p>`;
    return;
  }

  data.forEach((archive) => {
    const item = document.createElement("div");
    item.className = "st-item";

    const name = document.createElement("span");
    name.className = "st-item-name";
    name.textContent = archive.filename;
    item.appendChild(name);

    const actions = document.createElement("span");
    actions.className = "st-item-actions";

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.title = "Baixar";
    downloadBtn.textContent = "⬇";
    downloadBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const headers = await authHeader();
      const res = await fetch(`${API}/archives/${archive.id}/download`, { headers });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = archive.filename;
      a.click();
      URL.revokeObjectURL(url);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.title = "Excluir";
    deleteBtn.textContent = "🗑";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await authedFetch(`/archives/${archive.id}`, { method: "DELETE" });
      refreshArchives();
    });

    actions.append(downloadBtn, deleteBtn);
    item.appendChild(actions);

    item.addEventListener("click", () => confirmIfDirty(() => loadArchiveIntoNow(archive)));
    container.appendChild(item);
  });
}

async function loadArchiveIntoNow(archive) {
  // O conteúdo completo do arquivo não vem na listagem — busca via download
  // e reaproveita como novo código-fantasma no Now.
  const headers = await authHeader();
  const res = await fetch(`${API}/archives/${archive.id}/download`, { headers });
  if (!res.ok) return;
  const content = await res.text();

  ghostChars = content.split("");
  typed = ghostChars.map(() => null);
  extra = "";
  cursor = 0;
  dirty = false;
  titleInput.value = archive.filename;
  languageSelect.value = archive.language || "javascript";
  render();
  clearSuggestions("Comece a digitar no painel de cima; as sugestões aparecem aqui a cada linha finalizada.");
  await saveNow({ title: archive.filename, language: archive.language, ghostContent: content, content, cursorPos: 0 });
  editorEl.focus();
}

async function exportToArchives() {
  const filename = titleInput.value.trim() || `codigo_${Date.now()}.txt`;
  const res = await authedFetch("/archives", { method: "POST", body: JSON.stringify({ filename }) });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) {
    updateSaveIndicator(data.error || "Falha ao exportar.");
    return;
  }
  dirty = false;
  updateSaveIndicator("Exportado para My Archives");
  refreshArchives();
}

// ---------- Projects ----------

async function refreshProjects() {
  const res = await authedFetch("/projects");
  const container = document.getElementById("st-projects-list");
  if (!res) return;
  const data = await res.json();
  container.innerHTML = "";
  if (!data.length) {
    container.innerHTML = `<p class="hint">Nenhum projeto enviado ainda.</p>`;
    return;
  }
  data.forEach((project) => container.appendChild(buildProjectItem(project)));
}

function buildProjectItem(project) {
  const wrapper = document.createElement("div");

  const item = document.createElement("div");
  item.className = "st-item";
  const name = document.createElement("span");
  name.className = "st-item-name";
  name.textContent = `📦 ${project.name}`;
  item.appendChild(name);
  wrapper.appendChild(item);

  const filesEl = document.createElement("div");
  filesEl.className = "st-project-files hidden";
  (project.entries || []).forEach((entry) => {
    const fileEl = document.createElement("div");
    fileEl.className = "st-project-file";
    fileEl.textContent = entry.path;
    // "Selecionará o arquivo com dois cliques e será direcionado ao Now."
    fileEl.addEventListener("dblclick", () => {
      confirmIfDirty(() => openProjectFile(project.id, entry.path));
    });
    filesEl.appendChild(fileEl);
  });
  wrapper.appendChild(filesEl);

  item.addEventListener("click", () => filesEl.classList.toggle("hidden"));
  return wrapper;
}

async function uploadProject(file) {
  const formData = new FormData();
  formData.append("file", file);
  const headers = await authHeader();
  const res = await fetch(`${API}/projects`, { method: "POST", headers, body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Falha ao enviar o projeto.");
    return;
  }
  refreshProjects();
}

async function openProjectFile(projectId, path) {
  const res = await authedFetch(`/projects/${projectId}/open`, { method: "POST", body: JSON.stringify({ path }) });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) return;
  loadIntoNow(data);
  editorEl.focus();
}

// ---------- Utilidades ----------

async function authedFetch(path, options = {}) {
  try {
    const headers = { "Content-Type": "application/json", ...(await authHeader()) };
    const res = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    return res;
  } catch (err) {
    console.error("Scripting Teacher — falha de rede:", err);
    return null;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
