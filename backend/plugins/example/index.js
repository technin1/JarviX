/**
 * Plugin de exemplo. Copie esta pasta para criar um plugin novo:
 *   1. Duplique backend/plugins/example/ com outro nome de pasta
 *   2. Edite plugin.json (nome, descrição, e "enabled": true quando pronto)
 *   3. Edite este index.js com a lógica real do seu plugin
 *
 * register(hooks) é chamado uma vez, na subida do backend, com o módulo
 * de hooks (backend/src/services/hooks.js) já pronto pra uso.
 */
export function register(hooks) {
  // Disparado antes de qualquer mensagem ir pro roteador de IA (ai-core).
  // Útil para: filtros de conteúdo, logging, injeção de contexto extra.
  hooks.on("chat:before_send", async ({ userId, messages }) => {
    console.log(`[example-plugin] Usuário ${userId} está prestes a enviar uma mensagem.`);
  });

  // Disparado depois que a IA já respondeu e a mensagem já foi salva.
  // Útil para: analytics, notificações, auditoria.
  hooks.on("chat:after_response", async ({ userId, conversationId, result }) => {
    console.log(`[example-plugin] Resposta gerada via "${result.source}" para o usuário ${userId}.`);
  });

  // Disparado depois que um novo membro é cadastrado no Member Control.
  // Útil para: notificações internas, integrações externas, auditoria de LGPD.
  hooks.on("member:after_create", async ({ member }) => {
    console.log(`[example-plugin] Novo membro cadastrado: ${member.full_name}.`);
  });

  // Disparado depois que a análise de um arquivo enviado no chat termina.
  hooks.on("upload:after_analysis", async ({ upload }) => {
    console.log(`[example-plugin] Upload ${upload.id} terminou a análise.`);
  });
}
