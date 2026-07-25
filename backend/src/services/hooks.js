/**
 * Sistema de hooks, no mesmo espírito do hooks.php do MyAAC: pontos fixos
 * no código onde plugins podem se acoplar sem precisar editar as rotas
 * principais. Cada hook é disparado em sequência, aguardando plugins
 * assíncronos, na ordem em que foram registrados.
 *
 * Hooks disponíveis hoje (ver onde são disparados no código):
 *   - "chat:before_send"    (payload: { userId, messages })
 *   - "chat:after_response" (payload: { userId, conversationId, result })
 *   - "member:after_create" (payload: { member })
 *   - "upload:after_analysis" (payload: { upload })
 *
 * Plugins não devem lançar exceção que derrube a requisição principal —
 * erros de um plugin são isolados e apenas logados (ver trigger() abaixo).
 */

const listeners = new Map(); // hookName -> [fn, fn, ...]

export function on(hookName, fn) {
  if (!listeners.has(hookName)) listeners.set(hookName, []);
  listeners.get(hookName).push(fn);
}

export async function trigger(hookName, payload) {
  const fns = listeners.get(hookName) || [];
  for (const fn of fns) {
    try {
      await fn(payload);
    } catch (err) {
      // Um plugin com bug não pode derrubar o fluxo principal do produto.
      console.error(`[hooks] Plugin falhou no hook "${hookName}":`, err);
    }
  }
}

export function listHooks() {
  return [...listeners.keys()];
}
