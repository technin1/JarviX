import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { listManifests, setPluginEnabled } from "../services/pluginLoader.js";

const router = Router();

router.use(requireAuth, requireAdmin);

// GET /api/admin/finetune-examples?status=pending|approved
// Lista candidatos gerados por ai-core/finetune/data_prep.py aguardando revisão.
router.get("/finetune-examples", async (req, res) => {
  const status = req.query.status || "pending";
  let query = supabase.from("finetune_examples").select("*").order("created_at", { ascending: false });
  query = status === "approved" ? query.eq("approved", true) : query.eq("approved", false);

  const { data, error } = await query.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/admin/finetune-examples/:id/approve
router.post("/finetune-examples/:id/approve", async (req, res) => {
  const { error } = await supabase
    .from("finetune_examples")
    .update({ approved: true })
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: "approved" });
});

// DELETE /api/admin/finetune-examples/:id — rejeita/descarta o exemplo
router.delete("/finetune-examples/:id", async (req, res) => {
  const { error } = await supabase.from("finetune_examples").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: "rejected" });
});

// GET /api/admin/plugins — lista plugins instalados e seu estado atual
router.get("/plugins", (_req, res) => {
  res.json(listManifests());
});

// PUT /api/admin/plugins/:dirName  { enabled: true|false }
// Requer reiniciar o backend/worker para o código do plugin ser
// efetivamente carregado ou descarregado — ver aviso na resposta.
router.put("/plugins/:dirName", (req, res) => {
  try {
    const manifest = setPluginEnabled(req.params.dirName, !!req.body.enabled);
    res.json({
      ...manifest,
      warning: "Reinicie o backend e o worker (docker compose restart backend worker) para aplicar.",
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
