import { supabase } from "../services/supabaseClient.js";

/**
 * Extrai o token "Bearer" do header Authorization, valida com o Supabase
 * e injeta req.user com os dados do usuário autenticado.
 * Sem isso, qualquer um poderia mandar um userId qualquer no corpo da
 * requisição e se passar por outra pessoa.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Token de autenticação ausente." });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }

  req.user = data.user;
  next();
}
