import { Router } from "express";
import { sendChat } from "../services/aiCoreClient.js";
import { supabase } from "../services/supabaseClient.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getOwnedConversation, createConversation } from "../services/conversationGuard.js";
import { buildPreferenceContext } from "../services/preferenceContext.js";
import * as hooks from "../services/hooks.js";

const router = Router();

// POST /api/chat  { conversationId?, messages }
// Requer header: Authorization: Bearer <token do Supabase Auth>
router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { messages } = req.body;
    let { conversationId } = req.body;

    if (!Array.isArray(messages) || !messages.some((m) => m.role === "user")) {
      return res.status(400).json({ error: "Envie ao menos uma mensagem com role \"user\"." });
    }

    // Nunca confia às cegas no conversationId do corpo da requisição —
    // se não pertence a este usuário (ou não existe), cria uma nova em
    // vez de deixar escrever numa conversa de outra pessoa.
    let conversation = await getOwnedConversation(conversationId, userId);
    if (!conversation) {
      conversation = await createConversation(userId);
    }
    conversationId = conversation.id;

    await hooks.trigger("chat:before_send", { userId, messages });

    // Injeta as preferências definidas no Dashboard como contexto — não é
    // persistido no histórico, só usado para moldar esta resposta.
    const { data: profile } = await supabase.from("profiles").select("preferences").eq("id", userId).single();
    const contextText = buildPreferenceContext(profile?.preferences);
    const messagesForAI = contextText ? [{ role: "system", content: contextText }, ...messages] : messages;

    const result = await sendChat(userId, messagesForAI);

    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    const { error: insertError } = await supabase.from("messages").insert([
      { conversation_id: conversationId, role: "user", content: lastUserMessage.content },
      { conversation_id: conversationId, role: "assistant", content: result.content, source: result.source },
    ]);
    if (insertError) console.error("Falha ao salvar histórico da conversa:", insertError);

    await hooks.trigger("chat:after_response", { userId, conversationId, result });

    res.json({ ...result, conversationId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao processar chat." });
  }
});

export default router;
