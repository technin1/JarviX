import { supabase } from "../services/supabaseClient.js";

/**
 * Restringe acesso a usuários com is_admin=true na tabela profiles.
 * Use sempre DEPOIS do requireAuth (precisa de req.user já preenchido).
 */
export async function requireAdmin(req, res, next) {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", req.user.id)
    .single();

  if (error || !data?.is_admin) {
    return res.status(403).json({ error: "Acesso restrito a administradores." });
  }
  next();
}
