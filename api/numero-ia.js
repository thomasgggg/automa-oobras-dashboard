// Devolve o número de WhatsApp do assistente de IA (o número que as pessoas
// da obra precisam adicionar/mandar mensagem para começar a usar a
// automação), num formato legível para humanos.
//
// Isso existe porque META_PHONE_NUMBER_ID (usado internamente em
// api/_lib/whatsapp.js para chamar a Graph API) é só um ID interno da Meta,
// sem nenhuma relação visual com o número de telefone real — não dá para
// simplesmente mostrar esse ID no painel e esperar que alguém reconheça o
// WhatsApp do bot. Este endpoint resolve o ID para o número de telefone de
// verdade (campo "display_phone_number" da Graph API) para exibir no painel
// (Configurações > Assistente de IA).
//
// Não expõe nada sensível de nenhuma empresa: é o mesmo número, compartilhado
// por todos os clientes desta automação, então não precisa checar a qual
// empresa pertence quem está perguntando.

const GRAPH_VERSION = "v20.0";
const TOKEN = process.env.META_WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

// Cache simples em memória: dura enquanto a função serverless ficar "quente"
// (a Vercel reaproveita a mesma instância entre chamadas próximas). Evita
// bater na Graph API a cada abertura do painel — o número não muda em
// operação normal.
let cache = null;
let cacheEm = 0;
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 horas

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Método não permitido.");
  }
  if (!TOKEN || !PHONE_NUMBER_ID) {
    return res.status(500).json({ erro: "META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID não configurados." });
  }

  if (cache && Date.now() - cacheEm < CACHE_MS) {
    return res.status(200).json(cache);
  }

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => "");
      console.error("Erro ao consultar número da Meta:", errText);
      return res.status(502).json({ erro: "Não consegui consultar o número na Meta." });
    }
    const data = await metaRes.json();
    const resultado = {
      numero: data.display_phone_number || null,
      nome: data.verified_name || null,
    };
    cache = resultado;
    cacheEm = Date.now();
    return res.status(200).json(resultado);
  } catch (err) {
    console.error("Erro em /api/numero-ia:", err);
    return res.status(500).json({ erro: "Erro interno ao consultar o número da IA." });
  }
}
