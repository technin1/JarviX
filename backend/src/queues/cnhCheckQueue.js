import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

export const cnhCheckQueue = new Queue("cnh-expiration-check", { connection: redisConnection });

// Chame isso uma vez na subida do worker (ver workers/cnhCheckWorker.js).
// Repeatable jobs do BullMQ são idempotentes por chave — rodar de novo não
// duplica o agendamento.
export async function scheduleCnhCheck() {
  await cnhCheckQueue.add(
    "daily-check",
    {},
    {
      repeat: { pattern: "0 8 * * *" }, // todo dia às 08:00 (horário do container)
      jobId: "cnh-daily-check", // fixo, evita duplicar agendamentos em restarts
    }
  );
}
