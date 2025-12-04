import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { registerUser } from "../api";

export default function Register() {
  const nav = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    const res = await registerUser(nome, email, senha);
    if (res.erro) {
      setErro(res.erro);
      return;
    }
    setOk(true);
    // after brief success, go to login
    setTimeout(()=>nav("/login"), 900);
  }

  return (
    <div className="center-page" style={{ background: "var(--azul-escuro)" }}>
      <div className="card">
        <h2 style={{ color: "var(--azul)" }}>Criar Conta — ALGO</h2>
        <form onSubmit={handleSubmit}>
          <input placeholder="Nome completo" value={nome} onChange={e=>setNome(e.target.value)} />
          <input placeholder="E-mail" value={email} onChange={e=>setEmail(e.target.value)} />
          <input type="password" placeholder="Senha" value={senha} onChange={e=>setSenha(e.target.value)} />
          {erro && <div style={{ color: "tomato", marginTop: 8 }}>{erro}</div>}
          {ok && <div style={{ color: "lightgreen", marginTop:8 }}>Conta criada! Redirecionando para login...</div>}
          <button className="primary" type="submit">Registrar</button>
        </form>
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Link className="link" to="/login">Voltar ao login</Link>
        </div>
      </div>
    </div>
  );
}
