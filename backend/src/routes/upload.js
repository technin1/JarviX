import { Router } from "express";
import multer from "multer";
import { supabase } from "../services/supabaseClient.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { uploadQueue } from "../queues/uploadQueue.js";

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// POST /api/upload  (multipart/form-data: file, conversationId)
router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

    // originalname vem do cliente sem sanitização — sem isso, um nome tipo
    // "../outra_pasta/arquivo" poderia criar caminhos inesperados dentro do
    // bucket (mesmo restrito ao prefixo do próprio usuário).
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const path = `${userId}/${Date.now()}_${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(path, file.buffer, { contentType: file.mimetype });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = supabase.storage.from("uploads").getPublicUrl(path);

    const { data: uploadRow } = await supabase
      .from("uploads")
      .insert({
        user_id: userId,
        conversation_id: conversationId,
        file_url: publicUrl.publicUrl,
        file_type: file.mimetype,
      })
      .select()
      .single();

    // Análise do arquivo (ex: descrever imagem, revisar código) é potencialmente
    // pesada — não travamos a resposta do upload esperando isso. Vai pra fila.
    await uploadQueue.add("analyze-upload", { uploadId: uploadRow.id, fileUrl: publicUrl.publicUrl, fileType: file.mimetype });

    res.json({ url: publicUrl.publicUrl, type: file.mimetype, status: "queued_for_analysis" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha no upload." });
  }
});

export default router;
