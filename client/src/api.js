const API = "http://localhost:4000";

export async function registerUser(nome, email, senha) {
  const r = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, email, senha })
  });
  return r.json();
}

export async function loginUser(email, senha) {
  const r = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha })
  });
  return r.json();
}

export async function getMe() {
  const token = localStorage.getItem("token");
  if (!token) return { erro: "token ausente" };
  const r = await fetch(`${API}/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return r.json();
}

export async function payAccount() {
  const token = localStorage.getItem("token");
  if (!token) return { erro: "token ausente" };
  const r = await fetch(`${API}/pay`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  return r.json();
}
