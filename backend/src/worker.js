import dotenv from "dotenv";
dotenv.config();

import { loadPlugins } from "./services/pluginLoader.js";

// Plugins precisam estar carregados ANTES dos workers, pois eles disparam
// hooks como "upload:after_analysis" assim que um job termina.
await loadPlugins();

// Importar os workers já os registra e coloca pra escutar a fila.
// Isto roda como um processo/container separado do server.js — ver
// docker-compose.yml (serviço "worker").
import "./workers/uploadWorker.js";
import "./workers/generationWorker.js";
import "./workers/cnhCheckWorker.js";

console.log("JarviX worker rodando — escutando filas: upload-analysis, project-generation, cnh-expiration-check");
