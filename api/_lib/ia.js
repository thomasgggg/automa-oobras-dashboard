// Camada de interpretação por IA (Claude/Anthropic) das mensagens recebidas
// no WhatsApp. Substitui/complementa o antigo parser por regex+palavras-chave
// em whatsapp-webhook.js: entende o texto com mais flexibilidade (sinônimos,
// erros de digitação, frases fora do padrão) e sugere uma resposta mais
// natural para mandar de volta.
//
// Importante para segurança: esta função NUNCA decide sozinha a qual obra
// (e portanto empresa) um registro pertence — ela só sugere um NOME de obra,
// em texto livre. Quem chama (whatsapp-webhook.js) confere esse nome contra
// a lista de obras já filtrada pela empresa do número que mandou a mensagem
// (obrasNoEscopoDoTelefone). Se a IA "inventar" ou confundir um nome que não
// está exatamente nessa lista, o registro cai sem obra associada — exatamente
// o mesmo comportamento seguro de antes, sem IA nenhuma. A IA nunca recebe
// nem devolve um ID de obra, só o texto do nome.
//
// Se ANTHROPIC_API_KEY não estiver configurada, ou a chamada falhar/demorar
// mais que o timeout, esta função devolve null e quem chamou cai de volta
// para o parser por regras (ver interpretar() em whatsapp-webhook.js). Ou
// seja, a automação nunca fica "travada" dependendo da IA estar no ar.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 8000;

const FERRAMENTA = {
  name: "interpretar_mensagem_obra",
  description:
    "Extrai a intenção e os dados estruturados de uma mensagem enviada por alguém de uma construtora sobre uma obra, recebida por WhatsApp.",
  input_schema: {
    type: "object",
    properties: {
      intencao: {
        type: "string",
        enum: ["registro", "resumo", "outro"],
        description:
          "'registro' se a pessoa está relatando algo (gasto, foto, nota fiscal, andamento da obra). 'resumo' se está perguntando quanto já foi gasto/registrado até agora. 'outro' para saudações, dúvidas genéricas, ou algo que não se encaixa nos dois casos acima.",
      },
      tipo: {
        type: "string",
        enum: ["nota_fiscal", "foto", "documento", "texto"],
        description:
          "Tipo de registro, relevante apenas quando intencao='registro'. Use 'nota_fiscal' sempre que o texto sugerir uma compra/gasto com comprovante (nota, recibo, cupom, boleto pago), mesmo sem usar essas palavras exatas.",
      },
      valor: {
        type: ["number", "null"],
        description:
          "Valor em reais mencionado no texto, como número puro (ex.: 'gastei 350 reais no cimento' -> 350). null se nenhum valor for mencionado.",
      },
      obra_nome: {
        type: ["string", "null"],
        description:
          "O nome da obra a que esta mensagem se refere, copiado EXATAMENTE (mesma grafia) como aparece na lista de obras fornecida no prompt. null se não for possível identificar com razoável confiança, ou se a obra mencionada não estiver na lista.",
      },
      resposta: {
        type: "string",
        description:
          "Uma resposta curta (1 a 2 frases), natural, cordial e em português do Brasil, para mandar de volta pelo WhatsApp confirmando o que foi entendido. Não invente números ou totais — isso é calculado à parte.",
      },
    },
    required: ["intencao", "resposta"],
  },
};

// Confere se o tipo sugerido pela IA é compatível com o tipo de mensagem que
// a Meta realmente enviou (imagem, documento, texto). Evita que uma resposta
// mal-formada da IA classifique, por exemplo, uma foto como "documento".
function tipoCompativel(waType, tipo) {
  if (waType === "image") return tipo === "foto" || tipo === "nota_fiscal";
  if (waType === "document") return tipo === "documento" || tipo === "nota_fiscal";
  if (waType === "text") return tipo === "texto";
  return false;
}

// Chama a Anthropic e devolve o objeto estruturado extraído, ou null se a IA
// não estiver configurada, a mensagem não tiver texto para analisar, ou algo
// der errado (rede, timeout, resposta inesperada).
async function interpretarMensagem({ texto, waType, obras }) {
  if (!ANTHROPIC_API_KEY) return null;
  if (!texto || !texto.trim()) return null;

  const listaObras = obras.map((o) => o.name).join(", ") || "(nenhuma obra cadastrada para este número)";
  const prompt =
    `Mensagem recebida por WhatsApp (tipo original: ${waType}):\n` +
    `"""${texto}"""\n\n` +
    `Obras cadastradas para este número: ${listaObras}\n\n` +
    `Analise a mensagem e chame a ferramenta com os dados extraídos.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        tools: [FERRAMENTA],
        tool_choice: { type: "tool", name: FERRAMENTA.name },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("Erro na API da Anthropic (usando regras como reserva):", res.status, errText);
      return null;
    }

    const data = await res.json();
    const toolUse = (data.content || []).find((c) => c.type === "tool_use");
    if (!toolUse || !toolUse.input) return null;

    const resultado = toolUse.input;
    if (resultado.tipo && !tipoCompativel(waType, resultado.tipo)) {
      resultado.tipo = null;
    }
    return resultado;
  } catch (err) {
    // Erro de rede, timeout (AbortError) ou JSON inesperado: não derruba o
    // webhook, só sinaliza para o chamador usar o parser por regras.
    console.error("Falha ao chamar IA (usando regras como reserva):", err.message || err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { interpretarMensagem };
