// Gera um link temporário (assinado, expira em minutos) para um arquivo
// guardado no bucket privado "registros-media".
//
// O bucket não é público de propósito: fotos e notas fiscais de uma empresa
// não podem ficar acessíveis para qualquer um que descubra/adivinhe a URL,
// inclusive de outras empresas clientes. Este endpoint só devolve o link se
// a pessoa que pediu estiver autenticada e o RLS do Supabase confirmar que
// ela tem acesso a esse registro (ou seja, é da mesma empresa da obra).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Chave pública ("publishable"), a mesma usada no dashboard (src/App.jsx) —
// não é segredo, só identifica o projeto para o PostgREST aplicar o RLS
// usando o token do usuário que vier no Authorization.
const SUPABASE_ANON_KEY = "sb_publishable_gZiaA77FbWf_GbQhsN-lQA_Jo-t1eUe";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Método não permitido.");
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).send("SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados.");
  }

  const registroId = req.query.registro_id;
  if (!registroId) {
    return res.status(400).send("registro_id é obrigatório.");
  }

  const auth = req.headers["authorization"];
  if (!auth) {
    return res.status(401).send("Não autenticado.");
  }

  try {
    // Usa o token do próprio usuário (não a service_role key) para que o
    // RLS do Postgres decida se ele pode ver esse registro. Se o registro
    // pertencer a uma obra de outra empresa, a consulta simplesmente não
    // devolve nada.
    const regRes = await fetch(
      `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/registros?id=eq.${encodeURIComponent(registroId)}&select=media_url`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth } }
    );
    if (!regRes.ok) {
      return res.status(502).send("Erro ao consultar registro.");
    }
    const linhas = await regRes.json();
    const path = linhas?.[0]?.media_url;
    if (!path) {
      return res.status(404).send("Arquivo não encontrado ou sem permissão para acessá-lo.");
    }

    const signRes = await fetch(
      `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/sign/registros-media/${path}`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 300 }), // 5 minutos é o suficiente para abrir/exibir
      }
    );
    if (!signRes.ok) {
      const errText = await signRes.text().catch(() => "");
      console.error("Erro ao gerar link assinado:", errText);
      return res.status(502).send("Erro ao gerar link temporário do arquivo.");
    }
    const { signedURL } = await signRes.json();
    return res.status(200).json({ url: `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1${signedURL}` });
  } catch (err) {
    console.error("Erro em /api/media-url:", err);
    return res.status(500).send("Erro interno.");
  }
}
