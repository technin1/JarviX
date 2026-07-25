import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import dotenv from "dotenv";

import chatRoutes from "./routes/chat.js";
import uploadRoutes from "./routes/upload.js";
import downloadRoutes from "./routes/download.js";
import feedRoutes from "./routes/feed.js";
import adminRoutes from "./routes/admin.js";
import membersRoutes from "./routes/members.js";
import conversationsRoutes from "./routes/conversations.js";
import scriptingTeacherRoutes from "./routes/scriptingTeacher.js";
import { registerChatSocket } from "./sockets/chatSocket.js";
import { aiLimiter, uploadLimiter, generalLimiter, scriptingLimiter } from "./middleware/rateLimit.js";
import { loadPlugins } from "./services/pluginLoader.js";

dotenv.config();

const app = express();

app.use(helmet());

// CORS restrito às origens conhecidas — "*" deixaria qualquer site da
// internet fazer requisições autenticadas contra sua API usando um token
// vazado (ex: via XSS em outro lugar). Configure ALLOWED_ORIGINS no .env.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
if (allowedOrigins.length === 0) {
  console.warn("ALLOWED_ORIGINS não configurado no .env — CORS vai bloquear tudo por padrão. Veja .env.example.");
}
const corsOptions = {
  origin(origin, callback) {
    // Requisições sem "origin" (ex: curl, apps mobile nativos) são permitidas;
    // navegadores sempre mandam origin, então isso não abre brecha pra sites.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Origem não permitida por CORS."));
  },
};
app.use(cors(corsOptions));

app.use(express.json({ limit: "10mb" }));
app.use(generalLimiter);

// Camada "ponte": Node só orquestra HTTP/sockets/filas.
// Toda a inteligência de IA vive no serviço Python (ai-core).
app.use("/api/chat", aiLimiter, chatRoutes);
app.use("/api/upload", uploadLimiter, uploadRoutes);
app.use("/api/download", downloadRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/members", membersRoutes);
app.use("/api/conversations", conversationsRoutes);
app.use("/api/scripting", scriptingLimiter, scriptingTeacherRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Handler de erro global — sem isso, erros como o fileFilter do multer
// (upload de tipo de arquivo não permitido) voltam como página HTML de
// erro genérica do Express, em vez de JSON que o frontend sabe tratar.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Requisição inválida." });
});

const server = http.createServer(app);

// Socket.io alimenta o modo "mini chat" (tipo Messenger) com streaming em tempo real.
// CORS aqui segue a mesma lista de origens permitidas do resto da API.
const io = new Server(server, { cors: { origin: allowedOrigins.length ? allowedOrigins : false } });
registerChatSocket(io);

const PORT = process.env.PORT || 3000;

// Carrega e registra nos hooks todos os plugins com "enabled": true em
// backend/plugins/*/plugin.json — ver backend/src/services/pluginLoader.js.
await loadPlugins();

server.listen(PORT, () => {
  console.log(`JarviX backend rodando na porta ${PORT}`);
});
