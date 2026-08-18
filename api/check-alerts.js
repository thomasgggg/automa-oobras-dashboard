// Roda periodicamente (configurado em vercel.json, seção "crons").
// Verifica cada obra: se o gasto (%) está muito à frente do progresso físico (%),
// ou se o prazo está próximo/vencido, manda um alerta pelo WhatsApp do responsável.

import { sbAdmin } from "./_lib/supabaseAdmin.js";
import { sendText } from "./_lib/whatsapp.js";

const LIMITE_DIFERENCA_ORCAMENTO = 20; // pontos percentuais, mesmo critério do dashboard (statusFor)
const DIAS_AVISO_PRAZO = 7;

function formatBRL(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function handler(req, res) {
  // Protege o endpoint: só a Vercel (com o header automático do cron) ou uma
  // chamada manual autenticada com CRON_SECRET pode disparar isso. Se o
  // CRON_SECRET não estiver configurado, o endpoint fica público — por isso
  // recusamos por padrão em vez de deixar passar.
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET não configurado nas variáveis de ambiente: recusando execução por segurança.");
    return res.status(500).send("cron não configurado corretamente (falta CRON_SECRET)");
  }
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send("não autorizado");
  }

  try {
    const obras = await sbAdmin("obras?select=id,name,budget,deadline,progress,telefone");
    const materiais = await sbAdmin("materiais?select=obra_id,value");

    const gastosPorObra = {};
    (materiais || []).forEach((m) => {
      gastosPorObra[m.obra_id] = (gastosPorObra[m.obra_id] || 0) + Number(m.value || 0);
    });

    const avisos = [];
    const falhas = [];

    for (const obra of obras || []) {
      if (!obra.telefone) continue; // sem telefone cadastrado, não tem para quem avisar

      const gasto = gastosPorObra[obra.id] || 0;
      const budgetPct = obra.budget > 0 ? (gasto / obra.budget) * 100 : 0;
      const diff = budgetPct - (obra.progress || 0);

      if (diff > LIMITE_DIFERENCA_ORCAMENTO) {
        const enviado = await sendText(
          obra.telefone,
          `Alerta - ${obra.name}: o gasto está em ${budgetPct.toFixed(0)}% do orçamento (${formatBRL(gasto)} de ${formatBRL(obra.budget)}), mas a obra está ${Math.round(obra.progress || 0)}% concluída. Vale revisar.`
        );
        (enviado ? avisos : falhas).push(`${obra.name}: orçamento`);
      }

      if (obra.deadline) {
        const dias = Math.ceil((new Date(obra.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (dias <= DIAS_AVISO_PRAZO) {
          const texto =
            dias < 0
              ? `Alerta - ${obra.name}: o prazo (${obra.deadline}) já passou.`
              : `Alerta - ${obra.name}: faltam ${dias} dia(s) para o prazo (${obra.deadline}).`;
          const enviado = await sendText(obra.telefone, texto);
          (enviado ? avisos : falhas).push(`${obra.name}: prazo`);
        }
      }
    }

    // Se algum alerta falhou ao enviar (ex.: fora da janela de 24h do
    // WhatsApp e sem template aprovado), isso fica visível na resposta e
    // nos logs em vez de desaparecer silenciosamente.
    if (falhas.length > 0) {
      console.error("Alertas que não foram entregues (ver logs de sendText acima para o motivo):", falhas);
    }

    return res.status(200).json({ ok: true, avisosEnviados: avisos, avisosComFalha: falhas });
  } catch (err) {
    console.error("Erro ao checar alertas:", err);
    return res.status(500).json({ ok: false, erro: String(err) });
  }
}
