import { getSession, authHeader } from "./auth.js";

const listEl = document.getElementById("list");

async function loadPending() {
  const session = await getSession();
  if (!session) {
    listEl.textContent = "Você precisa estar logado (como admin) para ver esta página.";
    return;
  }

  const res = await fetch("/api/admin/finetune-examples?status=pending", {
    headers: await authHeader(),
  });

  if (res.status === 403) {
    listEl.textContent = "Acesso restrito a administradores.";
    return;
  }

  const examples = await res.json();
  listEl.innerHTML = "";

  if (examples.length === 0) {
    listEl.textContent = "Nenhum exemplo pendente no momento.";
    return;
  }

  examples.forEach((ex) => {
    const card = document.createElement("div");
    card.className = "example-card";
    card.innerHTML = `
      <strong>Prompt:</strong>
      <p>${escapeHtml(ex.prompt)}</p>
      <strong>Resposta:</strong>
      <p>${escapeHtml(ex.completion)}</p>
      <div class="actions">
        <button class="btn-approve" data-id="${ex.id}">Aprovar</button>
        <button class="btn-reject" data-id="${ex.id}">Rejeitar</button>
      </div>
    `;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll(".btn-approve").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/admin/finetune-examples/${btn.dataset.id}/approve`, {
        method: "POST",
        headers: await authHeader(),
      });
      loadPending();
    });
  });

  listEl.querySelectorAll(".btn-reject").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/admin/finetune-examples/${btn.dataset.id}`, {
        method: "DELETE",
        headers: await authHeader(),
      });
      loadPending();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

loadPending();
