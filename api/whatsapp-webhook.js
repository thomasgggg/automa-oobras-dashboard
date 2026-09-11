// Endpoint único do WhatsApp (Meta Cloud API):
//   GET  -> handshake de verificação do webhook
//   POST -> recebe mensagens (texto, foto, áudio, documento) e organiza por obra
//
// Configure a URL deste arquivo (https://SEU-SITE.vercel.app/api/whatsapp-webhook)
// em developers.facebook.com > seu app > WhatsApp > Configuration > Webhook.

import crypto from "crypto";
import { sbAdmin, uploadMedia } from "./_lib/supabaseAdmin.js";
import { downloadMedia, sendText } from "./_lib/whatsapp.js";
import { interpretarMensagem } from "./_lib/ia.js";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;
const SESSAO_VALIDA_HORAS = 6; // por quanto tempo lembramos a última obra usada

// A Vercel parseia o corpo como JSON por padrão, mas para validar a
// assinatura da Meta (HMAC sobre os bytes originais) precisamos do corpo
// bruto, byte a byte, antes de qualquer parsing.
export const config = {
  api: {
    bodyParser: false,
  },
};

async function lerCorpoBruto(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Confirma que o payload realmente veio da Meta (e não de qualquer um que
// descobriu a URL do webhook), comparando a assinatura HMAC-SHA256 enviada
// no cabeçalho x-hub-signature-256 com uma calculada aqui usando o App
// Secret. Sem isso, qualquer pessoa poderia forjar mensagens de WhatsApp
// falsas e gerar registros/gastos falsos nas obras.
function assinaturaValida(rawBody, assinaturaRecebida) {
  if (!APP_SECRET) {
    console.error("META_APP_SECRET não configurado: recusando webhook por segurança.");
    return false;
  }
  if (!assinaturaRecebida) return false;
  const esperado =
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(assinaturaRecebida);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizar(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function encontrarObraNoTexto(texto, obras) {
  const alvo = normalizar(texto);
  if (!alvo) return null;
  return obras.find((o) => alvo.includes(normalizar(o.name))) || null;
}

// Compara o nome de obra sugerido pela IA com as obras cadastradas de forma
// tolerante: a IA às vezes devolve o nome com uma palavra a mais/a menos
// (ex.: "Obra Viga" em vez de "Viga", ou o contrário) mesmo quando instruída
// a copiar exatamente. Em vez de exigir igualdade exata, aceitamos também
// quando um nome contém o outro por completo — evita falso-negativo sem
// abrir margem para associar a uma obra errada (a comparação continua sendo
// só dentro da lista já restrita à empresa do telefone).
function obraCorresponde(nomeSugerido, obra) {
  const a = normalizar(nomeSugerido);
  const b = normalizar(obra.name);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// Compara dois telefones de forma tolerante a formatação. A Meta sempre manda
// o número em E.164 sem "+" (ex.: 5511988887777), mas quem cadastra a obra no
// painel pode digitar com parênteses, traço, espaço, sem o "55" do Brasil, ou
// sem o "9" extra dos celulares — uma igualdade exata (===) faz esses casos
// comuns falharem silenciosamente, deixando o número "não identificado".
function normalizarTelefone(t) {
  return (t || "").replace(/\D/g, "");
}

// Reduz um telefone brasileiro a (DDD + 8 dígitos), removendo o código do
// país (55) e o "9" extra do celular quando presentes, para que "11988887777",
// "5511988887777" e "(11) 9 8888-7777" virem todos a mesma chave.
function chaveTelefoneBR(t) {
  let d = normalizarTelefone(t);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) d = d.slice(0, 2) + d.slice(3);
  return d.length >= 10 ? d.slice(-10) : d;
}

function telefoneCorresponde(a, b) {
  if (!a || !b) return false;
  const ka = chaveTelefoneBR(a);
  const kb = chaveTelefoneBR(b);
  if (ka && ka === kb) return true;
  // Reserva para números fora do padrão BR (outro DDI, tamanho diferente):
  // compara os dígitos completos, sem tentar remover DDI/9.
  return normalizarTelefone(a) === normalizarTelefone(b);
}

// Extrai um valor em reais do texto (usado no parser por regras, quando a IA
// não está disponível). Na fala/escrita natural quase ninguém escreve "R$" ou
// "reais" — por isso, além do formato explícito, também aceitamos um número
// logo após um verbo comum de gasto ("gastei 350 no cimento").
function extrairValor(texto) {
  const t = texto || "";
  const numero = "([\\d.]+,\\d{2}|\\d+(?:\\.\\d{3})*)"; // 350 | 1.200 | 89,90
  let match =
    t.match(new RegExp(`r\\$\\s*${numero}`, "i")) ||
    t.match(new RegExp(`${numero}\\s*reais`, "i")) ||
    t.match(new RegExp(`(?:gastei|paguei|custou|comprei por|saiu por|foi)\\s*${numero}`, "i"));
  if (!match) return null;
  const num = match[1].replace(/\./g, "").replace(",", ".");
  const valor = parseFloat(num);
  return isNaN(valor) ? null : valor;
}

function classificarTipo(waType, conteudo) {
  const texto = normalizar(conteudo);
  const pareceNota = /nota fiscal|\bnf\b|recibo|cupom fiscal/.test(texto);
  if (waType === "image") return pareceNota ? "nota_fiscal" : "foto";
  if (waType === "document") return pareceNota ? "nota_fiscal" : "documento";
  if (waType === "audio") return "audio";
  return "texto";
}

// Interpreta o conteúdo da mensagem: tenta a IA primeiro (entende sinônimos,
// erros de digitação, frases fora do padrão, e até áudio — o Gemini "ouve" a
// nota de voz direto, sem transcrição separada), e cai para o parser antigo
// por regras (regex + palavras-chave) se a IA não estiver configurada,
// falhar ou demorar demais. A automação nunca fica sem funcionar por causa
// da IA; para áudio sem IA disponível, o registro cai sem texto (como antes).
//
// Segurança: `obra` aqui só pode ser um item de `obras` (já filtrada pela
// empresa do número, em obrasNoEscopoDoTelefone) — nunca um ID vindo direto
// da IA. Tanto o caminho por IA quanto o caminho por regras já respeitam
// essa restrição (a IA só devolve um nome, comparado contra a lista; o
// regex usa encontrarObraNoTexto, que também só busca dentro de `obras`).
async function interpretar({ texto, waType, obras, audioBuffer, audioMimeType, instrucoesExtras }) {
  try {
    const iaResultado = await interpretarMensagem({ texto, waType, obras, audioBuffer, audioMimeType, instrucoesExtras });
    if (iaResultado) {
      console.log(
        "IA (Gemini) interpretou:",
        JSON.stringify({
          intencao: iaResultado.intencao,
          tipo: iaResultado.tipo,
          obra_nome: iaResultado.obra_nome,
          valor: iaResultado.valor,
        })
      );
      const obraEncontrada = iaResultado.obra_nome
        ? obras.find((o) => obraCorresponde(iaResultado.obra_nome, o)) || null
        : null;
      return {
        intencao: iaResultado.intencao || "registro",
        tipo: iaResultado.tipo || classificarTipo(waType, texto),
        valor: iaResultado.valor ?? extrairValor(texto),
        progressoAbsoluto: iaResultado.progresso_absoluto ?? null,
        progressoIncremento: iaResultado.progresso_incremento ?? null,
        obra: obraEncontrada,
        resposta: iaResultado.resposta || null,
        transcricao: iaResultado.transcricao || null,
        viaIA: true,
      };
    }
  } catch (e) {
    console.error("Erro inesperado interpretando com IA, caindo para regras:", e.message || e);
  }

  // Sem IA disponível, uma atualização de progresso ("avançamos 5%") não tem
  // como ser detectada com segurança por regex — cai como "registro" comum
  // (fica salva no diário como texto, só não atualiza o progresso da obra).
  return {
    intencao: /quanto|resumo|total registrado/i.test(normalizar(texto)) ? "resumo" : "registro",
    tipo: classificarTipo(waType, texto),
    valor: extrairValor(texto),
    progressoAbsoluto: null,
    progressoIncremento: null,
    obra: encontrarObraNoTexto(texto, obras),
    resposta: null,
    transcricao: null,
    viaIA: false,
  };
}

async function getSessao(telefone) {
  const rows = await sbAdmin(`whatsapp_sessions?telefone=eq.${encodeURIComponent(telefone)}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}

async function upsertSessao(telefone, dados) {
  await sbAdmin(`whatsapp_sessions?on_conflict=telefone`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: JSON.stringify({ telefone, atualizado_em: new Date().toISOString(), ...dados }),
  });
}

async function obraAindaValida(sessao) {
  if (!sessao || !sessao.obra_id) return false;
  const atualizado = new Date(sessao.atualizado_em).getTime();
  const horas = (Date.now() - atualizado) / (1000 * 60 * 60);
  return horas < SESSAO_VALIDA_HORAS;
}

// Descobre a que empresa este número de WhatsApp pertence e devolve só as
// obras dessa empresa. Sem isso, a busca de obra por nome (encontrarObraNoTexto)
// varreria o banco inteiro e poderia associar um registro de um cliente a uma
// obra de outro cliente — ou expor o nome das obras de todo mundo na resposta.
//
// Duas fontes, nessa ordem:
//   1. Sessão recente e válida: já sabemos a obra (e portanto a empresa) da
//      última interação desse número.
//   2. Telefone cadastrado como "WhatsApp do responsável" em alguma obra:
//      é o único vínculo confiável entre um número e uma empresa que existe
//      hoje no cadastro.
// Se nenhuma das duas resolver, devolvemos lista vazia — nunca uma lista
// global — e quem chamou decide como responder com segurança.
// Nota: os selects abaixo incluem empresa_id além de id/name/telefone. Isso
// não é exposto à IA (que só recebe os nomes das obras, ver interpretar()) —
// serve só para localizar, aqui no servidor, as instruções de IA que a
// empresa cadastrou no painel (instrucoesIADaEmpresa, logo abaixo).
async function obrasNoEscopoDoTelefone(telefone, sessao) {
  if (await obraAindaValida(sessao)) {
    const [obraDaSessao] = await sbAdmin(`obras?id=eq.${sessao.obra_id}&select=id,name,telefone,empresa_id,progress`);
    if (obraDaSessao && obraDaSessao.empresa_id) {
      return sbAdmin(`obras?empresa_id=eq.${obraDaSessao.empresa_id}&select=id,name,telefone,empresa_id,progress`);
    }
  }

  // Busca tolerante: traz todas as obras com telefone cadastrado e compara
  // aqui (normalizando formatação/DDI/"9" extra) em vez de um "=eq." exato no
  // banco, que falhava sempre que o número foi digitado com formatação
  // diferente da que a Meta manda.
  const todasComTelefone = await sbAdmin(`obras?telefone=not.is.null&select=id,name,telefone,empresa_id,progress`);
  const porTelefone = (todasComTelefone || []).filter((o) => telefoneCorresponde(telefone, o.telefone));
  if (porTelefone.length === 0) {
    console.log(
      "Nenhuma obra encontrada para este telefone (mesmo com comparação tolerante):",
      JSON.stringify({ telefoneRecebido: telefone, chaveRecebida: chaveTelefoneBR(telefone) })
    );
    return [];
  }

  const empresaIds = [...new Set(porTelefone.map((o) => o.empresa_id).filter(Boolean))];
  if (empresaIds.length === 1) {
    // Um único vínculo claro: abre para todas as obras dessa empresa (o
    // responsável de uma obra também pode lançar em outra obra da mesma empresa).
    return sbAdmin(`obras?empresa_id=eq.${empresaIds[0]}&select=id,name,telefone,empresa_id,progress`);
  }
  // Esse número está cadastrado como responsável em mais de uma empresa ao
  // mesmo tempo (raro, mas possível). Para não misturar as duas, ficamos
  // restritos só às obras onde ele já está explicitamente cadastrado.
  return porTelefone;
}

// Busca o texto de instruções de IA que a empresa configurou no painel
// (Configurações > Assistente de IA). Todas as obras da lista pertencem à
// mesma empresa (garantido por obrasNoEscopoDoTelefone), então basta olhar
// o empresa_id da primeira. Devolve null se a empresa não configurou nada
// (a IA usa só o prompt padrão nesse caso) ou se não houver obra alguma.
async function instrucoesIADaEmpresa(obras) {
  const empresaId = obras && obras[0] && obras[0].empresa_id;
  if (!empresaId) return null;
  const [empresa] = await sbAdmin(`empresas?id=eq.${empresaId}&select=instrucoes_ia`);
  return (empresa && empresa.instrucoes_ia) || null;
}

async function resumoDaObra(obra) {
  const registros = await sbAdmin(
    `registros?obra_id=eq.${obra.id}&select=tipo,valor`
  );
  const total = (registros || []).reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const porTipo = {};
  (registros || []).forEach((r) => {
    porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1;
  });
  const linhas = Object.entries(porTipo)
    .map(([tipo, qtd]) => `- ${tipo.replace("_", " ")}: ${qtd}`)
    .join("\n");
  return `Obra ${obra.name}:\n${linhas || "nenhum registro ainda"}\nTotal de gastos com valor identificado: R$ ${total.toFixed(2)}`;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Token de verificação inválido.");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Método não permitido.");
  }

  const rawBody = await lerCorpoBruto(req);
  const assinaturaRecebida = req.headers["x-hub-signature-256"];
  if (!assinaturaValida(rawBody, assinaturaRecebida)) {
    console.error("Webhook recusado: assinatura x-hub-signature-256 ausente ou inválida.");
    return res.status(401).send("assinatura invalida");
  }

  let body;
  try {
    body = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch (e) {
    return res.status(400).send("payload invalido");
  }

  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const mensagem = value?.messages?.[0];

    // Eventos de status (entregue/lido) não têm "messages" — apenas confirme recebimento.
    if (!mensagem) return res.status(200).send("ok");

    const telefone = mensagem.from;
    const waType = mensagem.type;

    // Idempotência: a Meta pode reenviar o mesmo webhook.
    const jaExiste = await sbAdmin(
      `registros?whatsapp_message_id=eq.${mensagem.id}&select=id`
    );
    if (jaExiste && jaExiste.length > 0) return res.status(200).send("duplicado");

    const sessao = await getSessao(telefone);

    // Isolamento por empresa: o webhook usa a service_role key, que ignora RLS,
    // então a separação entre empresas precisa ser feita aqui manualmente.
    // Nunca buscamos/mostramos obras de outras empresas para este número.
    const obras = await obrasNoEscopoDoTelefone(telefone, sessao);
    if (obras.length === 0) {
      await sendText(
        telefone,
        "Não consegui identificar a qual obra/empresa este número pertence. Peça para quem cadastrou a obra no painel incluir este WhatsApp no campo \"WhatsApp do responsável\"."
      );
      return res.status(200).send("numero nao identificado");
    }

    let conteudo = "";
    let mediaId = null;
    let mimeType = null;

    if (waType === "text") {
      conteudo = mensagem.text?.body || "";
    } else if (waType === "image") {
      conteudo = mensagem.image?.caption || "";
      mediaId = mensagem.image?.id;
      mimeType = mensagem.image?.mime_type;
    } else if (waType === "audio") {
      mediaId = mensagem.audio?.id;
      mimeType = mensagem.audio?.mime_type;
    } else if (waType === "document") {
      conteudo = mensagem.document?.caption || mensagem.document?.filename || "";
      mediaId = mensagem.document?.id;
      mimeType = mensagem.document?.mime_type;
    } else {
      // Tipo não suportado ainda (localização, figurinha, etc.)
      await sendText(telefone, "Recebi sua mensagem, mas esse tipo de conteúdo ainda não é organizado automaticamente.");
      return res.status(200).send("tipo nao suportado");
    }

    // Baixa a mídia (se houver) já aqui, antes da interpretação: para áudio,
    // o Gemini precisa dos bytes para "ouvir" a nota de voz. Guardamos o
    // buffer para reaproveitar no upload mais abaixo, sem baixar duas vezes.
    let mediaBuffer = null;
    let mediaBufferMimeType = null;
    if (mediaId) {
      const midia = await downloadMedia(mediaId);
      mediaBuffer = midia.buffer;
      mediaBufferMimeType = mimeType || midia.mimeType;
    }

    // --- Resposta a "para qual obra é isso?" ---
    if (sessao?.aguardando_obra && waType === "text") {
      const obraEscolhida = encontrarObraNoTexto(conteudo, obras);
      if (obraEscolhida) {
        if (sessao.registro_pendente_id) {
          await sbAdmin(`registros?id=eq.${sessao.registro_pendente_id}`, {
            method: "PATCH",
            body: JSON.stringify({ obra_id: obraEscolhida.id }),
          });
        }
        await upsertSessao(telefone, { obra_id: obraEscolhida.id, aguardando_obra: false, registro_pendente_id: null });
        await sendText(telefone, `Certo! Associei à obra ${obraEscolhida.name}.`);
        return res.status(200).send("obra resolvida");
      }
      await sendText(telefone, `Não encontrei essa obra. Obras cadastradas: ${obras.map((o) => o.name).join(", ")}`);
      return res.status(200).send("obra nao encontrada");
    }

    // --- Interpreta a mensagem (IA com fallback por regras) ---
    const instrucoesExtras = await instrucoesIADaEmpresa(obras);
    const interpretacao = await interpretar({
      texto: conteudo,
      waType,
      obras,
      audioBuffer: waType === "audio" ? mediaBuffer : null,
      audioMimeType: waType === "audio" ? mediaBufferMimeType : null,
      instrucoesExtras,
    });

    // --- Pergunta de resumo ("quanto já foi registrado?") ---
    if (interpretacao.intencao === "resumo") {
      const sessaoValida = await obraAindaValida(sessao);
      const obraAtual =
        interpretacao.obra || (sessaoValida ? obras.find((o) => o.id === sessao.obra_id) : null);
      if (obraAtual) {
        await sendText(telefone, await resumoDaObra(obraAtual));
        return res.status(200).send("resumo enviado");
      }
    }

    // --- Atualização de progresso físico ("avançamos 5%", "a obra está 60% pronta") ---
    if (interpretacao.intencao === "progresso") {
      const sessaoValida = await obraAindaValida(sessao);
      const obraAtual =
        interpretacao.obra || (sessaoValida ? obras.find((o) => o.id === sessao.obra_id) : null);
      if (obraAtual) {
        const progressoAtual = Number(obraAtual.progress) || 0;
        let novoProgresso = progressoAtual;
        if (interpretacao.progressoAbsoluto != null) {
          novoProgresso = Math.max(0, Math.min(100, Math.round(interpretacao.progressoAbsoluto)));
        } else if (interpretacao.progressoIncremento != null) {
          novoProgresso = Math.max(0, Math.min(100, Math.round(progressoAtual + interpretacao.progressoIncremento)));
        }
        await sbAdmin(`obras?id=eq.${obraAtual.id}`, {
          method: "PATCH",
          body: JSON.stringify({ progress: novoProgresso }),
        });
        // Fica registrado no diário da obra também, como texto, para histórico.
        await sbAdmin("registros", {
          method: "POST",
          body: JSON.stringify({
            obra_id: obraAtual.id,
            tipo: "texto",
            conteudo: interpretacao.transcricao || conteudo || `Progresso atualizado para ${novoProgresso}%`,
            remetente: telefone,
            whatsapp_message_id: mensagem.id,
          }),
        }).catch(() => {});
        await sendText(
          telefone,
          interpretacao.resposta ||
            `Show! Atualizei o progresso da obra ${obraAtual.name} para ${novoProgresso}%.`
        );
        return res.status(200).send("progresso atualizado");
      }
    }

    // --- Determinar a obra deste registro ---
    let obra = interpretacao.obra;
    if (!obra && (await obraAindaValida(sessao))) {
      obra = obras.find((o) => o.id === sessao.obra_id) || null;
    }

    const tipo = interpretacao.tipo;
    const valor = interpretacao.valor;
    // Para áudio, usa a transcrição resumida da IA como conteúdo salvo (fica
    // um registro pesquisável do que foi falado); nos demais casos, mantém o
    // texto/legenda original.
    const conteudoSalvo = interpretacao.transcricao || conteudo;

    let mediaUrl = null;
    if (mediaBuffer) {
      mediaUrl = await uploadMedia(`${telefone}-${mediaId}`, mediaBuffer, mediaBufferMimeType);
    }

    const [registro] = await sbAdmin("registros", {
      method: "POST",
      body: JSON.stringify({
        obra_id: obra ? obra.id : null,
        tipo,
        conteudo: conteudoSalvo,
        valor,
        media_url: mediaUrl,
        media_mime: mimeType,
        remetente: telefone,
        whatsapp_message_id: mensagem.id,
      }),
    });

    if (obra) {
      await upsertSessao(telefone, { obra_id: obra.id, aguardando_obra: false, registro_pendente_id: null });
      const respostasPadrao = {
        nota_fiscal: `Nota recebida${valor ? ` (R$ ${valor.toFixed(2)})` : ""}. Gasto registrado e salvo no histórico da obra ${obra.name}.`,
        foto: `Atualização registrada em ${new Date().toLocaleDateString("pt-BR")}, com foto anexada na obra ${obra.name}.`,
        audio: `Áudio recebido e salvo no histórico da obra ${obra.name}.`,
        documento: `Documento anexado e salvo no histórico da obra ${obra.name}.`,
        texto: `Anotado na obra ${obra.name}.`,
      };
      // Usa a resposta natural da IA quando disponível; senão, a mensagem fixa de sempre.
      await sendText(telefone, interpretacao.resposta || respostasPadrao[tipo]);
    } else {
      await upsertSessao(telefone, { aguardando_obra: true, registro_pendente_id: registro.id });
      const listaObras = obras.map((o) => o.name).join(", ") || "(nenhuma obra cadastrada ainda)";
      await sendText(
        telefone,
        interpretacao.resposta
          ? `${interpretacao.resposta} Para qual obra é esse registro? Obras cadastradas: ${listaObras}`
          : `Recebi, mas para qual obra é esse registro? Obras cadastradas: ${listaObras}`
      );
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.error("Erro no webhook do WhatsApp:", err);
    // Sempre responder 200 para a Meta não ficar reenviando o mesmo evento em loop.
    return res.status(200).send("erro interno registrado no log");
  }
}
