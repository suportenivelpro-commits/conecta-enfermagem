"use client";

import { useState } from "react";
import { Activity, CalendarClock, ClipboardList, ShieldCheck } from "lucide-react";

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section style={{ width: "100%", maxWidth: 460, background: "#fff", padding: 32, borderRadius: 20, boxShadow: "0 12px 40px #18274612" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <div style={{ background: "#e0f2fe", color: "#0369a1", padding: 12, borderRadius: 14 }}>
            <Activity size={28} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>Conecta Enfermagem</h1>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>Acompanhamento de conectores</p>
          </div>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", color: "#475569", fontSize: 14 }}>
            <ShieldCheck size={19} /> Acesso restrito à equipe autorizada
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", color: "#475569", fontSize: 14 }}>
            <CalendarClock size={19} /> Controle de prazos por dia do ciclo
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", color: "#475569", fontSize: 14 }}>
            <ClipboardList size={19} /> Histórico de acompanhamentos
          </div>
          <label style={{ display: "grid", gap: 7, fontSize: 14, fontWeight: 600 }}>
            E-mail profissional
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" autoComplete="username" style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 10 }} />
          </label>
          <label style={{ display: "grid", gap: 7, fontSize: 14, fontWeight: 600 }}>
            Senha
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Sua senha" autoComplete="current-password" style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 10 }} />
          </label>
          <button type="button" onClick={() => alert("Tela inicial criada. A autenticação será conectada ao Supabase na próxima etapa.")} style={{ border: 0, borderRadius: 10, padding: 14, background: "#0369a1", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            Entrar
          </button>
          <p style={{ margin: 0, color: "#64748b", fontSize: 12, lineHeight: 1.6 }}>
            Versão inicial de desenvolvimento. Ainda não autentica usuários nem registra dados clínicos.
          </p>
        </div>
      </section>
    </main>
  );
}
