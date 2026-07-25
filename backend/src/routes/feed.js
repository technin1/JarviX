import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// GET /api/feed — lista pública, não precisa estar logado pra ver
router.get("/", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("shared_projects")
      .select("id, title, description, prompt, files_zip_url, created_at, owner_id, profiles(username)")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao carregar o feed." });
  }
});

// POST /api/feed  { title, description, prompt, isPublic, filesZipUrl }
router.post("/", requireAuth, async (req, res) => {
  try {
    const { title, description, prompt, isPublic, filesZipUrl } = req.body;
    const { data, error } = await supabase
      .from("shared_projects")
      .insert({
        owner_id: req.user.id,
        title,
        description,
        prompt,
        files_zip_url: filesZipUrl || null,
        is_public: !!isPublic,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao compartilhar projeto." });
  }
});

export default router;
