import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

// Gerar um projeto completo (vários arquivos, possivelmente grandes) pode
// demorar — o usuário não deve ficar com a requisição HTTP pendurada
// esperando. Ele entra na fila e consulta o status depois (ver routes/download.js).
export const generationQueue = new Queue("project-generation", { connection: redisConnection });
