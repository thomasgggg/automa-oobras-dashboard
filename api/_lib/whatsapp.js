// Helpers para falar com a Meta WhatsApp Cloud API.
// Doc oficial: https://developers.facebook.com/docs/whatsapp/cloud-api

const GRAPH_VERSION = "v20.0";
const TOKEN = process.env.META_WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

function assertConfig() {
  if (!TOKEN || !PHONE_NUMBER_ID) {
    throw new Error(
      "META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID não configurados nas variáveis de ambiente do Vercel."
    );
  }
}

// Descobre a URL temporária de um arquivo de mídia a partir do media id
// que vem no payload do webhook, depois baixa os bytes.
async function downloadMedia(mediaId) {
  assertConfig();
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`Erro ao buscar metadados da mídia ${mediaId}`);
  const meta = await metaRes.json();

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!fileRes.ok) throw new Error(`Erro ao baixar mídia ${mediaId}`);
  const arrayBuffer = await fileRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: meta.mime_type,
  };
}

async function sendText(to, body) {
  assertConfig();
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // Código 131047 / "re-engagement": a Meta só permite mensagem livre de
    // texto dentro de 24h após a última mensagem do cliente. Fora disso,
    // só funciona com um template pré-aprovado. Deixamos isso explícito no
    // log em vez de um erro genérico, porque é a causa mais comum de
    // alerta automático (check-alerts) que "some" sem avisar ninguém.
    const foraDaJanela = errText.includes("131047") || /re-?engagement|24.?hour/i.test(errText);
    if (foraDaJanela) {
      console.error(
        `Não foi possível enviar WhatsApp para ${to}: fora da janela de 24h e sem template aprovado pela Meta. ` +
          `Ou o cliente manda uma mensagem primeiro, ou é preciso configurar um message template aprovado para alertas automáticos. Detalhe:`,
        errText
      );
    } else {
      console.error(`Erro ao enviar WhatsApp para ${to}:`, errText);
    }
  }
  return res.ok;
}

export { downloadMedia, sendText };
