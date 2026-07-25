import nodemailer from "nodemailer";

/**
 * Separado do e-mail de autenticação do Supabase — este é pra e-mails
 * transacionais do próprio JarviX (ex: alerta de vencimento de CNH).
 * Configure um provedor tipo Resend/SendGrid/Mailgun (SMTP) no .env.
 */
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST) {
    console.warn("SMTP não configurado — e-mails de alerta não serão enviados. Veja .env.example.");
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

export async function sendEmail({ to, subject, html }) {
  const t = getTransporter();
  if (!t) return { skipped: true };

  return t.sendMail({
    from: process.env.ALERT_FROM_EMAIL || "JarviX <no-reply@jarvix.local>",
    to,
    subject,
    html,
  });
}
