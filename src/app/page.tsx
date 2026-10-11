"use client";

import { useEffect, useState } from "react";
import {
  Activity, CalendarClock, ClipboardList, LogOut,
  Plus, RefreshCw, Search, ShieldCheck
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";

type Staff = {
  user_id: string;
  full_name: string;
  role: string;
  active: boolean;
};

type Patient = {
  id: string;
  full_name: string;
  bed: string;
  catheter_type: string;
  follow_up_status: string;
  follow_up_closed_at: string | null;
};

type Cycle = {
  id: string;
  patient_id: string;
  start_date: string;
  planned_exchange_date: string | null;
  status: string;
  closed_at: string | null;
};

type EventRow = {
  id: string;
  patient_id: string;
  event_type: string;
  event_date: string;
  professional_name: string;
  reason: string | null;
  notes: string | null;
};

function todayFortaleza() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

function safeDate(date: unknown): string {
  if (!date) return "";
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return String(date).slice(0, 10);
}

function addDays(date: unknown, days: number) {
  const str = safeDate(date);
  if (!str) return "—";
  const [y, m, d] = str.split("-").map(Number);
  const result = new Date(Date.UTC(y, m - 1, d + days));
  return [
    result.getUTCFullYear(),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function dayNumber(date: unknown) {
  const str = safeDate(date);
  if (!str) return 0;
  const [y, m, d] = str.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function dateLabel(date: unknown) {
  const str = safeDate(date);
  if (!str) return "—";
  const [y, m, d] = str.split("-");
  return d && m && y ? `${d}/${m}/${y}` : "—";
}

function cycleStatus(start: string) {
  const diff = dayNumber(todayFortaleza()) - dayNumber(start);
  if (diff < 0) return { label: "Data futura", color: "#64748b", key: "future" };
  if (diff <= 1) return { label: "No prazo", color: "#15803d", key: "ok" };
  if (diff === 2) return { label: "Troca amanhã", color: "#0284c7", key: "soon" };
  if (diff === 3) return { label: "Trocar hoje", color: "#ea580c", key: "today" };
  return { label: "Prazo ultrapassado", color: "#dc2626", key: "late" };
}

type KanbanColumn = {
  key: string;
  title: string;
  subtitle: string;
  color: string;
  bgHeader: string;
  border: string;
  badgeBg: string;
  badgeColor: string;
  filterKeys: string[];
};

const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    key: "ok",
    title: "No Prazo",
    subtitle: "Dias 1 e 2 do ciclo",
    color: "#15803d",
    bgHeader: "#f0fdf4",
    border: "#bbf7d0",
    badgeBg: "#dcfce7",
    badgeColor: "#166534",
    filterKeys: ["ok", "future"],
  },
  {
    key: "soon",
    title: "Trocar Amanhã",
    subtitle: "Dia 3 do ciclo",
    color: "#0284c7",
    bgHeader: "#f0f9ff",
    border: "#bae6fd",
    badgeBg: "#e0f2fe",
    badgeColor: "#0369a1",
    filterKeys: ["soon"],
  },
  {
    key: "today",
    title: "Trocar Hoje",
    subtitle: "Dia 4 do ciclo (Prazo)",
    color: "#ea580c",
    bgHeader: "#fff7ed",
    border: "#fed7aa",
    badgeBg: "#ffedd5",
    badgeColor: "#9a3412",
    filterKeys: ["today"],
  },
  {
    key: "late",
    title: "Prazo Ultrapassado",
    subtitle: "Dia 5 em diante",
    color: "#dc2626",
    bgHeader: "#fef2f2",
    border: "#fecaca",
    badgeBg: "#fee2e2",
    badgeColor: "#991b1b",
    filterKeys: ["late"],
  },
];

const catheterTypes = [
  "Cateter de hemodiálise",
  "Permcath",
  "Hickman",
];

const priority: Record<string, number> = {
  late: 0, today: 1, soon: 2, ok: 3, future: 4,
};

const pageStyle = {
  minHeight: "100vh",
  background: "#f3f6fb",
  color: "#172033",
  fontFamily: "Arial, Helvetica, sans-serif",
} as const;

const panelStyle = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: 20,
} as const;

const inputStyle = {
  width: "100%",
  padding: 12,
  border: "1px solid #cbd5e1",
  borderRadius: 9,
  background: "#fff",
  color: "#172033",
} as const;

const primaryButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "11px 15px",
  background: "#0369a1",
  color: "#fff",
  border: 0,
  borderRadius: 9,
  fontWeight: 700,
  cursor: "pointer",
} as const;

export default function Home() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [exchangePatient, setExchangePatient] = useState<Patient | null>(null);
  const [exchangeReason, setExchangeReason] = useState("Troca programada");
  const [exchangeProfessional, setExchangeProfessional] = useState("");
  const [exchangeNotes, setExchangeNotes] = useState("");
  const [tab, setTab] = useState<"patients" | "history">("patients");

  async function loadData(sb: NonNullable<ReturnType<typeof getSupabase>>) {
    const [p, c, e] = await Promise.all([
      sb.from("patients").select("*").order("bed", { ascending: true }),
      sb.from("connector_cycles").select("*").order("start_date", { ascending: false }),
      sb.from("connector_events").select("*").order("created_at", { ascending: false }).limit(100),
    ]);

    const failed = [p, c, e].find(r => r.error);
    if (failed?.error) throw new Error(failed.error.message);

    setPatients((p.data ?? []) as Patient[]);
    setCycles((c.data ?? []) as Cycle[]);
    setEvents((e.data ?? []) as EventRow[]);
  }

  async function loadProfileAndData(sb: NonNullable<ReturnType<typeof getSupabase>>, userId: string) {
    const { data, error: profileError } = await sb
      .from("staff_profiles")
      .select("user_id,full_name,role,active")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);
    if (!data || !data.active) {
      await sb.auth.signOut();
      throw new Error("Usuário sem perfil ativo. Solicite acesso ao administrador.");
    }

    setStaff(data as Staff);
    await loadData(sb);
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      const sb = getSupabase();
      if (!sb) {
        setError("As variáveis do Supabase não foram encontradas neste ambiente. Confira as variáveis do projeto na Vercel.");
        setLoading(false);
        return;
      }

      try {
        const { data } = await sb.auth.getSession();
        if (data.session?.user) {
          await loadProfileAndData(sb, data.session.user.id);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Não foi possível carregar os dados.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void init();
    return () => { mounted = false; };
  }, []);

  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    const sb = getSupabase();
    if (!sb) {
      setError("Supabase não configurado neste ambiente.");
      setBusy(false);
      return;
    }

    try {
      const { data, error: authError } = await sb.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      if (!data.user) throw new Error("Não foi possível identificar o usuário.");
      await loadProfileAndData(sb, data.user.id);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }

  async function signOut() {
    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    setStaff(null);
    setPatients([]);
    setCycles([]);
    setEvents([]);
  }

  async function refresh() {
    const sb = getSupabase();
    if (!sb) return;
    setError("");
    try {
      await loadData(sb);
      setNotice("Dados atualizados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar.");
    }
  }

  async function registerPatient(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!staff) return;

    const sb = getSupabase();
    if (!sb) return;

    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { error: rpcError } = await sb.rpc("register_patient", {
        p_full_name: String(form.get("full_name") ?? "").trim(),
        p_bed: String(form.get("bed") ?? "").trim(),
        p_catheter_type: String(form.get("catheter_type") ?? ""),
        p_start_date: String(form.get("start_date") ?? todayFortaleza()),
        p_professional_name: staff.full_name,
      });

      if (rpcError) throw rpcError;

      setShowForm(false);
      setNotice("Paciente cadastrado.");
      await loadData(sb);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cadastrar. Confira as permissões e a função do banco.");
    } finally {
      setBusy(false);
    }
  }

  async function registerExchange(patient: Patient) {
    if (!staff) return;

    const sb = getSupabase();
    if (!sb) return;

    if (!exchangeProfessional.trim()) {
      setError("Informe o profissional responsável.");
      return;
    }

    if (!exchangeReason.trim()) {
      setError("Selecione o motivo da troca.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { error: rpcError } = await sb.rpc(
        "register_connector_exchange",
        {
          p_patient_id: patient.id,
          p_professional_name: exchangeProfessional.trim(),
          p_notes: exchangeNotes.trim() || null,
          p_reason: exchangeReason.trim(),
        }
      );

      if (rpcError) throw rpcError;

      setNotice("Troca registrada. Confira a data e o novo ciclo no painel.");
      setExchangePatient(null);
      setExchangeNotes("");
      setExchangeReason("Troca programada");
      setExchangeProfessional(staff.full_name);

      await loadData(sb);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível registrar a troca."
      );
    } finally {
      setBusy(false);
    }
  }

  const activePatients = patients.filter(p =>
    !p.follow_up_closed_at &&
    !String(p.follow_up_status).toLowerCase().includes("closed") &&
    !String(p.follow_up_status).toLowerCase().includes("encerr")
  );

  const cards = activePatients.map(patient => {
    const cycle = cycles.find(c => c.patient_id === patient.id && !c.closed_at) ??
      cycles.find(c => c.patient_id === patient.id);
    const status = cycle ? cycleStatus(cycle.start_date) : {
      label: "Sem ciclo", color: "#64748b", key: "future",
    };
    return { patient, cycle, status };
  }).filter(item =>
    (item.patient.full_name + " " + item.patient.bed + " " + item.patient.catheter_type)
      .toLowerCase().includes(query.toLowerCase())
  ).sort((a, b) =>
    (priority[a.status?.key] ?? 4) - (priority[b.status?.key] ?? 4) ||
    String(a.patient?.bed ?? "").localeCompare(String(b.patient?.bed ?? ""), "pt-BR", { numeric: true })
  );

  const countLate = cards.filter(c => c.status.key === "late").length;
  const countToday = cards.filter(c => c.status.key === "today").length;
  const countSoon = cards.filter(c => c.status.key === "soon").length;
  const countOk = cards.filter(c => c.status.key === "ok" || c.status.key === "future").length;

  if (loading) {
    return <main style={{ ...pageStyle, display: "grid", placeItems: "center" }}>Carregando Conecta Enfermagem…</main>;
  }

  if (!staff) {
    return (
      <main style={{ ...pageStyle, display: "grid", placeItems: "center", padding: 20 }}>
        <section style={{ ...panelStyle, width: "100%", maxWidth: 430, padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{ padding: 12, background: "#e0f2fe", color: "#0369a1", borderRadius: 12 }}><Activity size={28} /></div>
            <div>
              <h1 style={{ margin: 0, fontSize: 23 }}>Conecta Enfermagem</h1>
              <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 14 }}>Acompanhamento de conectores</p>
            </div>
          </div>

          <p style={{ color: "#475569", lineHeight: 1.6 }}>
            <ShieldCheck size={17} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Acesso restrito a profissionais autorizados.
          </p>

          <form onSubmit={signIn} style={{ display: "grid", gap: 15 }}>
            <label style={{ display: "grid", gap: 7, fontSize: 14, fontWeight: 600 }}>
              E-mail profissional
              <input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 7, fontSize: 14, fontWeight: 600 }}>
              Senha
              <input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
            </label>
            {error && <p role="alert" style={{ color: "#b91c1c", fontSize: 14, overflowWrap: "anywhere" }}>{error}</p>}
            <button disabled={busy} type="submit" style={{ ...primaryButton, opacity: busy ? 0.7 : 1 }}>
              {busy ? "Verificando…" : "Entrar"}
            </button>
          </form>
          <p style={{ color: "#64748b", fontSize: 12, lineHeight: 1.6, marginTop: 18 }}>
            Use o acesso criado no Supabase. O perfil também precisa estar ativo em staff_profiles.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <header style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "16px 22px" }}>
        <div style={{ maxWidth: 1200, margin: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ background: "#e0f2fe", color: "#0369a1", padding: 10, borderRadius: 12 }}><Activity size={24} /></div>
            <div>
              <strong style={{ fontSize: 19 }}>Conecta Enfermagem</strong>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Painel de acompanhamento</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#475569" }}>{staff.full_name} · {staff.role}</span>
            <button onClick={signOut} style={{ ...primaryButton, background: "#e2e8f0", color: "#334155" }}><LogOut size={16} /> Sair</button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1200, padding: 20, margin: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: "4px 0 6px", fontSize: 25 }}>Acompanhamento</h2>
            <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>Hoje: {dateLabel(todayFortaleza())} · Fuso de Fortaleza</p>
          </div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button onClick={refresh} style={{ ...primaryButton, background: "#fff", color: "#0369a1", border: "1px solid #bae6fd" }}><RefreshCw size={16} /> Atualizar</button>
            <button onClick={() => setShowForm(v => !v)} style={primaryButton}><Plus size={17} /> Novo paciente</button>
          </div>
        </div>

        {error && <div role="alert" style={{ ...panelStyle, color: "#b91c1c", marginBottom: 14 }}>{error}</div>}
        {notice && <div role="status" style={{ ...panelStyle, color: "#166534", marginBottom: 14 }}>{notice}</div>}

        {showForm && (
          <section style={{ ...panelStyle, marginBottom: 18 }}>
            <h3 style={{ marginTop: 0 }}>Cadastrar paciente</h3>
            <form onSubmit={registerPatient} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 13 }}>
              <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Nome completo
                <input name="full_name" required maxLength={160} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Leito
                <input name="bed" required maxLength={30} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Tipo de cateter
                <select name="catheter_type" required defaultValue="" style={inputStyle}>
                  <option value="" disabled>Selecione</option>
                  {catheterTypes.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Data de instalação/troca do conector (Dia 1)
                <input name="start_date" type="date" required defaultValue={todayFortaleza()} style={inputStyle} />
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                <button disabled={busy} type="submit" style={primaryButton}>{busy ? "Salvando…" : "Salvar paciente"}</button>
                <button type="button" onClick={() => setShowForm(false)} style={{ ...primaryButton, background: "#e2e8f0", color: "#334155" }}>Cancelar</button>
              </div>
            </form>
          </section>
        )}

        {exchangePatient && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 50,
              padding: 20,
            }}
            onClick={() => setExchangePatient(null)}
          >
            <section
              style={{
                width: "100%",
                maxWidth: 520,
                background: "#fff",
                borderRadius: 16,
                padding: 24,
                border: "1px solid #e2e8f0",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              }}
              onClick={e => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0, marginBottom: 20 }}>Registrar troca do conector</h3>

              <div style={{ display: "grid", gap: 16, marginBottom: 20 }}>
                <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10 }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Paciente</div>
                  <strong style={{ fontSize: 16 }}>{exchangePatient.full_name}</strong>
                  <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Leito {exchangePatient.bed} · {exchangePatient.catheter_type}</div>
                </div>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  Profissional responsável *
                  <input
                    value={exchangeProfessional}
                    onChange={e => setExchangeProfessional(e.target.value)}
                    style={inputStyle}
                    placeholder="Nome do profissional"
                    required
                  />
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  Motivo da troca *
                  <select
                    value={exchangeReason}
                    onChange={e => setExchangeReason(e.target.value)}
                    style={inputStyle}
                    required
                  >
                    <option value="Troca programada">Troca programada</option>
                    <option value="Troca por obstrução">Troca por obstrução</option>
                    <option value="Troca por infecção">Troca por infecção</option>
                    <option value="Troca por vazamento">Troca por vazamento</option>
                    <option value="Troca por mobilidade">Troca por mobilidade</option>
                    <option value="Outros">Outros</option>
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  Observações
                  <textarea
                    value={exchangeNotes}
                    onChange={e => setExchangeNotes(e.target.value)}
                    rows={4}
                    style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                    placeholder="Descreva detalhes da troca (opcional)"
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setExchangePatient(null)}
                  style={{ ...primaryButton, background: "#e2e8f0", color: "#334155" }}
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  disabled={busy || !exchangeProfessional.trim()}
                  onClick={() => {
                    void registerExchange(exchangePatient);
                  }}
                  style={{ ...primaryButton, opacity: (busy || !exchangeProfessional.trim()) ? 0.6 : 1 }}
                >
                  {busy ? "Registrando…" : "Confirmar troca"}
                </button>
              </div>
            </section>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Em acompanhamento", value: cards.length, color: "#0369a1" },
            { label: "No prazo", value: countOk, color: "#15803d" },
            { label: "Trocar amanhã", value: countSoon, color: "#0284c7" },
            { label: "Trocar hoje", value: countToday, color: "#ea580c" },
            { label: "Prazo ultrapassado", value: countLate, color: "#dc2626" },
          ].map(item => (
            <section key={item.label} style={panelStyle}>
              <div style={{ color: "#64748b", fontSize: 13 }}>{item.label}</div>
              <div style={{ fontSize: 30, fontWeight: 750, color: item.color, marginTop: 9 }}>{item.value}</div>
            </section>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <button onClick={() => setTab("patients")} style={{ ...primaryButton, background: tab === "patients" ? "#0369a1" : "#e2e8f0", color: tab === "patients" ? "#fff" : "#334155" }}><ClipboardList size={16} /> Pacientes</button>
          <button onClick={() => setTab("history")} style={{ ...primaryButton, background: tab === "history" ? "#0369a1" : "#e2e8f0", color: tab === "history" ? "#fff" : "#334155" }}><CalendarClock size={16} /> Histórico</button>
        </div>

        {tab === "patients" ? (
          <section style={{ ...panelStyle, padding: "20px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flex: "1 1 300px", maxWidth: 460 }}>
                <Search size={19} color="#64748b" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar por paciente, leito ou cateter..."
                  style={inputStyle}
                />
              </div>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                Total: <strong>{cards.length}</strong> {cards.length === 1 ? "paciente" : "pacientes"}
              </div>
            </div>

            {cards.length === 0 && query ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
                <p style={{ margin: 0, fontSize: 15 }}>Nenhum paciente encontrado para &ldquo;{query}&rdquo;.</p>
              </div>
            ) : (
              <div
                style={{
                  overflowX: "auto",
                  paddingBottom: 12,
                  WebkitOverflowScrolling: "touch",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(260px, 1fr))",
                    gap: 16,
                    minWidth: 1080,
                    alignItems: "start",
                  }}
                >
                  {KANBAN_COLUMNS.map(col => {
                    const colCards = cards.filter(c => col.filterKeys.includes(c.status.key));
                    return (
                      <div
                        key={col.key}
                        style={{
                          background: "#f8fafc",
                          borderRadius: 14,
                          border: "1px solid #e2e8f0",
                          borderTop: `4px solid ${col.color}`,
                          padding: 14,
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                          minHeight: 220,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, paddingBottom: 10, borderBottom: "1px solid #e2e8f0" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ width: 9, height: 9, borderRadius: "50%", background: col.color, display: "inline-block" }} />
                              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1e293b" }}>{col.title}</h3>
                            </div>
                            <span style={{ fontSize: 11, color: "#64748b", marginTop: 3, display: "block" }}>{col.subtitle}</span>
                          </div>
                          <span
                            style={{
                              background: col.badgeBg,
                              color: col.badgeColor,
                              borderRadius: 12,
                              padding: "2px 8px",
                              fontSize: 12,
                              fontWeight: 700,
                              minWidth: 22,
                              textAlign: "center",
                            }}
                          >
                            {colCards.length}
                          </span>
                        </div>

                        {colCards.length === 0 ? (
                          <div
                            style={{
                              padding: "30px 12px",
                              textAlign: "center",
                              color: "#94a3b8",
                              fontSize: 13,
                              background: "#fff",
                              borderRadius: 10,
                              border: "1px dashed #cbd5e1",
                            }}
                          >
                            Nenhum paciente
                          </div>
                        ) : (
                          <div style={{ display: "grid", gap: 12 }}>
                            {colCards.map(({ patient, cycle, status }) => {
                              const diff = (cycle && cycle.start_date) ? dayNumber(todayFortaleza()) - dayNumber(cycle.start_date) : null;
                              const cycleDayLabel = diff === null
                                ? "Sem ciclo ativo"
                                : diff < 0
                                ? "Início futuro"
                                : diff === 0
                                ? "Dia 1 de 4"
                                : diff === 1
                                ? "Dia 2 de 4"
                                : diff === 2
                                ? "Dia 3 de 4 (Amanhã)"
                                : diff === 3
                                ? "Dia 4 de 4 (Hoje)"
                                : `Dia ${diff + 1} de 4 (+${diff - 3}d)`;

                              return (
                                <article
                                  key={patient.id}
                                  style={{
                                    background: "#fff",
                                    borderRadius: 12,
                                    border: "1px solid #e2e8f0",
                                    borderLeft: `4px solid ${status.color}`,
                                    padding: 14,
                                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10,
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                    <div style={{ minWidth: 0 }}>
                                      <strong style={{ fontSize: 15, color: "#0f172a", display: "block", wordBreak: "break-word" }}>
                                        {patient.full_name}
                                      </strong>
                                      <div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>
                                        {patient.catheter_type}
                                      </div>
                                    </div>
                                    <span
                                      style={{
                                        background: "#f1f5f9",
                                        color: "#334155",
                                        borderRadius: 6,
                                        padding: "3px 7px",
                                        fontSize: 12,
                                        fontWeight: 700,
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      L. {patient.bed}
                                    </span>
                                  </div>

                                  <div
                                    style={{
                                      background: col.bgHeader,
                                      border: `1px solid ${col.border}`,
                                      borderRadius: 8,
                                      padding: "6px 10px",
                                      fontSize: 12,
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <span style={{ fontWeight: 700, color: col.badgeColor }}>
                                      {cycleDayLabel}
                                    </span>
                                    <span
                                      style={{
                                        background: status.color + "18",
                                        color: status.color,
                                        borderRadius: 10,
                                        padding: "2px 6px",
                                        fontSize: 11,
                                        fontWeight: 700,
                                      }}
                                    >
                                      {status.label}
                                    </span>
                                  </div>

                                  <div style={{ fontSize: 12, color: "#475569", display: "grid", gap: 4 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                                      <span style={{ color: "#64748b" }}>Instalação (Dia 1):</span>
                                      <strong>{cycle?.start_date ? dateLabel(cycle.start_date) : "—"}</strong>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                                      <span style={{ color: "#64748b" }}>Troca prevista (Dia 4):</span>
                                      <strong style={{ color: status.key === "today" || status.key === "late" ? status.color : "inherit" }}>
                                        {cycle?.start_date ? dateLabel(addDays(cycle.start_date, 3)) : "—"}
                                      </strong>
                                    </div>
                                  </div>

                                  {cycle && (
                                    <button
                                      disabled={busy}
                                      onClick={() => {
                                        setExchangePatient(patient);
                                        setExchangeReason("Troca programada");
                                        setExchangeProfessional(staff?.full_name ?? "");
                                        setExchangeNotes("");
                                      }}
                                      style={{
                                        ...primaryButton,
                                        width: "100%",
                                        padding: "8px 10px",
                                        fontSize: 12,
                                        marginTop: 4,
                                        background: "#0369a1",
                                        color: "#fff",
                                        opacity: busy ? 0.65 : 1,
                                      }}
                                    >
                                      <RefreshCw size={14} /> Registrar troca
                                    </button>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        ) : (
          <section style={panelStyle}>
            <h3 style={{ marginTop: 0 }}>Eventos recentes</h3>
            {events.length === 0 ? <p style={{ color: "#64748b" }}>Nenhum evento registrado.</p> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 600 }}>
                  <thead><tr>{["Data", "Paciente", "Evento", "Profissional", "Motivo", "Observação"].map(label => <th key={label} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e2e8f0" }}>{label}</th>)}</tr></thead>
                  <tbody>
                    {events.map(event => (
                      <tr key={event.id}>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{dateLabel(event.event_date)}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{patients.find(p => p.id === event.patient_id)?.full_name ?? "Paciente"}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{event.event_type}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{event.professional_name}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{event.reason ?? "—"}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{event.notes?.trim() ? event.notes : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <p style={{ color: "#64748b", fontSize: 12, lineHeight: 1.6, marginTop: 18 }}>
          Ferramenta em validação técnica. Confirme os prazos e os registros conforme o protocolo institucional. Não utilize esta versão como única fonte para decisões clínicas.
        </p>
      </div>
    </main>
  );
}
