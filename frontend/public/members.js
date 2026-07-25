import { authHeader } from "./auth.js";

const API_URL = "/api";

export async function loadMembers() {
  const list = document.getElementById("members-list");
  list.innerHTML = `<p class="hint">Carregando...</p>`;

  const res = await fetch(`${API_URL}/members`, { headers: await authHeader() });
  if (!res.ok) {
    list.innerHTML = `<p class="hint">Falha ao carregar membros (acesso restrito a admins).</p>`;
    return;
  }

  const members = await res.json();
  if (!members.length) {
    list.innerHTML = `<p class="hint">Nenhum membro cadastrado ainda.</p>`;
    return;
  }

  list.innerHTML = members.map(renderMemberRow).join("");
}

function renderMemberRow(m) {
  const days = m.days_until_cnh_expiry;
  let status = "ok", statusLabel = `${days} dias`;
  if (days < 0) { status = "urgent"; statusLabel = "VENCIDA"; }
  else if (days <= 20) { status = "urgent"; statusLabel = `${days} dias — urgente`; }
  else if (days <= 30) { status = "warning"; statusLabel = `${days} dias — atenção`; }
  else if (days <= 60) { status = "warning"; statusLabel = `${days} dias`; }

  return `
    <div class="feed-card member-row">
      <div>
        <h3>${escapeHtml(m.full_name)}</h3>
        <p>${escapeHtml(m.email)} ${m.phone ? "· " + escapeHtml(m.phone) : ""}</p>
      </div>
      <span class="status-badge status-${status}">${statusLabel}</span>
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.getElementById("member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("member-form-error");
  errorEl.textContent = "";

  const formData = new FormData();
  formData.append("full_name", document.getElementById("member-full-name").value);
  formData.append("email", document.getElementById("member-email").value);
  formData.append("phone", document.getElementById("member-phone").value);
  formData.append("whatsapp", document.getElementById("member-whatsapp").value);
  formData.append("cpf", document.getElementById("member-cpf").value);
  formData.append("rg", document.getElementById("member-rg").value);
  formData.append("cnh_number", document.getElementById("member-cnh-number").value);
  formData.append("cnh_issue_date", document.getElementById("member-cnh-issue").value);
  formData.append("cnh_expiry_date", document.getElementById("member-cnh-expiry").value);

  const photoInput = document.getElementById("member-cnh-photo");
  if (photoInput.files[0]) formData.append("cnh_photo", photoInput.files[0]);

  try {
    const res = await fetch(`${API_URL}/members`, {
      method: "POST",
      headers: await authHeader(), // sem Content-Type: multipart é definido pelo browser
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao cadastrar membro.");

    e.target.reset();
    loadMembers();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});
