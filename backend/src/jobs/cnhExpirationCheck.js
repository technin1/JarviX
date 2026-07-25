import { supabase } from "../services/supabaseClient.js";
import { sendEmail } from "../services/mailer.js";

// Marcos de alerta pedidos: 60, 30, 25 e 20 dias antes do vencimento.
// Do maior pro menor — importante pra lógica de "já passou desse marco".
const THRESHOLDS = [60, 30, 25, 20];

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

/**
 * Roda 1x por dia (agendado em queues/cnhCheckQueue.js).
 * Pra cada membro, vê se a validade da CNH cruzou algum dos marcos de
 * alerta desde a última checagem, e manda e-mail se ainda não mandou
 * esse marco específico (evita spam de alerta repetido).
 */
export async function checkCnhExpirations() {
  const { data: members, error } = await supabase
    .from("members")
    .select("id, full_name, email, cnh_expiry_date, alerts_sent");

  if (error) {
    console.error("Falha ao buscar membros pra checagem de CNH:", error);
    return;
  }

  for (const member of members || []) {
    const daysLeft = daysUntil(member.cnh_expiry_date);
    const alertsSent = member.alerts_sent || {};

    // Já venceu — não é o escopo deste alerta preventivo, mas vale logar.
    if (daysLeft < 0) continue;

    for (const threshold of THRESHOLDS) {
      const alreadySent = alertsSent[threshold] === true;
      if (daysLeft <= threshold && !alreadySent) {
        await sendEmail({
          to: member.email,
          subject: `JarviX — Sua CNH vence em ${daysLeft} dia(s)`,
          html: `
            <p>Olá, ${member.full_name}.</p>
            <p>Sua CNH cadastrada vence em <strong>${daysLeft} dia(s)</strong>
            (${new Date(member.cnh_expiry_date).toLocaleDateString("pt-BR")}).</p>
            <p>Por favor, renove o quanto antes e atualize seu cadastro no
            sistema — os alertas param automaticamente assim que a data de
            validade for atualizada.</p>
          `,
        });

        alertsSent[threshold] = true;
        console.log(`Alerta de ${threshold} dias enviado para ${member.email} (membro ${member.id})`);
      }
    }

    // Só grava de volta se algo mudou, pra não gerar updates desnecessários.
    if (JSON.stringify(alertsSent) !== JSON.stringify(member.alerts_sent || {})) {
      await supabase.from("members").update({ alerts_sent: alertsSent }).eq("id", member.id);
    }
  }
}
