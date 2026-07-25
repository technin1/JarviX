import { supabase } from "./supabaseClient.js";

/**
 * Backend usa a service_role key do Supabase, que IGNORA RLS. Isso significa
 * que a proteção "cada um só acessa o próprio dado" não existe automaticamente
 * aqui — cada rota precisa checar isso na mão. Esta função centraliza a
 * checagem de posse de conversa, usada tanto no /api/chat (REST) quanto no
 * mini-chat (socket), pra não ter a lógica duplicada e divergindo com o tempo.
 *
 * Retorna a conversa se pertence ao usuário, ou null caso contrário
 * (não existe, ou é de outra pessoa).
 */
export async function getOwnedConversation(conversationId, userId) {
  if (!conversationId) return null;
  const { data } = await supabase
    .from("conversations")
    .select("id, user_id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single();
  return data || null;
}

/** Cria uma conversa nova já associada ao dono certo. */
export async function createConversation(userId, title = "Nova conversa", mode = "fullscreen") {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title, mode })
    .select()
    .single();
  if (error) throw error;
  return data;
}
