import axios from "axios";

const AI_CORE_URL = process.env.AI_CORE_URL || "http://localhost:8000";

export async function sendChat(userId, messages) {
  const { data } = await axios.post(`${AI_CORE_URL}/chat`, {
    user_id: userId,
    messages,
  });
  return data; // { content, source }
}

export async function generateProject(files, projectName) {
  const response = await axios.post(
    `${AI_CORE_URL}/generate-project`,
    { files, project_name: projectName },
    { responseType: "arraybuffer" }
  );
  return response.data; // buffer do zip
}

export async function analyzeUpload(fileUrl, fileType) {
  const { data } = await axios.post(`${AI_CORE_URL}/analyze-upload`, {
    file_url: fileUrl,
    file_type: fileType,
  });
  return data.analysis;
}

// --- Scripting Teacher ---

// Gera o código-fantasma inicial (painel superior) a partir do prompt curto
// que o usuário manda no chat isolado do módulo.
export async function generateGhostCode(prompt, language) {
  const { data } = await axios.post(`${AI_CORE_URL}/scripting/ghost`, {
    prompt,
    language,
  });
  return data; // { content }
}

// Sugestões/alternativas do painel inferior — chamado a cada linha finalizada
// (Enter) no painel superior. "context" é tudo que o usuário já digitou.
export async function suggestNextLine(context, lastLine, language) {
  const { data } = await axios.post(`${AI_CORE_URL}/scripting/suggest`, {
    context,
    last_line: lastLine,
    language,
  });
  return data; // { suggestions: string[] }
}
