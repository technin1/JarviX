import rateLimit from "express-rate-limit";

/**
 * Sem isso, um usuário autenticado (ou um token vazado) poderia disparar
 * milhares de requisições pro /api/chat em minutos — cada uma custa uma
 * chamada real à API da Groq, ou seja, é dinheiro saindo da sua conta,
 * fora o risco de estourar rate limit deles e derrubar o serviço pra todo mundo.
 */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20, // 20 mensagens de chat por minuto por IP — ajuste conforme seu uso real
  message: { error: "Muitas requisições. Aguarde um instante e tente de novo." },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Uploads são mais pesados (I/O, storage, fila de análise) — limite mais apertado. */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Muitos uploads em pouco tempo. Aguarde um instante." },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Scripting Teacher: /suggest é chamado a cada Enter no painel superior
 * (bem mais frequente que uma mensagem normal de chat), então usa um teto
 * mais alto que o aiLimiter — mas ainda limitado, já que cada chamada bate
 * no ai-core/Groq de verdade.
 */
export const scriptingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Muitas requisições ao Scripting Teacher. Aguarde um instante." },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Limite geral, mais frouxo, pra todas as outras rotas — proteção básica. */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
