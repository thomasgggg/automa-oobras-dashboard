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
    console.error("Erro ao enviar WhatsApp:", errText);
  }
  return res.ok;
}

export { downloadMedia, sendText };
