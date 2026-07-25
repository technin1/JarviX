import { Worker } from "bullmq";
import { redisConnection } from "../queues/connection.js";
import { scheduleCnhCheck } from "../queues/cnhCheckQueue.js";
import { checkCnhExpirations } from "../jobs/cnhExpirationCheck.js";

const worker = new Worker(
  "cnh-expiration-check",
  async () => {
    console.log("Rodando checagem diária de vencimento de CNH...");
    await checkCnhExpirations();
  },
  { connection: redisConnection }
);

worker.on("failed", (job, err) => {
  console.error(`Checagem de CNH falhou:`, err);
});

// Garante que o agendamento repetível existe assim que o worker sobe.
scheduleCnhCheck();

export default worker;
