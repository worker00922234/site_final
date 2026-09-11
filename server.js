import express from "express";
import Database from "better-sqlite3";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = "1.8.2-candidate-chat-telegram-replies";
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_ADMIN_CHAT_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
const TELEGRAM_CHAT_REPLY_SECRET = String(process.env.TELEGRAM_CHAT_REPLY_SECRET || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  throw new Error("Set ADMIN_PASSWORD to a password of at least 12 characters.");
}

const DATA_DIR = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(DATA_DIR, "applications.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    phone TEXT NOT NULL DEFAULT '',
    telegram_username TEXT NOT NULL DEFAULT '',
    age INTEGER NOT NULL,
    city TEXT NOT NULL,
    previous_activity TEXT NOT NULL DEFAULT '',
    education TEXT NOT NULL DEFAULT '',
    work_experience TEXT NOT NULL DEFAULT '',
    profession TEXT NOT NULL DEFAULT '',
    desired_schedule TEXT NOT NULL,
    desired_salary INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT NOT NULL DEFAULT '',
    chat_token TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Upgrade existing databases created by earlier versions.
for (const statement of [
  "ALTER TABLE applications ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE applications ADD COLUMN telegram_username TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE applications ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE applications ADD COLUMN chat_token TEXT"
]) {
  try { db.exec(statement); } catch (error) {
    if (!String(error.message).includes("duplicate column name")) throw error;
  }
}

// Candidate ↔ administrator chat. Each submitted application receives a private,
// unguessable chat token. The token is returned only to the browser that submitted
// the application and is never exposed in the public application list.
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    sender TEXT NOT NULL CHECK(sender IN ('candidate','admin')),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE
  )
`);
db.pragma("foreign_keys = ON");

const chatPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много сообщений. Попробуйте немного позже." }
});

function createChatToken() {
  let token = "";
  do {
    token = crypto.randomBytes(32).toString("hex");
  } while (db.prepare("SELECT 1 FROM applications WHERE chat_token = ?").get(token));
  return token;
}

// Give older applications a token as well, so their administrator chat can be
// enabled without changing or deleting existing application records.
const missingChatTokenRows = db.prepare("SELECT id FROM applications WHERE chat_token IS NULL OR chat_token = ''").all();
const setChatToken = db.prepare("UPDATE applications SET chat_token = ? WHERE id = ?");
for (const row of missingChatTokenRows) setChatToken.run(createChatToken(), row.id);

const SQLiteStore = connectSqlite3(session);
const sessionStore = process.env.NODE_ENV === "production"
  ? new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR })
  : undefined;

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);

app.use(helmet({
  hsts: process.env.NODE_ENV === "production" ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false
}));

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));

const applicationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много заявок с этого адреса. Попробуйте через 15 минут." }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Попробуйте позже." }
});

const recentApplicationByIp = new Map();
const APPLICATION_COOLDOWN_MS = 2 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - APPLICATION_COOLDOWN_MS;
  for (const [key, timestamp] of recentApplicationByIp) {
    if (timestamp < cutoff) recentApplicationByIp.delete(key);
  }
  const tokenCutoff = Date.now();
  for (const [token, expiresAt] of devAdminTokens) {
    if (expiresAt <= tokenCutoff) devAdminTokens.delete(token);
  }
}, 10 * 60 * 1000).unref();

// Production uses durable express-session/SQLite.
// Local development uses a minimal in-memory admin token so login works
// reliably on plain http://localhost without relying on a session store.
const devAdminTokens = new Map();
const DEV_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

if (sessionStore) {
  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || (() => {
      throw new Error("SESSION_SECRET must be set in production.");
    })(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 8 * 60 * 60 * 1000
    }
  }));
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  const pair = header.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
}

function isDevAdmin(req) {
  if (process.env.NODE_ENV === "production") return false;
  const token = readCookie(req, "dev_admin");
  const expiresAt = devAdminTokens.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    devAdminTokens.delete(token);
    return false;
  }
  return true;
}

function sameOrigin(req) {
  // Railway/reverse proxies can change the externally visible host. Prefer the
  // forwarded host when it is present, while still accepting the direct host.
  const forwardedHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  const requestHosts = new Set([req.get("host"), forwardedHost].filter(Boolean));
  const origin = req.get("origin");

  if (origin && origin !== "null") {
    try {
      return requestHosts.has(new URL(origin).host);
    } catch {
      return false;
    }
  }

  // Chromium form submissions may omit Origin. Sec-Fetch-Site is a reliable
  // same-site/same-origin signal in modern browsers and is especially useful
  // behind Railway's proxy.
  const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;

  const referer = req.get("referer");
  if (referer) {
    try {
      return requestHosts.has(new URL(referer).host);
    } catch {
      return false;
    }
  }

  // Keep local development convenient. In production, a request with no
  // browser provenance is rejected rather than weakening the CSRF check.
  return process.env.NODE_ENV !== "production";
}

function requireSameOrigin(req, res, next) {
  if (!sameOrigin(req)) return res.status(403).json({ error: "Недопустимый источник запроса." });
  next();
}

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function authenticateAdmin(req, res, redirectOnSuccess = false) {
  const password = String(req.body?.password || "");

  const provided = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);
  const passwordOk = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  if (!passwordOk) {
    if (redirectOnSuccess) return res.status(401).send("<h1>Неверный пароль</h1><p><a href=\"/admin\">Вернуться ко входу</a></p>");
    return res.status(401).json({ error: "Неверный пароль." });
  }

  if (process.env.NODE_ENV !== "production") {
    const token = crypto.randomBytes(32).toString("hex");
    devAdminTokens.set(token, Date.now() + DEV_TOKEN_TTL_MS);
    res.setHeader("Set-Cookie", `dev_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`);
    return redirectOnSuccess ? res.redirect(303, "/admin") : res.json({ ok: true });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).send(redirectOnSuccess ? "Не удалось создать сессию." : JSON.stringify({ error: "Не удалось создать сессию." }));
    req.session.isAdmin = true;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).send(redirectOnSuccess ? "Не удалось сохранить сессию." : JSON.stringify({ error: "Не удалось сохранить сессию." }));
      return redirectOnSuccess ? res.redirect(303, "/admin") : res.json({ ok: true });
    });
  });
}

// There is a single administrator entry point: /admin.
// Keep /admin/login only as a compatibility redirect so old bookmarks never hit a
// POST/CSRF handler and never expose a second login page.
app.get("/admin/login", (_req, res) => res.redirect(302, "/admin"));

// Simple deployment marker for troubleshooting/redeploy verification.
app.get("/api/version", (_req, res) => res.json({ version: APP_VERSION }));

app.post("/api/login", loginLimiter, requireSameOrigin, (req, res) => authenticateAdmin(req, res, true));
app.post("/admin/login", loginLimiter, requireSameOrigin, (req, res) => res.redirect(307, "/api/login"));

app.post("/api/logout", requireSameOrigin, (req, res) => {
  if (process.env.NODE_ENV !== "production") {
    const token = readCookie(req, "dev_admin");
    if (token) devAdminTokens.delete(token);
    res.setHeader("Set-Cookie", "dev_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return res.status(204).end();
  }
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.status(204).end();
  });
});

function requireAdmin(req, res, next) {
  const authenticated = process.env.NODE_ENV !== "production"
    ? isDevAdmin(req)
    : req.session?.isAdmin === true;
  if (authenticated) {
    res.setHeader("Cache-Control", "no-store");
    return next();
  }
  return res.status(401).json({ error: "Требуется авторизация." });
}

app.get("/api/me", (req, res) => {
  const authenticated = process.env.NODE_ENV !== "production"
    ? isDevAdmin(req)
    : req.session?.isAdmin === true;
  res.json({ authenticated });
});

app.post("/api/applications", applicationLimiter, requireSameOrigin, (req, res) => {
  if (!req.is("application/json") && !req.is("application/x-www-form-urlencoded")) {
    return res.status(415).json({ error: "Неподдерживаемый формат запроса." });
  }
  const {
    lastName, firstName, phone, age, city, telegramUsername,
    previousActivity, education, workExperience, profession,
    desiredSchedule, desiredSalary, website, _startedAt
  } = req.body || {};

  // Simple bot trap: real users never see or fill this field.
  if (String(website || "").trim()) return res.status(400).json({ error: "Не удалось отправить анкету. Попробуйте ещё раз." });

  // Prevent instant scripted submissions while keeping normal fast users comfortable.
  const started = Number(_startedAt);
  const elapsed = Date.now() - started;
  if (!Number.isFinite(started) || started <= 0 || elapsed < 2500 || elapsed > 24 * 60 * 60 * 1000) {
    return res.status(429).json({ error: "Пожалуйста, откройте анкету заново и проверьте данные перед отправкой." });
  }

  const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const cleanLong = (value, max) => String(value ?? "").trim().slice(0, max);
  const normalizedPhone = clean(phone, 32);

  const fields = {
    lastName: clean(lastName, 80),
    firstName: clean(firstName, 80),
    city: clean(city, 120),
    telegramUsername: clean(telegramUsername, 64),
    previousActivity: cleanLong(previousActivity, 3000),
    education: clean(education, 500),
    workExperience: cleanLong(workExperience, 5000),
    profession: clean(profession, 120)
  };

  const fieldErrors = {};
  const addFieldError = (name, text) => {
    if (!fieldErrors[name]) fieldErrors[name] = text;
  };

  const namePattern = /^[\p{L}][\p{L}\s'’\-]{1,79}$/u;
  const cityPattern = /^[\p{L}\d][\p{L}\d\s'’.,()\-]{1,119}$/u;
  const telegramPattern = /^@?[A-Za-z0-9_]{1,63}$/;

  if (!fields.lastName) addFieldError("lastName", "Укажите фамилию.");
  else if (!namePattern.test(fields.lastName)) addFieldError("lastName", "Введите корректную фамилию: только буквы, пробелы или дефисы.");

  if (!fields.firstName) addFieldError("firstName", "Укажите имя.");
  else if (!namePattern.test(fields.firstName)) addFieldError("firstName", "Введите корректное имя: только буквы, пробелы или дефисы.");

  const phoneDigits = normalizedPhone.replace(/\D/g, "");
  if (!normalizedPhone) addFieldError("phone", "Укажите номер телефона.");
  else if (!/^(?:7|8)9\d{9}$/.test(phoneDigits)) addFieldError("phone", "Укажите корректный российский номер телефона.");

  const numericAge = Number(age);
  if (String(age ?? "").trim() === "") addFieldError("age", "Укажите возраст.");
  else if (!Number.isInteger(numericAge) || numericAge < 14 || numericAge > 100) addFieldError("age", "Возраст должен быть от 14 до 100 лет.");

  if (!fields.city) addFieldError("city", "Укажите город проживания.");
  else if (!cityPattern.test(fields.city)) addFieldError("city", "Введите корректное название города.");

  if (!fields.telegramUsername) addFieldError("telegramUsername", "Укажите Username в Telegram.");
  else if (!telegramPattern.test(fields.telegramUsername)) addFieldError("telegramUsername", "Введите корректный Username в Telegram, например @username.");

  const professions = ["Специалист по проверке товаров", "Агент по работе с объектами", "Администратор объектов", "Менеджер по работе с клиентами", "Агент по поиску объектов", "Специалист выездной проверки", "Тайный покупатель"];
  if (!professions.includes(fields.profession)) addFieldError("profession", "Выберите одну из предложенных профессий.");

  const schedules = ["Полный день", "Неполный день", "Сменный график", "Удалённая работа", "Гибкий график"];
  const normalizedSchedule = clean(desiredSchedule, 64);
  if (!schedules.includes(normalizedSchedule)) addFieldError("desiredSchedule", "Выберите график из списка.");

  const numericSalary = Number(desiredSalary);
  if (String(desiredSalary ?? "").trim() === "") addFieldError("desiredSalary", "Укажите желаемый заработок.");
  else if (!Number.isInteger(numericSalary) || numericSalary < 0 || numericSalary > 100000000) addFieldError("desiredSalary", "Укажите корректную сумму от 0 до 100 000 000 ₽.");

  if (Object.keys(fieldErrors).length) {
    return res.status(400).json({
      error: "Пожалуйста, исправьте отмеченные поля.",
      fieldErrors
    });
  }

  const clientKey = req.ip || "unknown";
  const lastApplicationAt = recentApplicationByIp.get(clientKey) || 0;
  if (Date.now() - lastApplicationAt < APPLICATION_COOLDOWN_MS) {
    return res.status(429).json({ error: "Заявка уже была отправлена. Повторная отправка доступна через несколько минут." });
  }

  const chatToken = createChatToken();
  const result = db.prepare(`
    INSERT INTO applications (
      last_name, first_name, middle_name, phone, telegram_username, age, city,
      previous_activity, education, work_experience, profession,
      desired_schedule, desired_salary, chat_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.lastName, fields.firstName, "", normalizedPhone, fields.telegramUsername,
    numericAge, fields.city, fields.previousActivity,
    fields.education, fields.workExperience, fields.profession, normalizedSchedule, numericSalary,
    chatToken
  );

  recentApplicationByIp.set(clientKey, Date.now());
  res.status(201).json({ id: result.lastInsertRowid, chatToken });
});

function getApplicationByChatToken(token) {
  const cleanToken = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(cleanToken)) return null;
  return db.prepare("SELECT id, last_name, first_name, chat_token FROM applications WHERE chat_token = ?").get(cleanToken) || null;
}

function cleanChatMessage(value) {
  return String(value ?? "").trim().replace(/\r\n/g, "\n").slice(0, 2000);
}

async function notifyAdminViaTelegram({ applicationId, candidateName, message }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
    console.warn("Telegram notifications are disabled: set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID.");
    return;
  }

  const safeName = String(candidateName || "Кандидат").slice(0, 160);
  const safeMessage = String(message || "").slice(0, 2000);
  const lines = [
    "💬 <b>Новое сообщение от кандидата</b>",
    `👤 <b>${escapeTelegramHtml(safeName)}</b>`,
    `📝 ${escapeTelegramHtml(safeMessage)}`,
    `📌 Анкета №${applicationId}`,
    "💬 Нажмите «↩️ Ответить», чтобы ответить кандидату прямо из Telegram."
  ];

  const payload = {
    chat_id: TELEGRAM_ADMIN_CHAT_ID,
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true
  };

  const replyButtons = [[{ text: "↩️ Ответить", callback_data: `candidate_reply:${applicationId}` }]];
  if (PUBLIC_SITE_URL) {
    replyButtons.push([{ text: "Открыть админ-панель", url: `${PUBLIC_SITE_URL}/admin-dashboard.html?application=${applicationId}` }]);
  }
  payload.reply_markup = { inline_keyboard: replyButtons };

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      console.error("Telegram notification failed:", data?.description || response.statusText);
    }
  } catch (error) {
    console.error("Telegram notification error:", error.message);
  }
}

function escapeTelegramHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

app.post("/api/internal/chat/admin-reply", (req, res) => {
  if (!TELEGRAM_CHAT_REPLY_SECRET) return res.status(503).json({ error: "Telegram reply integration is not configured." });
  const provided = Buffer.from(String(req.get("x-czn-bot-secret") || ""));
  const expected = Buffer.from(TELEGRAM_CHAT_REPLY_SECRET);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return res.status(401).json({ error: "Недействительный ключ интеграции." });
  const applicationId = parsePositiveId(req.body?.applicationId);
  const message = cleanChatMessage(req.body?.message);
  if (!applicationId || !message) return res.status(400).json({ error: "Нужны applicationId и message." });
  const application = db.prepare("SELECT id FROM applications WHERE id = ?").get(applicationId);
  if (!application) return res.status(404).json({ error: "Анкета не найдена." });
  const result = db.prepare("INSERT INTO chat_messages (application_id, sender, message) VALUES (?, 'admin', ?)").run(applicationId, message);
  const row = db.prepare("SELECT id, sender, message, created_at FROM chat_messages WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.get("/api/chat/messages", (req, res) => {
  const application = getApplicationByChatToken(req.get("x-chat-token"));
  if (!application) return res.status(401).json({ error: "Чат недоступен. Откройте чат из подтверждения отправленной анкеты." });
  const after = Number(req.query.after || 0);
  const rows = Number.isInteger(after) && after > 0
    ? db.prepare("SELECT id, sender, message, created_at FROM chat_messages WHERE application_id = ? AND id > ? ORDER BY id ASC LIMIT 200").all(application.id, after)
    : db.prepare("SELECT id, sender, message, created_at FROM chat_messages WHERE application_id = ? ORDER BY id ASC LIMIT 200").all(application.id);
  res.json({ application: { id: application.id, name: `${application.first_name} ${application.last_name}`.trim() }, messages: rows });
});

app.post("/api/chat/messages", chatPostLimiter, requireSameOrigin, (req, res) => {
  const application = getApplicationByChatToken(req.get("x-chat-token"));
  if (!application) return res.status(401).json({ error: "Чат недоступен." });
  const message = cleanChatMessage(req.body?.message);
  if (!message) return res.status(400).json({ error: "Введите сообщение." });
  const result = db.prepare("INSERT INTO chat_messages (application_id, sender, message) VALUES (?, 'candidate', ?)").run(application.id, message);
  const row = db.prepare("SELECT id, sender, message, created_at FROM chat_messages WHERE id = ?").get(result.lastInsertRowid);
  const candidateName = `${application.first_name} ${application.last_name}`.trim();
  void notifyAdminViaTelegram({ applicationId: application.id, candidateName, message });
  res.status(201).json(row);
});

app.get("/api/applications/:id/chat", requireAdmin, (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Некорректный ID анкеты." });
  const application = db.prepare("SELECT id, first_name, last_name FROM applications WHERE id = ?").get(id);
  if (!application) return res.status(404).json({ error: "Анкета не найдена." });
  const rows = db.prepare("SELECT id, sender, message, created_at FROM chat_messages WHERE application_id = ? ORDER BY id ASC LIMIT 300").all(id);
  res.json({ application, messages: rows });
});

app.post("/api/applications/:id/chat", requireAdmin, chatPostLimiter, requireSameOrigin, (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Некорректный ID анкеты." });
  const application = db.prepare("SELECT id FROM applications WHERE id = ?").get(id);
  if (!application) return res.status(404).json({ error: "Анкета не найдена." });
  const message = cleanChatMessage(req.body?.message);
  if (!message) return res.status(400).json({ error: "Введите сообщение." });
  const result = db.prepare("INSERT INTO chat_messages (application_id, sender, message) VALUES (?, 'admin', ?)").run(id, message);
  const row = db.prepare("SELECT id, sender, message, created_at FROM chat_messages WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.get("/api/applications", requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT * FROM applications ORDER BY datetime(created_at) DESC
  `).all();
  res.json(rows);
});

app.patch("/api/applications/:id/status", requireAdmin, requireSameOrigin, (req, res) => {
  const allowed = ["new", "review", "invited", "rejected"];
  const { status } = req.body || {};
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Недопустимый статус." });
  }

  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Некорректный ID анкеты." });
  const result = db.prepare(
    "UPDATE applications SET status = ? WHERE id = ?"
  ).run(status, id);

  if (!result.changes) return res.status(404).json({ error: "Анкета не найдена." });
  res.json({ ok: true });
});


app.patch("/api/applications/:id/notes", requireAdmin, requireSameOrigin, (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Некорректный ID анкеты." });
  const notes = String(req.body?.notes ?? "").trim().slice(0, 5000);
  const result = db.prepare("UPDATE applications SET notes = ? WHERE id = ?").run(notes, id);
  if (!result.changes) return res.status(404).json({ error: "Анкета не найдена." });
  res.json({ ok: true });
});

app.delete("/api/applications/:id", requireAdmin, requireSameOrigin, (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Некорректный ID анкеты." });
  db.prepare("DELETE FROM chat_messages WHERE application_id = ?").run(id);
  const result = db.prepare("DELETE FROM applications WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: "Анкета не найдена." });
  res.status(204).end();
});

app.get("/api/applications/export.csv", requireAdmin, (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0).slice(0, 500);
  const rows = ids.length
    ? db.prepare(`SELECT * FROM applications WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY datetime(created_at) DESC`).all(...ids)
    : db.prepare("SELECT * FROM applications ORDER BY datetime(created_at) DESC").all();
  const headers = ["ID","Фамилия","Имя","Телефон","Username в Telegram","Возраст","Город","Чем занимались ранее","Место обучения","Опыт работы","Желаемый график","Желаемый заработок","Статус","Заметка работодателя","Дата заявки"];
  const fields = ["id","last_name","first_name","phone","telegram_username","age","city","previous_activity","education","work_experience","desired_schedule","desired_salary","status","notes","created_at"];
  const statusLabels = { new: "Новая", review: "Рассматривается", invited: "Приглашён", rejected: "Отказ" };
  const csvCell = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [headers.map(csvCell).join(";")];
  for (const row of rows) lines.push(fields.map((field) => csvCell(field === "status" ? (statusLabels[row[field]] || row[field]) : row[field])).join(";"));
  const csv = "\uFEFF" + lines.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="candidates-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

app.use(express.static(path.join(__dirname, "public")));

// Protected administrator panel. The login page is server-rendered so login does not depend on JavaScript.
app.get("/admin", (req, res) => {
  const authenticated = process.env.NODE_ENV !== "production"
    ? isDevAdmin(req)
    : req.session?.isAdmin === true;
  const page = authenticated ? "admin-dashboard.html" : "admin.html";
  res.sendFile(path.join(__dirname, "public", page));
});

const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`);
});
