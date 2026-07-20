import React, { useState, useEffect, useMemo } from "react";
import {
  Plus, ArrowLeft, Trash2, Building2, Settings,
  AlertTriangle, X, Package, Calendar, TrendingUp, RefreshCw,
  MessageCircle, FileText, Camera, Mic, Paperclip, Search, LogOut, Copy, Users,
  LayoutGrid, Wallet, ListChecks, BookOpen, Folder, Image as ImageIcon, CheckCircle2
} from "lucide-react";

// Projeto Supabase da Viga Automações (chave "publishable", segura para o navegador).
const SUPABASE_URL = "https://mmueohqmxiovdqwaenks.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gZiaA77FbWf_GbQhsN-lQA_Jo-t1eUe";
const SESSION_KEY = "viga-session";

// Paleta clara, no mesmo espírito da landing page (vigaia.vercel.app):
// fundo claro, cartões brancos, texto quase-preto e verde como cor de ação.
const COLORS = {
  bg: "#F2F4F7",
  panel: "#FFFFFF",
  panel2: "#F6F7F9",
  line: "#E6E9EE",
  ink: "#0B1220",
  inkMuted: "#67707C",
  green: "#16A34A",
  greenDark: "#12813A",
  greenSoft: "#E9F8EF",
  black: "#0B1220",
  indigo: "#4F46E5",
  amber: "#B45309",
  red: "#DC2626",
  yellow: "#B45309",
};

const STAGES = ["Fundação", "Estrutura", "Alvenaria", "Instalações", "Acabamento", "Outro"];

const OBRA_TABS = [
  { key: "resumo", label: "Resumo", icon: LayoutGrid },
  { key: "orcamento", label: "Orçamento", icon: Wallet },
  { key: "cronograma", label: "Cronograma", icon: ListChecks },
  { key: "diario", label: "Diário de obra", icon: BookOpen },
  { key: "documentos", label: "Documentos", icon: Folder },
  { key: "fotos", label: "Fotos", icon: ImageIcon },
];

function formatBRL(v) {
  const n = Number(v) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatOrcamento(v) {
  return v ? formatBRL(v) : "sem orçamento definido";
}
function formatDateBR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function formatDateAnyBR(iso) {
  if (!iso) return "";
  return formatDateBR(String(iso).slice(0, 10));
}
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function statusFor(progress, budgetPct) {
  const diff = budgetPct - progress;
  if (diff > 20) return { label: "Risco alto", tone: COLORS.red, key: "risco" };
  if (diff > 10) return { label: "Atenção", tone: COLORS.yellow, key: "atencao" };
  return { label: "Em dia", tone: COLORS.green, key: "ok" };
}
function diasParaPrazo(deadline) {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// Chamada autenticada ao PostgREST do Supabase. Quando há uma sessão de
// usuário, mandamos o token dele (o RLS do banco filtra tudo pela empresa
// automaticamente); sem sessão, cai para a chave pública (sem acesso a nada
// protegido por RLS).
async function sb(session, path, options = {}) {
  const token = session?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const err = new Error(errText || `Erro ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Autenticação (Supabase Auth / GoTrue) via fetch direto, sem SDK.
async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.error || "Erro de autenticação.");
  }
  return data;
}

function Logomark({ size = 26 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        background: COLORS.black,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', sans-serif",
        fontWeight: 800,
        fontSize: size * 0.46,
        flexShrink: 0,
      }}
    >
      Vi
    </div>
  );
}

function RulerBar({ progress, budgetPct, tone, size = "md" }) {
  const p = Math.max(0, Math.min(100, progress));
  const b = Math.max(0, Math.min(100, budgetPct));
  const height = size === "lg" ? 32 : 20;
  return (
    <div>
      <div
        style={{
          position: "relative",
          height,
          borderRadius: 999,
          background: COLORS.panel2,
          overflow: "hidden",
          border: `1px solid ${COLORS.line}`,
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, height: "50%", width: p + "%", background: COLORS.indigo, transition: "width 0.3s ease" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, height: "50%", width: b + "%", background: tone, transition: "width 0.3s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: COLORS.inkMuted }}>
        <span>física {Math.round(p)}%</span>
        <span>financeira {Math.round(b)}%</span>
      </div>
    </div>
  );
}

function Badge({ label, tone }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", padding: "4px 10px", borderRadius: 999, background: tone + "1A", color: tone }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone }} />
      {label}
    </span>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: 24, width: "100%", maxWidth: 440, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(11,18,32,0.16)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 17, fontWeight: 800, color: COLORS.ink, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={btnIcon}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: "100%", background: COLORS.panel2, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "9px 12px", color: COLORS.ink, fontSize: 14, fontFamily: "'Inter', sans-serif", outline: "none", boxSizing: "border-box" };
const labelStyle = { fontSize: 12, color: COLORS.inkMuted, marginBottom: 6, display: "block", fontFamily: "'Inter', sans-serif", fontWeight: 600 };
const btnPrimary = { background: COLORS.green, color: "#fff", border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 14, fontWeight: 700, fontFamily: "'Inter', sans-serif", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 };
const btnGhost = { background: COLORS.panel, color: COLORS.ink, border: `1px solid ${COLORS.line}`, borderRadius: 999, padding: "10px 18px", fontSize: 14, fontWeight: 600, fontFamily: "'Inter', sans-serif", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 };
const btnIcon = { background: COLORS.panel2, border: `1px solid ${COLORS.line}`, borderRadius: 999, color: COLORS.inkMuted, cursor: "pointer", padding: 8, display: "inline-flex" };
const tabBtn = (active) => ({ background: active ? COLORS.black : "transparent", color: active ? "#fff" : COLORS.inkMuted, border: `1px solid ${active ? COLORS.black : COLORS.line}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 600, fontFamily: "'Inter', sans-serif", cursor: "pointer", flex: 1 });

export default function CanteiroDashboard() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState("login"); // login | criar | entrar
  const [authForm, setAuthForm] = useState({ email: "", password: "", empresaNome: "", codigoEmpresa: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showEmpresaInfo, setShowEmpresaInfo] = useState(false);

  const [obras, setObras] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("overview");
  const [selectedId, setSelectedId] = useState(null);
  const [obraTab, setObraTab] = useState("resumo");
  const [showAddObra, setShowAddObra] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [obraForm, setObraForm] = useState({ name: "", budget: "", deadline: "", telefone: "" });
  const [entryForm, setEntryForm] = useState({ material: "", quantity: "", unit: "un", value: "", date: new Date().toISOString().slice(0, 10), stage: STAGES[0] });
  const [registros, setRegistros] = useState([]);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) setSession(JSON.parse(saved));
    } catch (e) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  useEffect(() => {
    if (session && selectedId && view === "detail") loadRegistros(selectedId);
  }, [session, selectedId, view]);

  async function loadRegistros(obraId) {
    try {
      const rows = await call(`registros?obra_id=eq.${obraId}&order=criado_em.desc`);
      setRegistros(
        (rows || []).map((r) => ({
          id: r.id,
          tipo: r.tipo,
          conteudo: r.conteudo,
          valor: r.valor != null ? Number(r.valor) : null,
          mediaUrl: r.media_url,
          remetente: r.remetente,
          criadoEm: r.criado_em,
        }))
      );
    } catch (e) {
      // registros do WhatsApp são opcionais — se a tabela ainda não existir, ignore em silêncio
      setRegistros([]);
    }
  }

  function persistSession(next) {
    setSession(next);
    try {
      if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  async function carregarEmpresaDoUsuario(accessToken, userId) {
    const perfis = await sb({ access_token: accessToken }, `perfis?id=eq.${userId}&select=empresa_id,nome`);
    const perfil = perfis && perfis[0];
    if (!perfil) throw new Error("Perfil não encontrado para este usuário.");
    const empresas = await sb({ access_token: accessToken }, `empresas?id=eq.${perfil.empresa_id}&select=id,nome`);
    const empresa = empresas && empresas[0];
    return { id: empresa?.id || perfil.empresa_id, nome: empresa?.nome || "Minha empresa" };
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const email = authForm.email.trim();
      const password = authForm.password;
      if (!email || !password) throw new Error("Preencha e-mail e senha.");

      if (authMode === "login") {
        const data = await authRequest("token?grant_type=password", { email, password });
        const empresa = await carregarEmpresaDoUsuario(data.access_token, data.user.id);
        persistSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: { id: data.user.id, email: data.user.email }, empresa });
        return;
      }

      if (authMode === "criar" && !authForm.empresaNome.trim()) throw new Error("Dê um nome para a sua empresa.");
      if (authMode === "entrar" && !authForm.codigoEmpresa.trim()) throw new Error("Cole o código da empresa que você recebeu.");

      const signUpData = await authRequest("signup", { email, password });
      if (!signUpData.access_token) {
        throw new Error("Cadastro feito, mas é preciso confirmar o e-mail antes de entrar. Verifique sua caixa de entrada e depois faça login.");
      }
      const accessToken = signUpData.access_token;
      const userId = signUpData.user.id;

      let empresaId;
      if (authMode === "criar") {
        // Não pedimos o registro de volta (return=representation) aqui: logo após
        // o INSERT ainda não existe um perfil ligando este usuário à empresa, então
        // a política de SELECT bloquearia o RETURNING e a operação toda falharia
        // com "row-level security policy". Geramos o id no navegador e seguimos.
        empresaId = crypto.randomUUID();
        await sb({ access_token: accessToken }, "empresas", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ id: empresaId, nome: authForm.empresaNome.trim() }),
        });
      } else {
        empresaId = authForm.codigoEmpresa.trim();
      }

      await sb({ access_token: accessToken }, "perfis", {
        method: "POST",
        body: JSON.stringify({ id: userId, empresa_id: empresaId }),
      });

      const empresa = await carregarEmpresaDoUsuario(accessToken, userId);
      persistSession({ access_token: accessToken, refresh_token: signUpData.refresh_token, user: { id: userId, email }, empresa });
    } catch (err) {
      setAuthError(err.message || "Não consegui completar essa ação.");
    }
    setAuthLoading(false);
  }

  function logout() {
    persistSession(null);
    setObras([]);
    setEntries([]);
    setRegistros([]);
    setView("overview");
    setShowEmpresaInfo(false);
  }

  // O token de acesso do Supabase expira depois de um tempo (ex.: 1h). Sem isso,
  // qualquer uso do painel além desse tempo passava a falhar com "JWT expired" —
  // inclusive dando a impressão de que uma obra cadastrada "sumiu" ao dar F5,
  // quando na verdade ela continuava salva, só a leitura é que falhava.
  async function renovarSessao(atual) {
    const data = await authRequest("token?grant_type=refresh_token", { refresh_token: atual.refresh_token });
    const nova = { ...atual, access_token: data.access_token, refresh_token: data.refresh_token };
    persistSession(nova);
    return nova;
  }

  // Chamada autenticada ao banco que renova a sessão sozinha e repete a
  // requisição uma vez, caso o token tenha expirado no meio do uso.
  async function call(path, options = {}) {
    try {
      return await sb(session, path, options);
    } catch (e) {
      if (e.status === 401 && session?.refresh_token) {
        try {
          const novaSessao = await renovarSessao(session);
          return await sb(novaSessao, path, options);
        } catch (e2) {
          logout();
          throw new Error("Sua sessão expirou. Faça login novamente.");
        }
      }
      throw e;
    }
  }

  async function loadData() {
    setSyncing(true);
    setError("");
    try {
      const rawObras = await call("obras?select=*&order=start_date.desc");
      const rawEntries = await call("materiais?select=*");
      setObras(
        rawObras.map((o) => ({ id: o.id, name: o.name, budget: Number(o.budget), deadline: o.deadline, startDate: o.start_date, progress: o.progress }))
      );
      setEntries(
        rawEntries.map((e) => ({ id: e.id, obraId: e.obra_id, material: e.material, quantity: e.quantity, unit: e.unit, value: Number(e.value), date: e.date, stage: e.stage }))
      );
    } catch (e) {
      setError(e.message || "Não consegui conectar no banco.");
    }
    setSyncing(false);
  }

  const stats = useMemo(() => {
    const map = {};
    obras.forEach((o) => {
      const list = entries.filter((e) => e.obraId === o.id);
      const spent = list.reduce((s, e) => s + Number(e.value || 0), 0);
      const budgetPct = o.budget > 0 ? (spent / o.budget) * 100 : 0;
      map[o.id] = { spent, budgetPct, status: statusFor(o.progress, budgetPct), count: list.length };
    });
    return map;
  }, [obras, entries]);

  const totalGasto = Object.values(stats).reduce((s, x) => s + x.spent, 0);
  const emRisco = obras.filter((o) => stats[o.id]?.status.key === "risco").length;

  async function addObra() {
    // Orçamento é opcional — muita gente começa a obra sem ter um valor fechado ainda.
    if (!obraForm.name.trim()) return;
    const obra = { id: uid(), empresa_id: session.empresa.id, name: obraForm.name.trim(), budget: obraForm.budget ? Number(obraForm.budget) : 0, deadline: obraForm.deadline || null, telefone: obraForm.telefone.trim() || null, start_date: new Date().toISOString().slice(0, 10), progress: 0 };
    try {
      await call("obras", { method: "POST", body: JSON.stringify(obra) });
      setObraForm({ name: "", budget: "", deadline: "", telefone: "" });
      setShowAddObra(false);
      loadData();
    } catch (e) {
      setError(e.message || "Não consegui salvar a obra no banco.");
    }
  }

  async function addEntry() {
    if (!entryForm.material.trim() || !entryForm.value) return;
    const entry = { id: uid(), obra_id: selectedId, material: entryForm.material.trim(), quantity: entryForm.quantity, unit: entryForm.unit, value: Number(entryForm.value), date: entryForm.date, stage: entryForm.stage };
    try {
      await call("materiais", { method: "POST", body: JSON.stringify(entry) });
      setEntryForm({ material: "", quantity: "", unit: "un", value: "", date: new Date().toISOString().slice(0, 10), stage: STAGES[0] });
      setShowAddEntry(false);
      loadData();
    } catch (e) {
      setError(e.message || "Não consegui salvar o lançamento no banco.");
    }
  }

  async function updateProgress(id, value) {
    setObras(obras.map((o) => (o.id === id ? { ...o, progress: value } : o)));
    try {
      await call(`obras?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ progress: value }) });
    } catch (e) {
      setError(e.message || "Não consegui atualizar o progresso no banco.");
    }
  }

  async function deleteEntry(id) {
    try {
      await call(`materiais?id=eq.${id}`, { method: "DELETE" });
      loadData();
    } catch (e) {
      setError(e.message || "Não consegui excluir o lançamento.");
    }
  }

  async function deleteObra(id) {
    try {
      await call(`materiais?obra_id=eq.${id}`, { method: "DELETE" });
      await call(`obras?id=eq.${id}`, { method: "DELETE" });
      setView("overview");
      loadData();
    } catch (e) {
      setError(e.message || "Não consegui excluir a obra.");
    }
  }

  function abrirObra(id) {
    setSelectedId(id);
    setObraTab("resumo");
    setBusca("");
    setView("detail");
  }

  const selectedObra = obras.find((o) => o.id === selectedId);
  const selectedEntries = entries.filter((e) => e.obraId === selectedId).sort((a, b) => (a.date < b.date ? 1 : -1));

  const diario = useMemo(() => {
    const doMaterial = selectedEntries.map((e) => ({
      id: "m-" + e.id,
      icon: Package,
      titulo: e.material,
      subtitulo: `${e.quantity} ${e.unit} · etapa ${e.stage}`,
      valor: e.value,
      data: e.date,
      ordenacao: e.date,
    }));
    const doRegistro = registros.map((r) => ({
      id: "r-" + r.id,
      icon: r.tipo === "nota_fiscal" ? FileText : r.tipo === "foto" ? Camera : r.tipo === "audio" ? Mic : r.tipo === "documento" ? Paperclip : MessageCircle,
      titulo: r.tipo.replace("_", " "),
      subtitulo: r.conteudo || "Registrado pelo WhatsApp",
      valor: r.valor,
      data: r.criadoEm,
      ordenacao: r.criadoEm,
    }));
    return [...doMaterial, ...doRegistro]
      .filter((item) => !busca.trim() || `${item.titulo} ${item.subtitulo}`.toLowerCase().includes(busca.toLowerCase()))
      .sort((a, b) => (a.ordenacao < b.ordenacao ? 1 : -1));
  }, [selectedEntries, registros, busca]);

  const documentos = useMemo(
    () =>
      registros
        .filter((r) => r.tipo === "nota_fiscal" || r.tipo === "documento")
        .filter((r) => !busca.trim() || (r.conteudo || "").toLowerCase().includes(busca.toLowerCase())),
    [registros, busca]
  );

  const fotos = useMemo(() => registros.filter((r) => r.tipo === "foto"), [registros]);

  const etapas = useMemo(() => {
    return STAGES.map((stage) => {
      const list = selectedEntries.filter((e) => e.stage === stage);
      return { stage, count: list.length, total: list.reduce((s, e) => s + Number(e.value || 0), 0) };
    });
  }, [selectedEntries]);

  const wrapStyle = { background: COLORS.bg, minHeight: 560, padding: 24, borderRadius: 12, fontFamily: "'Inter', sans-serif", color: COLORS.ink };

  const fontImport = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      input[type="range"] { accent-color: ${COLORS.green}; }
      ::placeholder { color: ${COLORS.inkMuted}; opacity: 0.7; }
      select option { background: ${COLORS.panel}; }
    `}</style>
  );

  if (loading) {
    return (
      <div style={{ ...wrapStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: COLORS.inkMuted, fontSize: 13 }}>carregando canteiro...</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ ...wrapStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {fontImport}
        <div style={{ maxWidth: 400, width: "100%", background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: 24, boxShadow: "0 20px 50px rgba(11,18,32,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Logomark />
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 800, margin: 0 }}>Viga Automações</h2>
          </div>
          <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: "0 0 16px" }}>
            Cada empresa tem seu próprio login e painel — só você vê suas obras.
          </p>

          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            <button type="button" style={tabBtn(authMode === "login")} onClick={() => { setAuthMode("login"); setAuthError(""); }}>Entrar</button>
            <button type="button" style={tabBtn(authMode === "criar")} onClick={() => { setAuthMode("criar"); setAuthError(""); }}>Criar empresa</button>
            <button type="button" style={tabBtn(authMode === "entrar")} onClick={() => { setAuthMode("entrar"); setAuthError(""); }}>Tenho um código</button>
          </div>

          <form onSubmit={handleAuthSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {authMode === "criar" && (
              <div>
                <label style={labelStyle}>Nome da empresa</label>
                <input style={inputStyle} placeholder="Construtora Exemplo" value={authForm.empresaNome} onChange={(e) => setAuthForm({ ...authForm, empresaNome: e.target.value })} />
              </div>
            )}
            {authMode === "entrar" && (
              <div>
                <label style={labelStyle}>Código da empresa</label>
                <input style={inputStyle} placeholder="cole o código que um colega te mandou" value={authForm.codigoEmpresa} onChange={(e) => setAuthForm({ ...authForm, codigoEmpresa: e.target.value })} />
              </div>
            )}
            <div>
              <label style={labelStyle}>E-mail</label>
              <input style={inputStyle} type="email" placeholder="voce@empresa.com" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Senha</label>
              <input style={inputStyle} type="password" placeholder="mínimo 6 caracteres" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
            </div>
            {authError && (
              <div style={{ background: COLORS.red + "14", border: `1px solid ${COLORS.red}33`, color: COLORS.red, borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>
                {authError}
              </div>
            )}
            <button type="submit" disabled={authLoading} style={{ ...btnPrimary, justifyContent: "center", marginTop: 6, opacity: authLoading ? 0.6 : 1 }}>
              {authLoading ? "Aguarde..." : authMode === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      {fontImport}

      {error && (
        <div style={{ background: COLORS.red + "14", border: `1px solid ${COLORS.red}33`, color: COLORS.red, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {view === "overview" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logomark size={30} />
              <div>
                <h1 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 800, margin: 0 }}>Canteiro</h1>
                <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: "2px 0 0" }}>{session.empresa.nome} · controle de material, prazo e custo por obra</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btnIcon} onClick={loadData} aria-label="Sincronizar">
                <RefreshCw size={16} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
              </button>
              <button style={btnIcon} onClick={() => setShowEmpresaInfo(true)} aria-label="Minha empresa">
                <Settings size={16} />
              </button>
              <button style={btnPrimary} onClick={() => setShowAddObra(true)}>
                <Plus size={16} /> Nova obra
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 28 }}>
            <StatCard icon={<Building2 size={16} />} label="Obras ativas" value={obras.length} />
            <StatCard icon={<TrendingUp size={16} />} label="Total investido" value={formatBRL(totalGasto)} />
            <StatCard icon={<AlertTriangle size={16} />} label="Em risco" value={emRisco} tone={emRisco > 0 ? COLORS.red : COLORS.green} />
          </div>

          {obras.length === 0 ? (
            <div style={{ border: `1px dashed ${COLORS.line}`, background: COLORS.panel, borderRadius: 16, padding: 40, textAlign: "center" }}>
              <Building2 size={28} color={COLORS.inkMuted} style={{ marginBottom: 12 }} />
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>Cadastre sua primeira obra</p>
              <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: "0 0 16px" }}>Só o nome já basta para começar — orçamento e prazo são opcionais.</p>
              <button style={btnPrimary} onClick={() => setShowAddObra(true)}><Plus size={16} /> Nova obra</button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
              {obras.map((o) => {
                const s = stats[o.id];
                return (
                  <div key={o.id} onClick={() => abrirObra(o.id)} style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: 18, cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, margin: 0 }}>{o.name}</p>
                        <p style={{ color: COLORS.inkMuted, fontSize: 12, margin: "4px 0 0" }}>{o.budget ? `${formatBRL(o.budget)} orçado` : "sem orçamento definido"} · prazo {formatDateBR(o.deadline)}</p>
                      </div>
                      <Badge label={s.status.label} tone={s.status.tone} />
                    </div>
                    <RulerBar progress={o.progress} budgetPct={s.budgetPct} tone={s.status.tone} />
                    <p style={{ color: COLORS.inkMuted, fontSize: 11, marginTop: 10 }}>{s.count} lançamento{s.count !== 1 ? "s" : ""} · gasto {formatBRL(s.spent)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {view === "detail" && selectedObra && (
        <>
          <button style={{ ...btnGhost, marginBottom: 20 }} onClick={() => setView("overview")}><ArrowLeft size={16} /> Voltar</button>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, fontWeight: 800, margin: 0 }}>{selectedObra.name}</h2>
              <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: "4px 0 0" }}>início {formatDateBR(selectedObra.startDate)} · prazo {formatDateBR(selectedObra.deadline)}</p>
            </div>
            <button style={{ ...btnGhost, color: COLORS.red }} onClick={() => deleteObra(selectedObra.id)}><Trash2 size={14} /> Excluir obra</button>
          </div>

          <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 190, background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: 10 }}>
              {OBRA_TABS.map((t) => {
                const Icon = t.icon;
                const active = obraTab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => { setObraTab(t.key); setBusca(""); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                      background: active ? COLORS.black : "transparent",
                      color: active ? "#fff" : COLORS.ink,
                      border: "none", borderRadius: 10, padding: "10px 12px",
                      fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    <Icon size={15} />
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div style={{ flex: "1 1 420px", background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: 22, minHeight: 360 }}>
              {obraTab === "resumo" && (
                <div>
                  <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 800, margin: "0 0 16px" }}>Visão geral</h3>
                  <RulerBar progress={selectedObra.progress} budgetPct={stats[selectedObra.id].budgetPct} tone={stats[selectedObra.id].status.tone} size="lg" />
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 20 }}>
                    <div>
                      <p style={{ color: COLORS.inkMuted, fontSize: 11, margin: 0 }}>orçado</p>
                      <p style={{ fontSize: 17, fontWeight: 700, margin: "2px 0 0" }}>{formatOrcamento(selectedObra.budget)}</p>
                    </div>
                    <div>
                      <p style={{ color: COLORS.inkMuted, fontSize: 11, margin: 0 }}>gasto</p>
                      <p style={{ fontSize: 17, fontWeight: 700, margin: "2px 0 0", color: stats[selectedObra.id].status.tone }}>{formatBRL(stats[selectedObra.id].spent)}</p>
                    </div>
                    <div>
                      <p style={{ color: COLORS.inkMuted, fontSize: 11, margin: 0 }}>progresso físico</p>
                      <p style={{ fontSize: 17, fontWeight: 700, margin: "2px 0 0" }}>{selectedObra.progress}%</p>
                    </div>
                    <div>
                      <p style={{ color: COLORS.inkMuted, fontSize: 11, margin: 0 }}>prazo</p>
                      <p style={{ fontSize: 17, fontWeight: 700, margin: "2px 0 0" }}>{formatDateBR(selectedObra.deadline)}</p>
                    </div>
                  </div>
                  {stats[selectedObra.id].status.key !== "ok" && (
                    <div style={{ marginTop: 20, background: stats[selectedObra.id].status.tone + "14", border: `1px solid ${stats[selectedObra.id].status.tone}33`, color: stats[selectedObra.id].status.tone, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
                      O gasto está avançando mais rápido que o progresso físico da obra. Vale revisar o orçamento.
                    </div>
                  )}
                </div>
              )}

              {obraTab === "orcamento" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 800, margin: 0 }}>Orçamento e lançamentos</h3>
                    <button style={btnPrimary} onClick={() => setShowAddEntry(true)}><Plus size={16} /> Registrar material</button>
                  </div>
                  {selectedEntries.length === 0 ? (
                    <EmptyState icon={<Package size={22} color={COLORS.inkMuted} />} text="Nenhum material registrado ainda." />
                  ) : (
                    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
                      {selectedEntries.map((e, i) => (
                        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${COLORS.line}` }}>
                          <Calendar size={14} color={COLORS.inkMuted} />
                          <span style={{ fontSize: 12, color: COLORS.inkMuted, width: 76 }}>{formatDateBR(e.date)}</span>
                          <span style={{ flex: 1, fontSize: 14 }}>{e.material}</span>
                          <span style={{ color: COLORS.inkMuted, fontSize: 12 }}>{e.quantity} {e.unit}</span>
                          <Badge label={e.stage} tone={COLORS.indigo} />
                          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 90, textAlign: "right" }}>{formatBRL(e.value)}</span>
                          <button style={btnIcon} onClick={() => deleteEntry(e.id)} aria-label="Excluir lançamento"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {obraTab === "cronograma" && (
                <div>
                  <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 800, margin: "0 0 16px" }}>Cronograma</h3>
                  <div style={{ marginBottom: 20 }}>
                    <label style={labelStyle}>Progresso físico da obra: {selectedObra.progress}%</label>
                    <input type="range" min="0" max="100" step="1" value={selectedObra.progress} onChange={(e) => updateProgress(selectedObra.id, Number(e.target.value))} style={{ width: "100%" }} />
                  </div>
                  <div style={{ display: "flex", gap: 24, marginBottom: 20, flexWrap: "wrap" }}>
                    <div>
                      <p style={{ color: COLORS.inkMuted, fontSize: 11, margin: 0 }}>prazo de entrega</p>
                      <p style={{ fontSize: 15, fontWeight: 700, margin: "2px 0 0" }}>{formatDateBR(selectedObra.deadline)}</p>
                    </div>
                    <div>
                      <p style={{ color: COLORS.inkMuted, fontSize: 11, margin: 0 }}>situação do prazo</p>
                      <p style={{ fontSize: 15, fontWeight: 700, margin: "2px 0 0" }}>
                        {diasParaPrazo(selectedObra.deadline) == null
                          ? "sem prazo definido"
                          : diasParaPrazo(selectedObra.deadline) < 0
                          ? `prazo vencido há ${Math.abs(diasParaPrazo(selectedObra.deadline))} dia(s)`
                          : `faltam ${diasParaPrazo(selectedObra.deadline)} dia(s)`}
                      </p>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: COLORS.inkMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, margin: "0 0 10px" }}>Etapas da obra</p>
                  <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
                    {etapas.map((et, i) => (
                      <div key={et.stage} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${COLORS.line}` }}>
                        {et.count > 0 ? <CheckCircle2 size={16} color={COLORS.green} /> : <span style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${COLORS.line}`, display: "inline-block" }} />}
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{et.stage}</span>
                        <span style={{ fontSize: 12, color: COLORS.inkMuted }}>{et.count} lançamento{et.count !== 1 ? "s" : ""}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, minWidth: 90, textAlign: "right" }}>{formatBRL(et.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {obraTab === "diario" && (
                <div>
                  <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 800, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
                    <BookOpen size={16} color={COLORS.green} /> Diário de obra
                  </h3>
                  <SearchBox value={busca} onChange={setBusca} />
                  {diario.length === 0 ? (
                    <EmptyState icon={<BookOpen size={22} color={COLORS.inkMuted} />} text="Nenhum registro ainda. Lançamentos e mensagens do WhatsApp aparecem aqui em ordem cronológica." />
                  ) : (
                    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
                      {diario.map((item, i) => {
                        const Icone = item.icon;
                        return (
                          <div key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${COLORS.line}` }}>
                            <Icone size={16} color={COLORS.green} style={{ marginTop: 2 }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, textTransform: "capitalize" }}>{item.titulo}</span>
                                <span style={{ fontSize: 11, color: COLORS.inkMuted }}>{item.data ? formatDateAnyBR(item.data) : ""}</span>
                              </div>
                              {item.subtitulo && <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.inkMuted }}>{item.subtitulo}</p>}
                              {item.valor != null && <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 700 }}>{formatBRL(item.valor)}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {obraTab === "documentos" && (
                <div>
                  <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 800, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
                    <Folder size={16} color={COLORS.amber} /> Documentos e notas fiscais
                  </h3>
                  <SearchBox value={busca} onChange={setBusca} />
                  {documentos.length === 0 ? (
                    <EmptyState icon={<Folder size={22} color={COLORS.inkMuted} />} text="Nenhum documento ainda. Envie notas fiscais ou arquivos pelo WhatsApp conectado à obra." />
                  ) : (
                    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
                      {documentos.map((r, i) => (
                        <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${COLORS.line}` }}>
                          {r.tipo === "nota_fiscal" ? <FileText size={16} color={COLORS.green} style={{ marginTop: 2 }} /> : <Paperclip size={16} color={COLORS.amber} style={{ marginTop: 2 }} />}
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <Badge label={r.tipo.replace("_", " ")} tone={r.tipo === "nota_fiscal" ? COLORS.green : COLORS.amber} />
                              <span style={{ fontSize: 11, color: COLORS.inkMuted }}>{formatDateAnyBR(r.criadoEm)}</span>
                            </div>
                            {r.conteudo && <p style={{ margin: "6px 0 0", fontSize: 13, color: COLORS.inkMuted }}>{r.conteudo}</p>}
                            {r.valor != null && <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 700 }}>{formatBRL(r.valor)}</p>}
                            {r.mediaUrl && <a href={r.mediaUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: COLORS.green, fontWeight: 600 }}>Abrir arquivo</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {obraTab === "fotos" && (
                <div>
                  <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 800, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
                    <ImageIcon size={16} color={COLORS.indigo} /> Fotos da obra
                  </h3>
                  {fotos.length === 0 ? (
                    <EmptyState icon={<Camera size={22} color={COLORS.inkMuted} />} text="Nenhuma foto ainda. Envie fotos do canteiro pelo WhatsApp conectado à obra." />
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
                      {fotos.map((r) => (
                        <a key={r.id} href={r.mediaUrl || undefined} target="_blank" rel="noreferrer" style={{ display: "block", border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden", background: COLORS.panel2, textDecoration: "none" }}>
                          {r.mediaUrl ? (
                            <img src={r.mediaUrl} alt={r.conteudo || "Foto da obra"} style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
                          ) : (
                            <div style={{ width: "100%", height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Camera size={22} color={COLORS.inkMuted} />
                            </div>
                          )}
                          <p style={{ margin: 0, padding: "8px 10px", fontSize: 11, color: COLORS.inkMuted }}>{formatDateAnyBR(r.criadoEm)}</p>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {showEmpresaInfo && (
        <Modal title="Minha empresa" onClose={() => setShowEmpresaInfo(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Empresa</label>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{session.empresa.nome}</p>
            </div>
            <div>
              <label style={labelStyle}>Logado como</label>
              <p style={{ margin: 0, fontSize: 14, color: COLORS.inkMuted }}>{session.user.email}</p>
            </div>
            <div>
              <label style={labelStyle}>
                <Users size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                Código para convidar colegas para esta mesma empresa
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...inputStyle, fontSize: 12 }} readOnly value={session.empresa.id} />
                <button
                  style={btnIcon}
                  onClick={() => navigator.clipboard?.writeText(session.empresa.id)}
                  aria-label="Copiar código"
                >
                  <Copy size={16} />
                </button>
              </div>
              <p style={{ color: COLORS.inkMuted, fontSize: 12, margin: "6px 0 0" }}>
                Um colega cria a própria conta escolhendo "Tenho um código" e colando isso aí — ele entra na mesma empresa e vê as mesmas obras.
              </p>
            </div>
            <button style={{ ...btnGhost, justifyContent: "center", color: COLORS.red }} onClick={logout}>
              <LogOut size={16} /> Sair da conta
            </button>
          </div>
        </Modal>
      )}

      {showAddObra && (
        <Modal title="Nova obra" onClose={() => setShowAddObra(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Nome da obra</label>
              <input style={inputStyle} placeholder="Casa Rua das Flores" value={obraForm.name} onChange={(e) => setObraForm({ ...obraForm, name: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Orçamento planejado (R$) · opcional</label>
              <input style={inputStyle} type="number" placeholder="deixe em branco se ainda não tiver um valor fechado" value={obraForm.budget} onChange={(e) => setObraForm({ ...obraForm, budget: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Prazo de entrega</label>
              <input style={inputStyle} type="date" value={obraForm.deadline} onChange={(e) => setObraForm({ ...obraForm, deadline: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>WhatsApp do responsável (para receber alertas e registros)</label>
              <input style={inputStyle} placeholder="5511999999999" value={obraForm.telefone} onChange={(e) => setObraForm({ ...obraForm, telefone: e.target.value })} />
            </div>
            <button style={{ ...btnPrimary, justifyContent: "center", marginTop: 6 }} onClick={addObra}>Cadastrar obra</button>
          </div>
        </Modal>
      )}

      {showAddEntry && (
        <Modal title="Registrar material" onClose={() => setShowAddEntry(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Material</label>
              <input style={inputStyle} placeholder="Cimento CP-II" value={entryForm.material} onChange={(e) => setEntryForm({ ...entryForm, material: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Quantidade</label>
                <input style={inputStyle} placeholder="20" value={entryForm.quantity} onChange={(e) => setEntryForm({ ...entryForm, quantity: e.target.value })} />
              </div>
              <div style={{ width: 100 }}>
                <label style={labelStyle}>Unidade</label>
                <input style={inputStyle} placeholder="sacos" value={entryForm.unit} onChange={(e) => setEntryForm({ ...entryForm, unit: e.target.value })} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Valor total (R$)</label>
              <input style={inputStyle} type="number" placeholder="1200" value={entryForm.value} onChange={(e) => setEntryForm({ ...entryForm, value: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Data</label>
                <input style={inputStyle} type="date" value={entryForm.date} onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Etapa</label>
                <select style={inputStyle} value={entryForm.stage} onChange={(e) => setEntryForm({ ...entryForm, stage: e.target.value })}>
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <button style={{ ...btnPrimary, justifyContent: "center", marginTop: 6 }} onClick={addEntry}>Registrar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SearchBox({ value, onChange }) {
  return (
    <div style={{ position: "relative", marginBottom: 14 }}>
      <Search size={14} color={COLORS.inkMuted} style={{ position: "absolute", left: 12, top: 12 }} />
      <input
        style={{ ...inputStyle, paddingLeft: 34 }}
        placeholder="Buscar..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div style={{ border: `1px dashed ${COLORS.line}`, borderRadius: 12, padding: 28, textAlign: "center" }}>
      <div style={{ marginBottom: 8 }}>{icon}</div>
      <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: 0 }}>{text}</p>
    </div>
  );
}

function StatCard({ icon, label, value, tone }) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: COLORS.inkMuted, marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 12 }}>{label}</span>
      </div>
      <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 800, margin: 0, color: tone || COLORS.ink }}>{value}</p>
    </div>
  );
}
