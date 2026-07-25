import { Router } from "express";
import { generationQueue } from "../queues/generationQueue.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// POST /api/download/project  { files: {"caminho": "conteúdo"}, projectName }
// Não gera na hora — projetos grandes podem demorar. Enfileira e devolve
// um jobId pro frontend consultar o status (padrão "fire and poll").
router.post("/project", requireAuth, async (req, res) => {
  try {
    const { files, projectName } = req.body;
    const job = await generationQueue.add("generate-project", {
      files,
      projectName: projectName || "jarvix_project",
      userId: req.user.id,
    });
    res.json({ jobId: job.id, status: "queued" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao enfileirar a geração do projeto." });
  }
});

// GET /api/download/project/:jobId/status
router.get("/project/:jobId/status", requireAuth, async (req, res) => {
  const job = await generationQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job não encontrado." });

  // Sem isso, qualquer usuário autenticado poderia adivinhar/tentar jobIds
  // alheios e ler o conteúdo de projetos gerados por outra pessoa.
  if (job.data.userId !== req.user.id) {
    return res.status(403).json({ error: "Acesso negado." });
  }

  const state = await job.getState(); // waiting | active | completed | failed
  const result = state === "completed" ? job.returnvalue : null;

  res.json({ status: state, result });
});

export default router;
