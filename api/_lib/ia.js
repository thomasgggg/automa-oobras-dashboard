// Camada de interpretação por IA (Google Gemini) das mensagens recebidas no
// WhatsApp. O Gemini entende texto E áudio nativamente: uma nota de voz é
// mandada direto para o modelo (em base64), sem precisar de um serviço de
// transcrição separado (Whisper, Groq, etc).
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
// Se GEMINI_API_KEY não estiver configurada, a mensagem não tiver conteúdo
// analisável (nem texto nem áudio), ou a chamada falhar/demorar mais que o
// timeout, esta função devolve null e quem chamou cai de volta para o parser
// por regras (ver interpretar() em whatsapp-webhook.js). A automação nunca
// fica "travada" dependendo da IA estar no ar.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.8-flash";
const TIMEOUT_MS = 12000; // áudio leva um pouco mais para processar que texto puro

const FUNCTION_DECLARATION = {
  name: "interpretar_mensagem_obra",
  description:
    "Extrai a intenção e os dados estruturados de uma mensagem (texto ou áudio) enviada por alguém de uma construtora sobre uma obra, recebida por WhatsApp.",
  parameters: {
    type: "object",
    properties: {
      intencao: {
        type: "string",
        enum: ["registro", "resumo", "outro"],
        description:
          "'registro' se a pessoa está relatando algo (gasto, foto, nota fiscal, andamento da obra — inclusive quando isso é dito em um áudio). 'resumo' se está perguntando quanto já foi gasto/registrado até agora. 'outro' para saudações, dúvidas genéricas, ou algo que não se encaixa nos dois casos acima.",
      },
      tipo: {
        type: "string",
        enum: ["nota_fiscal", "foto", "documento", "audio", "texto"],
        description:
          "Tipo de registro, relevante apenas quando intencao='registro'. Use 'nota_fiscal' sempre que o conteúdo sugerir uma compra/gasto com comprovante (nota, recibo, cupom, boleto pago), mesmo sem usar essas palavras exatas — inclusive quando isso for dito em um áudio. Use 'audio' apenas quando o áudio for uma atualização geral que não descreve um gasto específico.",
      },
      valor: {
        type: "number",
        nullable: true,
        description:
          "Valor em reais mencionado no texto ou dito no áudio, como número puro (ex.: 'gastei 350 reais no cimento' -> 350). null se nenhum valor for mencionado.",
      },
      obra_nome: {
        type: "string",
        nullable: true,
        description:
          "O nome da obra a que esta mensagem se refere, copiado EXATAMENTE (mesma grafia) como aparece na lista de obras fornecida no prompt. null se não for possível identificar com razoável confiança, ou se a obra mencionada não estiver na lista.",
      },
      transcricao: {
        type: "string",
        nullable: true,
        description:
          "Somente quando o conteúdo original for um ÁUDIO: uma transcrição resumida (1-2 frases) do que foi dito, para ficar salva no histórico da obra. null se o conteúdo original já era texto.",
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
// a Meta realmente enviou (imagem, documento, texto, áudio). Evita que uma
// resposta mal-formada da IA classifique, por exemplo, uma foto como "documento".
function tipoCompativel(waType, tipo) {
  if (waType === "image") return tipo === "foto" || tipo === "nota_fiscal";
  if (waType === "document") return tipo === "documento" || tipo === "nota_fiscal";
  if (waType === "text") return tipo === "texto";
  if (waType === "audio") return tipo === "audio" || tipo === "nota_fiscal";
  return false;
}

// Chama o Gemini e devolve o objeto estruturado extraído, ou null se a IA
// não estiver configurada, não houver conteúdo para analisar (nem texto nem
// áudio), ou algo der errado (rede, timeout, resposta inesperada).
//
// audioBuffer/audioMimeType só são usados quando waType === "audio": nesse
// caso o áudio (em base64, inline na requisição) é enviado direto para o
// Gemini em vez de texto — é ele quem "ouve" e extrai os dados, sem precisar
// de um serviço de transcrição à parte.
async function interpretarMensagem({ texto, waType, obras, audioBuffer, audioMimeType }) {
  if (!GEMINI_API_KEY) return null;

  const temTexto = Boolean(texto && texto.trim());
  const temAudio = waType === "audio" && audioBuffer && audioBuffer.length > 0;
  if (!temTexto && !temAudio) return null;

  const listaObras = obras.map((o) => o.name).join(", ") || "(nenhuma obra cadastrada para este número)";
  const instrucao = temAudio
    ? `Mensagem de ÁUDIO recebida por WhatsApp. Ouça o áudio anexado e extraia os dados.\n\n` +
      `Obras cadastradas para este número: ${listaObras}\n\n` +
      `Analise o áudio e chame a ferramenta com os dados extraídos.`
    : `Mensagem recebida por WhatsApp (tipo original: ${waType}):\n` +
      `"""${texto}"""\n\n` +
      `Obras cadastradas para este número: ${listaObras}\n\n` +
      `Analise a mensagem e chame a ferramenta com os dados extraídos.`;

  const parts = [{ text: instrucao }];
  if (temAudio) {
    parts.push({
      inline_data: {
        mime_type: audioMimeType || "audio/ogg",
        data: audioBuffer.toString("base64"),
      },
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          tools: [{ function_declarations: [FUNCTION_DECLARATION] }],
          tool_config: {
            function_calling_config: { mode: "ANY", allowed_function_names: [FUNCTION_DECLARATION.name] },
          },
          generationConfig: { temperature: 0 },
        }),
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("Erro na API do Gemini (usando regras como reserva):", res.status, errText);
      return null;
    }

    const data = await res.json();
    const responseParts = data?.candidates?.[0]?.content?.parts || [];
    const funcCallPart = responseParts.find((p) => p.functionCall);
    if (!funcCallPart) return null;

    const resultado = funcCallPart.functionCall.args || {};
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
