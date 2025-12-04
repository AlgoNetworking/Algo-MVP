import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { loginUser } from "../api";

export default function Login({ onLogin }) {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    const res = await loginUser(email, senha);
    if (res.erro) {
      setErro(res.erro);
      return;
    }
    // save token and user
    localStorage.setItem("token", res.token);
    localStorage.setItem("user", JSON.stringify(res.user));
    // redirect based on payment status
    if (!res.user.pago) {
      nav("/payment");
    } else {
      nav("/dashboard");
    }
    if (onLogin) onLogin(res.token, res.user);
  }

  return (
    <div className="center-page" style={{ background: "var(--azul-escuro)" }}>
      <div className="card">
        <h2 style={{ color: "var(--azul)" }}>Login — ALGO</h2>
        <form onSubmit={handleSubmit}>
          <input placeholder="E-mail" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <input type="password" placeholder="Senha" value={senha} onChange={(e)=>setSenha(e.target.value)} />
          {erro && <div style={{ color: "tomato", marginTop: 8 }}>{erro}</div>}
          <button className="primary" type="submit">Entrar</button>
        </form>
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Link className="link" to="/register">Criar conta</Link>
        </div>
      </div>
    </div>
  );
}
