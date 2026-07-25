import { Worker } from "bullmq";
import { redisConnection } from "../queues/connection.js";
import { supabase } from "../services/supabaseClient.js";
import { analyzeUpload } from "../services/aiCoreClient.js";
import * as hooks from "../services/hooks.js";

/**
 * Processa cada upload enfileirado: pede pro ai-core analisar o arquivo
 * (ex: descrever uma imagem, revisar um trecho de código) e salva o
 * resultado. Roda em processo separado do servidor HTTP (ver worker index).
 */
export const uploadWorker = new Worker(
  "upload-analysis",
  async (job) => {
    const { uploadId, fileUrl, fileType } = job.data;

    const analysis = await analyzeUpload(fileUrl, fileType);

    const { data: upload } = await supabase
      .from("uploads")
      .update({ analyzed: true, analysis_result: analysis })
      .eq("id", uploadId)
      .select()
      .single();

    if (upload) await hooks.trigger("upload:after_analysis", { upload });

    return { uploadId, status: "done" };
  },
  { connection: redisConnection, concurrency: 3 }
);

uploadWorker.on("failed", (job, err) => {
  console.error(`Falha ao analisar upload ${job?.id}:`, err.message);
});
