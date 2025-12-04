import React, { useEffect, useState } from "react";
import { getMe, payAccount } from "../api";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);

  async function load() {
    const res = await getMe();
    if (res.erro) return nav("/login");
    setUser(res.user);
  }

  async function pagar() {
    const res = await payAccount();
    if (res.user) setUser(res.user);
  }

  useEffect(()=>{ load(); }, []);

  if (!user) return <div className="center-page"><div className="card">Carregando...</div></div>;

  return (
    <div className="dashboard">
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>Dashboard — ALGO</h1>
          <div>
            <span className="pill">{user.pago ? "Conta Paga" : "Conta NÃO Paga"}</span>
          </div>
        </div>

        <section style={{ marginTop: 24, background: "white", padding: 20, borderRadius: 10 }}>
          <h3>Olá, {user.nome}</h3>
          <p>Email: {user.email}</p>
          {!user.pago && <button className="primary" onClick={pagar}>Pagar agora</button>}
        </section>
      </div>
    </div>
  );
}
