import React, { useState, useEffect } from "react";
import { getMe, payAccount } from "../api";
import { useNavigate } from "react-router-dom";

export default function Payment() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await getMe();
    if (res.erro) return nav("/login");
    setUser(res.user);
    setLoading(false);
  }

  async function pagar() {
    const res = await payAccount();
    if (res.user) {
      setUser(res.user);
      // redirect to dashboard
      nav("/dashboard");
    } else {
      alert(res.erro || "Erro no pagamento");
    }
  }

  useEffect(()=>{ load(); }, []);

  if (loading) return <div className="center-page"><div className="card">Carregando...</div></div>;

  return (
    <div className="center-page" style={{ background: "var(--azul-escuro)" }}>
      <div className="card">
        <h2 style={{ color: "var(--azul)" }}>Pagamento obrigatório</h2>
        <p className="muted">Para usar a plataforma ALGO é necessário pagar a assinatura.</p>
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 10 }}>Usuário: <strong>{user.nome}</strong></div>
          <div style={{ marginBottom: 10 }}>Email: <strong>{user.email}</strong></div>
          <button className="primary" onClick={pagar}>Pagar agora (simulação)</button>
          <button className="ghost" onClick={()=>nav("/login")}>Voltar</button>
        </div>
      </div>
    </div>
  );
}
