// server/index.js
// Backend mínimo para Register / Login / Pay (arquivo JSON como DB)
const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || "SEGREDO_SUPER_SEGURO";
const DB_PATH = path.join(__dirname, "users.json");

if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify([]));
}

function readUsers() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    console.error("Erro lendo users.json:", err);
    return [];
  }
}

function writeUsers(users) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("Erro escrevendo users.json:", err);
  }
}

function safeUser(u) {
  return { id: u.id, nome: u.nome, email: u.email, pago: !!u.pago };
}

app.post("/register", async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha)
      return res.status(400).json({ erro: "Campos obrigatórios" });

    const users = readUsers();
    if (users.find((u) => u.email === email))
      return res.status(400).json({ erro: "Email já registrado" });

    const hash = await bcrypt.hash(senha, 10);
    const newUser = {
      id: Date.now(),
      nome,
      email,
      senha: hash,
      pago: false
    };

    users.push(newUser);
    writeUsers(users);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro /register:", err);
    return res.status(500).json({ erro: "Erro no servidor" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha)
      return res.status(400).json({ erro: "Campos obrigatórios" });

    const users = readUsers();
    const user = users.find((u) => u.email === email);
    if (!user) return res.status(400).json({ erro: "Credenciais inválidas" });

    const ok = await bcrypt.compare(senha, user.senha);
    if (!ok) return res.status(400).json({ erro: "Credenciais inválidas" });

    const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "7d" });
    return res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error("Erro /login:", err);
    return res.status(500).json({ erro: "Erro no servidor" });
  }
});

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ erro: "Token ausente" });
  const token = header.split(" ")[1];
  try {
    const data = jwt.verify(token, SECRET);
    req.userId = data.id;
    next();
  } catch (err) {
    return res.status(401).json({ erro: "Token inválido" });
  }
}

app.get("/me", auth, (req, res) => {
  try {
    const users = readUsers();
    const user = users.find((u) => u.id === req.userId);
    if (!user) return res.status(404).json({ erro: "Usuário não encontrado" });
    return res.json({ user: safeUser(user) });
  } catch (err) {
    console.error("Erro /me:", err);
    return res.status(500).json({ erro: "Erro no servidor" });
  }
});

app.post("/pay", auth, (req, res) => {
  try {
    const users = readUsers();
    const idx = users.findIndex((u) => u.id === req.userId);
    if (idx === -1) return res.status(404).json({ erro: "Usuário não encontrado" });
    users[idx].pago = true;
    writeUsers(users);
    return res.json({ ok: true, user: safeUser(users[idx]) });
  } catch (err) {
    console.error("Erro /pay:", err);
    return res.status(500).json({ erro: "Erro no servidor" });
  }
});

app.listen(PORT, () => {
  console.log(`Auth server rodando em http://localhost:${PORT}`);
});
