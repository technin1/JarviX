import { supabase } from "./supabaseClient.js";

/**
 * Retorna a sessão atual (ou null se não estiver logado).
 * Usado pelo app.js pra decidir se mostra a tela de login ou o app.
 */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signUp(email, password, username, phone) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;

  // Cria o perfil público (tabela profiles) associado ao usuário recém-criado.
  if (data.user) {
    await supabase.from("profiles").insert({ id: data.user.id, username, phone });
  }
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Header pronto pra usar em fetch() nas rotas protegidas do backend. */
export async function authHeader() {
  const session = await getSession();
  if (!session) throw new Error("Usuário não autenticado.");
  return { Authorization: `Bearer ${session.access_token}` };
}
