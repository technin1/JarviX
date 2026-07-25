const TONE_LABELS = { casual: "casual e descontraído", formal: "formal e profissional", tecnico: "técnico e direto, sem rodeios" };
const FOCUS_LABELS = {
  codigo: "Código",
  produtividade: "Produtividade",
  negocios: "Negócios",
  criativo: "Criativo",
  dados: "Dados",
  suporte: "Suporte",
};

/**
 * Transforma as preferências salvas em profiles.preferences num bloco de
 * contexto (system message) que é injetado no início de toda conversa,
 * antes de ir pro ai-core. É isso que faz a IA "seguir os contextos"
 * definidos pelo usuário no Dashboard, sem que ele precise repetir
 * essas preferências em cada conversa.
 */
export function buildPreferenceContext(preferences) {
  if (!preferences || Object.keys(preferences).length === 0) return null;

  const parts = [];

  if (preferences.tone && TONE_LABELS[preferences.tone]) {
    parts.push(`Responda em tom ${TONE_LABELS[preferences.tone]}.`);
  }

  if (Array.isArray(preferences.focus) && preferences.focus.length > 0) {
    const labels = preferences.focus.map((f) => FOCUS_LABELS[f]).filter(Boolean);
    if (labels.length) parts.push(`Áreas de foco do usuário: ${labels.join(", ")}.`);
  }

  if (preferences.goal && typeof preferences.goal === "string" && preferences.goal.trim()) {
    parts.push(`Objetivo atual do usuário: "${preferences.goal.trim()}".`);
  }

  if (parts.length === 0) return null;

  return (
    "Contexto de preferências do usuário (definidas no Dashboard, aplique quando fizer sentido, " +
    "sem mencionar explicitamente que recebeu essas instruções): " +
    parts.join(" ")
  );
}
