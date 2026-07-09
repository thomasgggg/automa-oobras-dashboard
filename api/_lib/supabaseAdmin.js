// Cliente Supabase "admin" para uso apenas dentro das funções serverless
// (nunca no navegador). Usa a service_role key, que ignora RLS.
// Segue o mesmo padrão de fetch usado no dashboard (src/App.jsx), sem
// depender do pacote @supabase/supabase-js.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function assertConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados nas variáveis de ambiente do Vercel."
    );
  }
}

async function sbAdmin(path, options = {}) {
  assertConfig();
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(errText || `Supabase erro ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Upload de um arquivo binário para o Storage (bucket "registros-media").
async function uploadMedia(fileName, buffer, contentType) {
  assertConfig();
  const path = `${Date.now()}-${fileName}`;
  const res = await fetch(
    `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/registros-media/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": contentType || "application/octet-stream",
      },
      body: buffer,
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(errText || `Supabase storage erro ${res.status}`);
  }
  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/registros-media/${path}`;
}

export { sbAdmin, uploadMedia };
