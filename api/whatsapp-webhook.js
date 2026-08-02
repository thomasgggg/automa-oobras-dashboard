// Endpoint único do WhatsApp (Meta Cloud API):
//   GET  -> handshake de verificação do webhook
//   POST -> recebe mensagens (texto, foto, áudio, documento) e organiza por obra
//
// Configure a URL deste arquivo (https://SEU-SITE.vercel.app/api/whatsapp-webhook)
// em developers.facebook.com > seu app > WhatsApp > Configuration > Webhook.

import { sbAdmin, uploadMedia } from "./_lib/supabaseAdmin.js";
import { downloadMedia, sendText } from "./_lib/whatsapp.js";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const SESSAO_VALIDA_HORAS = 6; // por quanto tempo lembramos a última obra usada

function normalizar(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "");
}

function encontrarObraNoTexto(texto, obras) {
  const alvo = normalizar(texto);
  if (!alvo) return null;
  return obras.find((o) => alvo.includes(normalizar(o.name))) || null;
}

function extrairValor(texto) {
  const match = (texto || "").match(/r\$\s*([\d.]+,\d{2}|\d+)/i);
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
async function obrasNoEscopoDoTelefone(telefone, sessao) {
  if (await obraAindaValida(sessao)) {
    const [obraDaSessao] = await sbAdmin(`obras?id=eq.${sessao.obra_id}&select=id,name,telefone,empresa_id`);
    if (obraDaSessao && obraDaSessao.empresa_id) {
      return sbAdmin(`obras?empresa_id=eq.${obraDaSessao.empresa_id}&select=id,name,telefone`);
    }
  }

  const porTelefone = await sbAdmin(`obras?telefone=eq.${encodeURIComponent(telefone)}&select=id,name,telefone,empresa_id`);
  if (!porTelefone || porTelefone.length === 0) return [];

  const empresaIds = [...new Set(porTelefone.map((o) => o.empresa_id).filter(Boolean))];
  if (empresaIds.length === 1) {
    // Um único vínculo claro: abre para todas as obras dessa empresa (o
    // responsável de uma obra também pode lançar em outra obra da mesma empresa).
    return sbAdmin(`obras?empresa_id=eq.${empresaIds[0]}&select=id,name,telefone`);
  }
  // Esse número está cadastrado como responsável em mais de uma empresa ao
  // mesmo tempo (raro, mas possível). Para não misturar as duas, ficamos
  // restritos só às obras onde ele já está explicitamente cadastrado.
  return porTelefone;
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

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
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

    // --- Pergunta de resumo ("quanto já foi registrado?") ---
    if (waType === "text" && /quanto|resumo|total registrado/i.test(conteudo)) {
      const sessaoValida = await obraAindaValida(sessao);
      const obraAtual = sessaoValida ? obras.find((o) => o.id === sessao.obra_id) : encontrarObraNoTexto(conteudo, obras);
      if (obraAtual) {
        await sendText(telefone, await resumoDaObra(obraAtual));
        return res.status(200).send("resumo enviado");
      }
    }

    // --- Determinar a obra deste registro ---
    let obra = encontrarObraNoTexto(conteudo, obras);
    if (!obra && (await obraAindaValida(sessao))) {
      obra = obras.find((o) => o.id === sessao.obra_id) || null;
    }

    const tipo = classificarTipo(waType, conteudo);
    const valor = extrairValor(conteudo);

    let mediaUrl = null;
    if (mediaId) {
      const midia = await downloadMedia(mediaId);
      mediaUrl = await uploadMedia(`${telefone}-${mediaId}`, midia.buffer, mimeType || midia.mimeType);
    }

    const [registro] = await sbAdmin("registros", {
      method: "POST",
      body: JSON.stringify({
        obra_id: obra ? obra.id : null,
        tipo,
        conteudo,
        valor,
        media_url: mediaUrl,
        media_mime: mimeType,
        remetente: telefone,
        whatsapp_message_id: mensagem.id,
      }),
    });

    if (obra) {
      await upsertSessao(telefone, { obra_id: obra.id, aguardando_obra: false, registro_pendente_id: null });
      const respostas = {
        nota_fiscal: `Nota recebida${valor ? ` (R$ ${valor.toFixed(2)})` : ""}. Gasto registrado e salvo no histórico da obra ${obra.name}.`,
        foto: `Atualização registrada em ${new Date().toLocaleDateString("pt-BR")}, com foto anexada na obra ${obra.name}.`,
        audio: `Áudio recebido e salvo no histórico da obra ${obra.name}.`,
        documento: `Documento anexado e salvo no histórico da obra ${obra.name}.`,
        texto: `Anotado na obra ${obra.name}.`,
      };
      await sendText(telefone, respostas[tipo]);
    } else {
      await upsertSessao(telefone, { aguardando_obra: true, registro_pendente_id: registro.id });
      await sendText(
        telefone,
        `Recebi, mas para qual obra é esse registro? Obras cadastradas: ${obras.map((o) => o.name).join(", ") || "(nenhuma obra cadastrada ainda)"}`
      );
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.error("Erro no webhook do WhatsApp:", err);
    // Sempre responder 200 para a Meta não ficar reenviando o mesmo evento em loop.
    return res.status(200).send("erro interno registrado no log");
  }
}
