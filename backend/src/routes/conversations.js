import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createConversation } from "../services/conversationGuard.js";

const router = Router();
router.use(requireAuth);

// POST /api/conversations  { title?, mode? } — cria uma conversa nova, do dono certo
router.post("/", async (req, res) => {
  try {
    const conversation = await createConversation(req.user.id, req.body.title, req.body.mode);
    res.status(201).json(conversation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao criar conversa." });
  }
});

// GET /api/conversations — lista só as conversas do próprio usuário
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, mode, created_at, updated_at")
    .eq("user_id", req.user.id)
    .order("updated_at", { ascending: false });

  if (error) return res.status(500).json({ error: "Falha ao listar conversas." });
  res.json(data);
});

export default router;
