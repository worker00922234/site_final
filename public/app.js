const form = document.querySelector("#applicationForm");
const message = document.querySelector("#message");
const submitButton = form?.querySelector("button[type=submit]");
const year = document.querySelector("#year");
const progressBar = document.querySelector("#formProgressBar");
const progressText = document.querySelector("#progressText");
const stepTitle = document.querySelector("#stepTitle");
const stepNumber = document.querySelector("#stepNumber");
const stepHint = document.querySelector("#stepHint");
if (year) year.textContent = new Date().getFullYear();

const phoneInput = document.querySelector("#phone");
const startedAt = document.querySelector("#formStartedAt");
if (startedAt) startedAt.value = String(Date.now());

function formatPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (!digits.startsWith("7")) digits = "7" + digits;
  digits = digits.slice(0, 11);
  if (digits.length === 0) return "";
  let result = "+7";
  if (digits.length > 1) result += " (" + digits.slice(1, 4);
  if (digits.length >= 4) result += ")";
  if (digits.length > 4) result += " " + digits.slice(4, 7);
  if (digits.length > 7) result += "-" + digits.slice(7, 9);
  if (digits.length > 9) result += "-" + digits.slice(9, 11);
  return result;
}

phoneInput?.addEventListener("input", () => { phoneInput.value = formatPhone(phoneInput.value); });
phoneInput?.addEventListener("paste", () => requestAnimationFrame(() => { phoneInput.value = formatPhone(phoneInput.value); }));
phoneInput?.addEventListener("blur", () => { phoneInput.value = formatPhone(phoneInput.value); });

const sections = [
  { title: "Личная информация", hint: "Основные данные для связи", fields: ["lastName", "firstName", "phone", "age", "city", "telegramUsername"] },
  { title: "Опыт и образование", hint: "Расскажите о вашем опыте", fields: ["previousActivity", "education", "workExperience"] },
  { title: "Выбор профессии", hint: "Выберите подходящую вакансию", fields: ["profession"] },
  { title: "Ваши пожелания", hint: "Выберите удобные условия", fields: ["desiredSchedule", "desiredSalary"] }
];

function fieldValue(name) {
  const field = form?.elements.namedItem(name);
  return field ? String(field.value || "").trim() : "";
}

function updateProgress() {
  if (!form) return;
  const required = [...form.querySelectorAll("[required]")].filter((field) => !field.name || !field.name.startsWith("_") && field.type !== "hidden");
  const filled = required.filter((field) => String(field.value || "").trim()).length;
  const percent = required.length ? Math.round((filled / required.length) * 100) : 0;
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (progressText) progressText.textContent = `${percent}% заполнено`;

  let active = 0;
  sections.forEach((section, index) => {
    const completed = section.fields.every((name) => fieldValue(name));
    if (!completed && active === 0) active = index;
  });
  if (sections.every((section) => section.fields.every((name) => fieldValue(name)))) active = sections.length - 1;
  if (stepNumber) stepNumber.textContent = `Шаг ${active + 1} из ${sections.length}`;
  if (stepTitle) stepTitle.textContent = sections[active].title;
  if (stepHint) stepHint.textContent = sections[active].hint;
}

document.querySelectorAll(".profession-option").forEach((button) => {
  button.addEventListener("click", () => {
    const input = form?.elements.namedItem("profession");
    if (!input) return;
    input.value = button.dataset.profession || "";
    document.querySelectorAll(".profession-option").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    updateProgress();
  });
});

form?.querySelectorAll("input, textarea, select").forEach((field) => {
  field.addEventListener("input", updateProgress);
  field.addEventListener("change", updateProgress);
});
updateProgress();

function setMessage(text, type = "") {
  if (!message) return;
  message.textContent = text;
  message.className = `message${type ? ` ${type}` : ""}`;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const profession = fieldValue("profession");
  if (!profession) {
    setMessage("Выберите профессию перед отправкой анкеты.", "error");
    document.querySelector(".profession-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const data = Object.fromEntries(new FormData(form).entries());
  setMessage("Проверяем данные…");
  if (submitButton) submitButton.disabled = true;

  try {
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Не удалось отправить анкету.");

    form.reset();
    if (startedAt) startedAt.value = String(Date.now());
    updateProgress();
    form.hidden = true;
    const success = document.querySelector("#successState");
    if (success) success.hidden = false;
    if (result.chatToken) {
      localStorage.setItem("czn_chat_token", result.chatToken);
      localStorage.setItem("czn_chat_application_id", String(result.id || ""));
      initCandidateChat(result.chatToken);
    }
    window.scrollTo({ top: document.querySelector(".form-card").offsetTop - 30, behavior: "smooth" });
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});


// Candidate chat -----------------------------------------------------------
const TELEGRAM_URL = "https://t.me/irina_mogileve";
const chatPanel = document.querySelector("#candidateChat");
const chatMessages = document.querySelector("#candidateChatMessages");
const chatForm = document.querySelector("#candidateChatForm");
const chatInput = document.querySelector("#candidateChatInput");
const chatStatus = document.querySelector("#candidateChatStatus");
let candidateChatToken = localStorage.getItem("czn_chat_token") || "";
let lastChatMessageId = 0;
let candidateChatTimer = null;

function escapeChatHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function chatTime(value) {
  const d = new Date(String(value).replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function renderCandidateMessages(rows, append = false) {
  if (!chatMessages) return;
  const html = rows.map((m) => `<div class="chat-message ${m.sender === "candidate" ? "mine" : "admin-message"}"><div class="chat-bubble">${escapeChatHtml(m.message).replace(/\n/g,"<br>")}</div><time>${chatTime(m.created_at)}</time></div>`).join("");
  if (append) chatMessages.insertAdjacentHTML("beforeend", html); else chatMessages.innerHTML = html || '<div class="chat-empty">Напишите нам — администратор ответит здесь.</div>';
  if (rows.length) lastChatMessageId = Math.max(lastChatMessageId, ...rows.map((m) => Number(m.id) || 0));
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
async function loadCandidateChat() {
  if (!candidateChatToken) return;
  try {
    const response = await fetch(`/api/chat/messages?after=${encodeURIComponent(lastChatMessageId)}`, { headers: { "X-Chat-Token": candidateChatToken } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { if (response.status === 401) { localStorage.removeItem("czn_chat_token"); candidateChatToken = ""; if (chatPanel) chatPanel.hidden = true; } return; }
    if (Array.isArray(data.messages) && data.messages.length) renderCandidateMessages(data.messages, lastChatMessageId > 0);
    if (chatStatus) chatStatus.textContent = "Чат открыт";
  } catch { if (chatStatus) chatStatus.textContent = "Не удалось обновить чат"; }
}
function initCandidateChat(token) {
  candidateChatToken = token || candidateChatToken;
  if (!candidateChatToken || !chatPanel) return;
  chatPanel.hidden = false;
  loadCandidateChat();
  if (candidateChatTimer) clearInterval(candidateChatTimer);
  candidateChatTimer = setInterval(loadCandidateChat, 4000);
}
chatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = String(chatInput?.value || "").trim();
  if (!message || !candidateChatToken) return;
  const button = chatForm.querySelector("button[type=submit]");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/chat/messages", { method: "POST", headers: { "Content-Type": "application/json", "X-Chat-Token": candidateChatToken }, body: JSON.stringify({ message }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось отправить сообщение.");
    if (chatInput) chatInput.value = "";
    renderCandidateMessages([data], true);
    if (chatStatus) chatStatus.textContent = "Сообщение отправлено";
  } catch (error) { if (chatStatus) chatStatus.textContent = error.message; }
  finally { if (button) button.disabled = false; }
});
document.querySelector("#telegramContact")?.setAttribute("href", TELEGRAM_URL);
if (candidateChatToken && document.querySelector("#successState")?.hidden === false) initCandidateChat(candidateChatToken);
