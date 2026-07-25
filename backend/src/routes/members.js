import { Router } from "express";
import multer from "multer";
import { supabase } from "../services/supabaseClient.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import * as hooks from "../services/hooks.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("A foto da CNH precisa ser uma imagem (JPG, PNG, etc.)."));
    }
    cb(null, true);
  },
});

router.use(requireAuth, requireAdmin);

const REQUIRED_FIELDS = [
  "full_name", "email", "cpf", "rg",
  "cnh_number", "cnh_issue_date", "cnh_expiry_date",
];

// originalname vem do cliente sem sanitização — sem isso, um nome de arquivo
// como "../outra_pasta/foto.jpg" poderia gerar um caminho inesperado dentro
// do bucket privado.
function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function validateMember(body) {
  const missing = REQUIRED_FIELDS.filter((f) => !body[f]?.trim());
  if (missing.length) return `Campos obrigatórios faltando: ${missing.join(", ")}`;

  const cpfDigits = body.cpf.replace(/\D/g, "");
  if (cpfDigits.length !== 11) return "CPF inválido — precisa ter 11 dígitos.";

  if (new Date(body.cnh_expiry_date) <= new Date(body.cnh_issue_date)) {
    return "Data de validade da CNH precisa ser posterior à data de emissão.";
  }

  return null;
}

// POST /api/members — cria membro (foto da CNH é obrigatória)
router.post("/", upload.single("cnh_photo"), async (req, res) => {
  try {
    const validationError = validateMember(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    if (!req.file) return res.status(400).json({ error: "Foto da CNH é obrigatória." });

    const path = `${crypto.randomUUID()}_${safeFileName(req.file.originalname)}`;
    const { error: uploadError } = await supabase.storage
      .from("member-documents") // bucket PRIVADO — confira no Supabase Storage
      .upload(path, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase.from("members").insert({
      full_name: req.body.full_name,
      email: req.body.email,
      phone: req.body.phone || null,
      whatsapp: req.body.whatsapp || null,
      cpf: req.body.cpf.replace(/\D/g, ""),
      rg: req.body.rg,
      cnh_number: req.body.cnh_number,
      cnh_issue_date: req.body.cnh_issue_date,
      cnh_expiry_date: req.body.cnh_expiry_date,
      cnh_photo_path: path,
      created_by: req.user.id,
    }).select().single();

    if (error) throw error;
    await hooks.trigger("member:after_create", { member: data });
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    const msg = err.code === "23505" ? "Já existe um membro com esse CPF." : "Falha ao cadastrar membro.";
    res.status(500).json({ error: msg });
  }
});

// GET /api/members — lista membros com dias restantes de validade calculados
router.get("/", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("members")
      .select("id, full_name, email, phone, whatsapp, cnh_expiry_date, created_at")
      .order("cnh_expiry_date", { ascending: true });
    if (error) throw error;

    const today = new Date();
    const withStatus = data.map((m) => {
      const daysLeft = Math.round((new Date(m.cnh_expiry_date) - today) / (1000 * 60 * 60 * 24));
      return { ...m, days_until_cnh_expiry: daysLeft };
    });

    res.json(withStatus);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao listar membros." });
  }
});

// PUT /api/members/:id — atualiza cadastro; reseta alertas se a CNH mudou
// (é o comportamento pedido: alerta para de disparar após renovação)
router.put("/:id", upload.single("cnh_photo"), async (req, res) => {
  try {
    const updates = {};
    for (const field of ["full_name", "email", "phone", "whatsapp", "rg", "cnh_number"]) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    let cnhChanged = false;
    if (req.body.cnh_issue_date || req.body.cnh_expiry_date) {
      if (req.body.cnh_issue_date) updates.cnh_issue_date = req.body.cnh_issue_date;
      if (req.body.cnh_expiry_date) updates.cnh_expiry_date = req.body.cnh_expiry_date;
      cnhChanged = true;
    }

    if (req.file) {
      const path = `${crypto.randomUUID()}_${safeFileName(req.file.originalname)}`;
      const { error: uploadError } = await supabase.storage
        .from("member-documents")
        .upload(path, req.file.buffer, { contentType: req.file.mimetype });
      if (uploadError) throw uploadError;
      updates.cnh_photo_path = path;
      cnhChanged = true;
    }

    // Renovou CNH (data ou foto nova) — zera os alertas já enviados.
    if (cnhChanged) updates.alerts_sent = {};
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from("members").update(updates).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao atualizar membro." });
  }
});

// GET /api/members/:id/cnh-photo — URL assinada temporária (bucket é privado)
router.get("/:id/cnh-photo", async (req, res) => {
  try {
    const { data: member, error: memberError } = await supabase
      .from("members").select("cnh_photo_path").eq("id", req.params.id).single();
    if (memberError || !member) return res.status(404).json({ error: "Membro não encontrado." });

    const { data, error } = await supabase.storage
      .from("member-documents")
      .createSignedUrl(member.cnh_photo_path, 300); // expira em 5 minutos
    if (error) throw error;

    res.json({ url: data.signedUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao gerar link da foto." });
  }
});

export default router;
