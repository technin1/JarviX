import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

// Uploads (fotos, código, documentos) podem exigir análise da IA — algo que
// não deve travar a resposta HTTP do upload em si.
export const uploadQueue = new Queue("upload-analysis", { connection: redisConnection });
