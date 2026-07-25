import { Worker } from "bullmq";
import { redisConnection } from "../queues/connection.js";
import { generateProject } from "../services/aiCoreClient.js";
import { supabase } from "../services/supabaseClient.js";

/**
 * Gera o zip do projeto (pode ser pesado — muitos arquivos, código gerado
 * pela IA) e sobe pro Supabase Storage. O resultado (URL de download) fica
 * disponível via GET /api/download/project/:jobId/status.
 */
export const generationWorker = new Worker(
  "project-generation",
  async (job) => {
    const { files, projectName, userId } = job.data;

    const zipBuffer = await generateProject(files, projectName);

    const path = `${userId}/${Date.now()}_${projectName}.zip`;
    const { error } = await supabase.storage
      .from("generated-projects")
      .upload(path, zipBuffer, { contentType: "application/zip" });

    if (error) throw error;

    const { data: publicUrl } = supabase.storage.from("generated-projects").getPublicUrl(path);

    return { downloadUrl: publicUrl.publicUrl, projectName };
  },
  { connection: redisConnection, concurrency: 2 } // geração de projeto é mais pesada que análise de upload, concorrência menor
);

generationWorker.on("failed", (job, err) => {
  console.error(`Falha ao gerar projeto (job ${job?.id}):`, err.message);
});
