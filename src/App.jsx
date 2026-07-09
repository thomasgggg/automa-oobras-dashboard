import React, { useState, useEffect, useMemo } from "react";
import {
  Plus, ArrowLeft, Trash2, Building2, Settings,
  AlertTriangle, Ruler, X, Package, Calendar, TrendingUp, RefreshCw,
  MessageCircle, FileText, Camera, Mic, Paperclip, Search, LogOut, Copy, Users
} from "lucide-react";

// Projeto Supabase da Viga Automações (chave "publishable", segura para o navegador).
const SUPABASE_URL = "https://mmueohqmxiovdqwaenks.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gZiaA77FbWf_GbQhsN-lQA_Jo-t1eUe";
const SESSION_KEY = "viga-session";

const COLORS = {
  bg: "#101E30",
  panel: "#16283F",
  panel2: "#1D3350",
  line: "rgba(255,255,255,0.08)",
  ink: "#EFF4F8",
  inkMuted: "#8FA3BB",
  cyan: "#5BC8DA",
  safety: "#FF7A3D",
  caution: "#F2C14E",
  ok: "#59C98A",
  brick: "#D9694C",
};

const STAGES = ["Fundação", "Estrutura", "Alvenaria", "Instalações", "Acabamento", "Outro"];

function formatBRL(v) {
  const n = Number(v) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatDateBR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function statusFor(progress, budgetPct) {
  const diff = budgetPct - progress;
  if (diff > 20) return { label: "Risco alto", tone: COLORS.safety, key: "risco" };
  if (diff > 10) return { label: "Atenção", tone: COLORS.caution, key: "atencao" };
  return { label: "Em dia", tone: COLORS.ok, key: "ok" };
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
    throw new Error(errText || `Erro ${res.status}`);
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

function RulerBar({ progress, budgetPct, tone, size = "md" }) {
  const p = Math.max(0, Math.min(100, progress));
  const b = Math.max(0, Math.min(100, budgetPct));
  const height = size === "lg" ? 40 : 26;
  return (
    <div>
      <div
        style={{
          position: "relative",
          height,
          borderRadius: 6,
          background: "rgba(255,255,255,0.05)",
          backgroundImage:
            "repeating-linear-gradient(to right, rgba(255,255,255,0.16) 0, rgba(255,255,255,0.16) 1px, transparent 1px, transparent 10%)",
          overflow: "hidden",
          border: `0.5px solid ${COLORS.line}`,
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, height: "50%", width: p + "%", background: COLORS.cyan, transition: "width 0.3s ease" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, height: "50%", width: b + "%", background: tone, transition: "width 0.3s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: COLORS.inkMuted }}>
        <span>física {Math.round(p)}%</span>
        <span>financeira {Math.round(b)}%</span>
      </div>
    </div>
  );
}

function Badge({ label, tone }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", padding: "3px 10px", borderRadius: 999, background: tone + "22", color: tone, border: `0.5px solid ${tone}55` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone }} />
      {label}
    </span>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(6,12,20,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.panel, border: `0.5px solid ${COLORS.line}`, borderRadius: 12, padding: 24, width: "100%", maxWidth: 440, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, color: COLORS.ink, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={btnIcon}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: "100%", background: COLORS.panel2, border: `0.5px solid ${COLORS.line}`, borderRadius: 8, padding: "9px 12px", color: COLORS.ink, fontSize: 14, fontFamily: "'Inter', sans-serif", outline: "none", boxSizing: "border-box" };
const labelStyle = { fontSize: 12, color: COLORS.inkMuted, marginBottom: 6, display: "block", fontFamily: "'Inter', sans-serif" };
const btnPrimary = { background: COLORS.cyan, color: "#08222B", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600, fontFamily: "'Inter', sans-serif", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 };
const btnGhost = { background: "transparent", color: COLORS.ink, border: `0.5px solid ${COLORS.line}`, borderRadius: 8, padding: "10px 16px", fontSize: 14, fontFamily: "'Inter', sans-serif", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 };
const btnIcon = { background: "transparent", border: "none", color: COLORS.inkMuted, cursor: "pointer", padding: 4, display: "inline-flex" };
const tabBtn = (active) => ({ background: active ? COLORS.panel2 : "transparent", color: active ? COLORS.ink : COLORS.inkMuted, border: `0.5px solid ${active ? COLORS.cyan + "55" : COLORS.line}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontFamily: "'Inter', sans-serif", cursor: "pointer", flex: 1 });

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
  const [showAddObra, setShowAddObra] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [obraForm, setObraForm] = useState({ name: "", budget: "", deadline: "", telefone: "" });
  const [entryForm, setEntryForm] = useState({ material: "", quantity: "", unit: "un", value: "", date: new Date().toISOString().slice(0, 10), stage: STAGES[0] });
  const [registros, setRegistros] = useState([]);
  const [registroBusca, setRegistroBusca] = useState("");
  const [registroFiltro, setRegistroFiltro] = useState("todos");

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
      const rows = await sb(session, `registros?obra_id=eq.${obraId}&order=criado_em.desc`);
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
        const [novaEmpresa] = await sb({ access_token: accessToken }, "empresas", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ nome: authForm.empresaNome.trim() }),
        });
        empresaId = novaEmpresa.id;
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

  async function loadData() {
    setSyncing(true);
    setError("");
    try {
      const rawObras = await sb(session, "obras?select=*&order=start_date.desc");
      const rawEntries = await sb(session, "materiais?select=*");
      setObras(
        rawObras.map((o) => ({ id: o.id, name: o.name, budget: Number(o.budget), deadline: o.deadline, startDate: o.start_date, progress: o.progress }))
      );
      setEntries(
        rawEntries.map((e) => ({ id: e.id, obraId: e.obra_id, material: e.material, quantity: e.quantity, unit: e.unit, value: Number(e.value), date: e.date, stage: e.stage }))
      );
    } catch (e) {
      setError(`Não consegui conectar no banco: ${e.message || "erro desconhecido"}`);
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
    if (!obraForm.name.trim() || !obraForm.budget) return;
    const obra = { id: uid(), empresa_id: session.empresa.id, name: obraForm.name.trim(), budget: Number(obraForm.budget), deadline: obraForm.deadline || null, telefone: obraForm.telefone.trim() || null, start_date: new Date().toISOString().slice(0, 10), progress: 0 };
    try {
      await sb(session, "obras", { method: "POST", body: JSON.stringify(obra) });
      setObraForm({ name: "", budget: "", deadline: "", telefone: "" });
      setShowAddObra(false);
      loadData();
    } catch (e) {
      setError("Não consegui salvar a obra no banco.");
    }
  }

  async function addEntry() {
    if (!entryForm.material.trim() || !entryForm.value) return;
    const entry = { id: uid(), obra_id: selectedId, material: entryForm.material.trim(), quantity: entryForm.quantity, unit: entryForm.unit, value: Number(entryForm.value), date: entryForm.date, stage: entryForm.stage };
    try {
      await sb(session, "materiais", { method: "POST", body: JSON.stringify(entry) });
      setEntryForm({ material: "", quantity: "", unit: "un", value: "", date: new Date().toISOString().slice(0, 10), stage: STAGES[0] });
      setShowAddEntry(false);
      loadData();
    } catch (e) {
      setError("Não consegui salvar o lançamento no banco.");
    }
  }

  async function updateProgress(id, value) {
    setObras(obras.map((o) => (o.id === id ? { ...o, progress: value } : o)));
    try {
      await sb(session, `obras?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ progress: value }) });
    } catch (e) {
      setError("Não consegui atualizar o progresso no banco.");
    }
  }

  async function deleteEntry(id) {
    try {
      await sb(session, `materiais?id=eq.${id}`, { method: "DELETE" });
      loadData();
    } catch (e) {
      setError("Não consegui excluir o lançamento.");
    }
  }

  async function deleteObra(id) {
    try {
      await sb(session, `materiais?obra_id=eq.${id}`, { method: "DELETE" });
      await sb(session, `obras?id=eq.${id}`, { method: "DELETE" });
      setView("overview");
      loadData();
    } catch (e) {
      setError("Não consegui excluir a obra.");
    }
  }

  const selectedObra = obras.find((o) => o.id === selectedId);
  const selectedEntries = entries.filter((e) => e.obraId === selectedId).sort((a, b) => (a.date < b.date ? 1 : -1));

  const wrapStyle = { background: COLORS.bg, minHeight: 560, padding: 24, borderRadius: 12, fontFamily: "'Inter', sans-serif", color: COLORS.ink, backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)", backgroundSize: "28px 28px" };

  const fontImport = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
      input[type="range"] { accent-color: ${COLORS.cyan}; }
      ::placeholder { color: ${COLORS.inkMuted}; opacity: 0.7; }
      select option { background: ${COLORS.panel2}; }
    `}</style>
  );

  if (loading) {
    return (
      <div style={{ ...wrapStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: COLORS.inkMuted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>carregando canteiro...</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ ...wrapStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {fontImport}
        <div style={{ maxWidth: 400, width: "100%", background: COLORS.panel, border: `0.5px solid ${COLORS.line}`, borderRadius: 12, padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Ruler size={20} color={COLORS.cyan} />
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 600, margin: 0 }}>Viga Automações</h2>
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
              <div style={{ background: COLORS.safety + "22", border: `0.5px solid ${COLORS.safety}55`, color: COLORS.safety, borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
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
        <div style={{ background: COLORS.safety + "22", border: `0.5px solid ${COLORS.safety}55`, color: COLORS.safety, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {view === "overview" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Ruler size={20} color={COLORS.cyan} />
                <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 600, margin: 0 }}>Canteiro</h1>
              </div>
              <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: "4px 0 0 30px" }}>{session.empresa.nome} · controle de material, prazo e custo por obra</p>
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
            <StatCard icon={<AlertTriangle size={16} />} label="Em risco" value={emRisco} tone={emRisco > 0 ? COLORS.safety : COLORS.ok} />
          </div>

          {obras.length === 0 ? (
            <div style={{ border: `0.5px dashed ${COLORS.line}`, borderRadius: 12, padding: 40, textAlign: "center" }}>
              <Building2 size={28} color={COLORS.inkMuted} style={{ marginBottom: 12 }} />
              <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, margin: "0 0 6px" }}>Cadastre sua primeira obra</p>
              <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: "0 0 16px" }}>Defina o orçamento e o prazo para começar a registrar os materiais.</p>
              <button style={btnPrimary} onClick={() => setShowAddObra(true)}><Plus size={16} /> Nova obra</button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
              {obras.map((o) => {
                const s = stats[o.id];
                return (
                  <div key={o.id} onClick={() => { setSelectedId(o.id); setView("detail"); }} style={{ background: COLORS.panel, border: `0.5px solid ${COLORS.line}`, borderRadius: 12, padding: 18, cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: 0 }}>{o.name}</p>
                        <p style={{ color: COLORS.inkMuted, fontSize: 12, margin: "4px 0 0" }}>{formatBRL(o.budget)} orçado · prazo {formatDateBR(o.deadline)}</p>
                      </div>
                      <Badge label={s.status.label} tone={s.status.tone} />
                    </div>
                    <RulerBar progress={o.progress} budgetPct={s.budgetPct} tone={s.status.tone} />
                    <p style={{ color: COLORS.inkMuted, fontSize: 11, marginTop: 10, fontFamily: "'IBM Plex Mono', monospace" }}>{s.count} lançamento{s.count !== 1 ? "s" : ""} · gasto {formatBRL(s.spent)}</p>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 600, margin: 0 }}>{selectedObra.name}</h2>
              <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: "4px 0 0" }}>início {formatDateBR(selectedObra.startDate)} · prazo {formatDateBR(selectedObra.deadline)}</p>
            </div>
            <button style={{ ...btnGhost, color: COLORS.brick }} onClick={() => deleteObra(selectedObra.id)}><Trash2 size={14} /> Excluir obra</button>
          </div>

          <div style={{ background: COLORS.panel, border: `0.5px solid ${COLORS.line}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <RulerBar progress={selectedObra.progress} budgetPct={stats[selectedObra.id].budgetPct} tone={stats[selectedObra.id].status.tone} size="lg" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, gap: 20, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={labelStyle}>Progresso físico da obra: {selectedObra.progress}%</label>
                <input type="range" min="0" max="100" step="1" value={selectedObra.progress} onChange={(e) => updateProgress(selectedObra.id, Number(e.target.value))} style={{ width: "100%" }} />
              </div>
              <div style={{ display: "flex", gap: 24 }}>
                <div>
                  <p style={{ color: COLORS.inkMuted, fontSize: 11, margin: 0 }}>orçado</p>
                  <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, margin: "2px 0 0" }}>{formatBRL(selectedObra.budget)}</p>
                </div>
                <div>
                  <p style={{ color: COLORS.inkMuted, fontSize: 11, margin: 0 }}>gasto</p>
                  <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, margin: "2px 0 0", color: stats[selectedObra.id].status.tone }}>{formatBRL(stats[selectedObra.id].spent)}</p>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: 0 }}>Lançamentos</h3>
            <button style={btnPrimary} onClick={() => setShowAddEntry(true)}><Plus size={16} /> Registrar material</button>
          </div>

          {selectedEntries.length === 0 ? (
            <div style={{ border: `0.5px dashed ${COLORS.line}`, borderRadius: 12, padding: 28, textAlign: "center" }}>
              <Package size={22} color={COLORS.inkMuted} style={{ marginBottom: 8 }} />
              <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: 0 }}>Nenhum material registrado ainda.</p>
            </div>
          ) : (
            <div style={{ border: `0.5px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
              {selectedEntries.map((e, i) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : `0.5px solid ${COLORS.line}`, background: COLORS.panel }}>
                  <Calendar size={14} color={COLORS.inkMuted} />
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: COLORS.inkMuted, width: 76 }}>{formatDateBR(e.date)}</span>
                  <span style={{ flex: 1, fontSize: 14 }}>{e.material}</span>
                  <span style={{ color: COLORS.inkMuted, fontSize: 12 }}>{e.quantity} {e.unit}</span>
                  <Badge label={e.stage} tone={COLORS.cyan} />
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, minWidth: 90, textAlign: "right" }}>{formatBRL(e.value)}</span>
                  <button style={btnIcon} onClick={() => deleteEntry(e.id)} aria-label="Excluir lançamento"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "28px 0 12px" }}>
            <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <MessageCircle size={16} color={COLORS.cyan} />
              Registros do WhatsApp
            </h3>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: "1 1 220px" }}>
              <Search size={14} color={COLORS.inkMuted} style={{ position: "absolute", left: 10, top: 10 }} />
              <input
                style={{ ...inputStyle, paddingLeft: 30 }}
                placeholder="Buscar registros..."
                value={registroBusca}
                onChange={(e) => setRegistroBusca(e.target.value)}
              />
            </div>
            {[
              ["todos", "Histórico"],
              ["documento", "Documentos"],
              ["foto", "Fotos"],
              ["nota_fiscal", "Notas"],
            ].map(([key, label]) => (
              <button
                key={key}
                style={registroFiltro === key ? btnPrimary : btnGhost}
                onClick={() => setRegistroFiltro(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {(() => {
            const filtrados = registros
              .filter((r) => registroFiltro === "todos" || r.tipo === registroFiltro)
              .filter((r) => !registroBusca.trim() || (r.conteudo || "").toLowerCase().includes(registroBusca.toLowerCase()));

            if (filtrados.length === 0) {
              return (
                <div style={{ border: `0.5px dashed ${COLORS.line}`, borderRadius: 12, padding: 28, textAlign: "center" }}>
                  <MessageCircle size={22} color={COLORS.inkMuted} style={{ marginBottom: 8 }} />
                  <p style={{ color: COLORS.inkMuted, fontSize: 13, margin: 0 }}>
                    Nenhum registro pelo WhatsApp ainda. Envie fotos, notas fiscais ou áudios para o número conectado.
                  </p>
                </div>
              );
            }

            const ICONS = { nota_fiscal: FileText, foto: Camera, audio: Mic, documento: Paperclip, texto: MessageCircle };

            return (
              <div style={{ border: `0.5px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
                {filtrados.map((r, i) => {
                  const Icone = ICONS[r.tipo] || MessageCircle;
                  return (
                    <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : `0.5px solid ${COLORS.line}`, background: COLORS.panel }}>
                      <Icone size={16} color={COLORS.cyan} style={{ marginTop: 2 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{r.tipo.replace("_", " ")}</span>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: COLORS.inkMuted }}>
                            {new Date(r.criadoEm).toLocaleString("pt-BR")}
                          </span>
                        </div>
                        {r.conteudo && <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.inkMuted }}>{r.conteudo}</p>}
                        {r.valor != null && <p style={{ margin: "4px 0 0", fontSize: 13 }}>{formatBRL(r.valor)}</p>}
                        {r.mediaUrl && (
                          <a href={r.mediaUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: COLORS.cyan }}>
                            Abrir arquivo
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {showEmpresaInfo && (
        <Modal title="Minha empresa" onClose={() => setShowEmpresaInfo(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Empresa</label>
              <p style={{ margin: 0, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>{session.empresa.nome}</p>
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
                <input style={{ ...inputStyle, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }} readOnly value={session.empresa.id} />
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
            <button style={{ ...btnGhost, justifyContent: "center", color: COLORS.brick }} onClick={logout}>
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
              <label style={labelStyle}>Orçamento planejado (R$)</label>
              <input style={inputStyle} type="number" placeholder="150000" value={obraForm.budget} onChange={(e) => setObraForm({ ...obraForm, budget: e.target.value })} />
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

function StatCard({ icon, label, value, tone }) {
  return (
    <div style={{ background: COLORS.panel, border: `0.5px solid ${COLORS.line}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: COLORS.inkMuted, marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 12 }}>{label}</span>
      </div>
      <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 600, margin: 0, color: tone || COLORS.ink }}>{value}</p>
    </div>
  );
}
