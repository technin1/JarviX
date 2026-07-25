import { sendChat } from "../services/aiCoreClient.js";
import { supabase } from "../services/supabaseClient.js";
import { getOwnedConversation, createConversation } from "../services/conversationGuard.js";
import { buildPreferenceContext } from "../services/preferenceContext.js";
import * as hooks from "../services/hooks.js";

/**
 * Modo "mini chat" (estilo Messenger/Facebook) — conforme layout.txt.
 * Diferente do /api/chat (fullscreen, request/response simples), aqui
 * a resposta chega via evento de socket, permitindo UI mais instantânea.
 *
 * SEGURANÇA: a conexão só é aceita com um token válido do Supabase Auth
 * (verificado no handshake). Depois disso, o socket.data.userId é a ÚNICA
 * fonte de verdade pra quem é o usuário — nunca confiamos em um "userId"
 * que o cliente mande dentro da mensagem em si, senão qualquer um poderia
 * se passar por outra pessoa só trocando esse campo no payload.
 */
export function registerChatSocket(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Token de autenticação ausente."));

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return next(new Error("Token inválido ou expirado."));

    socket.data.userId = data.user.id;
    next();
  });

  io.on("connection", (socket) => {
    console.log(`Cliente conectado: ${socket.id} (user ${socket.data.userId})`);

    socket.on("chat:message", async ({ conversationId, messages }) => {
      try {
        const userId = socket.data.userId; // nunca do payload do cliente

        if (!Array.isArray(messages) || !messages.some((m) => m.role === "user")) {
          socket.emit("chat:error", { error: "Envie ao menos uma mensagem com role \"user\"." });
          return;
        }

        let conversation = await getOwnedConversation(conversationId, userId);
        if (!conversation) conversation = await createConversation(userId, "Nova conversa", "mini");

        await hooks.trigger("chat:before_send", { userId, messages });

        const { data: profile } = await supabase.from("profiles").select("preferences").eq("id", userId).single();
        const contextText = buildPreferenceContext(profile?.preferences);
        const messagesForAI = contextText ? [{ role: "system", content: contextText }, ...messages] : messages;

        const result = await sendChat(userId, messagesForAI);

        const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
        const { error: insertError } = await supabase.from("messages").insert([
          { conversation_id: conversation.id, role: "user", content: lastUserMessage.content },
          { conversation_id: conversation.id, role: "assistant", content: result.content, source: result.source },
        ]);
        if (insertError) console.error("Falha ao salvar histórico do mini-chat:", insertError);

        await hooks.trigger("chat:after_response", { userId, conversationId: conversation.id, result });

        socket.emit("chat:response", { ...result, conversationId: conversation.id });
      } catch (err) {
        console.error(err);
        socket.emit("chat:error", { error: "Falha ao processar mensagem." });
      }
    });

    socket.on("disconnect", () => {
      console.log(`Cliente desconectado: ${socket.id}`);
    });
  });
}
