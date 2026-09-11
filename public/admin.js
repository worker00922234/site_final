const applicationsBody = document.querySelector("#applications");
const mobileCandidates = document.querySelector("#mobileCandidates");
const empty = document.querySelector("#empty");
const searchInput = document.querySelector("#search");
const statusFilter = document.querySelector("#statusFilter");
const cityFilter = document.querySelector("#cityFilter");
const scheduleFilter = document.querySelector("#scheduleFilter");
const salaryMin = document.querySelector("#salaryMin");
const salaryMax = document.querySelector("#salaryMax");
const refreshButton = document.querySelector("#refresh");
const sortFilter = document.querySelector("#sortFilter");
const selectAll = document.querySelector("#selectAll");
const selectedCount = document.querySelector("#selectedCount");
const exportSelected = document.querySelector("#exportSelected");
const clearFiltersButton = document.querySelector("#clearFilters");
const pagination = document.querySelector("#pagination");
const prevPage = document.querySelector("#prevPage");
const nextPage = document.querySelector("#nextPage");
const pageInfo = document.querySelector("#pageInfo");
const filterState = document.querySelector("#filterState");
const PAGE_SIZE = 25;
let currentPage = 1;
let applications = [];
const selectedIds = new Set();

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { ...(options.headers || {}) }
  });
  return response;
}

async function loadApplications() {
  try {
    const response = await api("/api/applications");
    const data = await response.json().catch(() => ([]));
    if (response.status === 401) { window.location.href = "/admin"; return; }
    if (!response.ok) { alert(data?.error || `Не удалось загрузить анкеты (HTTP ${response.status})`); return; }
    applications = Array.isArray(data) ? data : [];
    const validIds = new Set(applications.map((a) => String(a.id)));
    [...selectedIds].forEach((id) => { if (!validIds.has(String(id))) selectedIds.delete(id); });
    populateCities();
    renderApplications();
    updateStats();
  } catch (error) {
    console.error("Applications error:", error);
    alert("Не удалось загрузить анкеты. Проверьте, что сервер запущен.");
  }
}

function populateCities() {
  if (!cityFilter) return;
  const current = cityFilter.value;
  const cities = [...new Set(applications.map((a) => String(a.city || "").trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, "ru"));
  cityFilter.innerHTML = '<option value="">Все города</option>' + cities.map((city) => `<option value="${escapeAttr(city)}">${escapeHtml(city)}</option>`).join("");
  cityFilter.value = cities.includes(current) ? current : "";
}

function getFiltered() {
  const query = searchInput?.value.trim().toLowerCase() || "";
  const selectedStatus = statusFilter?.value || "";
  const selectedCity = cityFilter?.value || "";
  const selectedSchedule = scheduleFilter?.value || "";
  const min = Number(salaryMin?.value || 0);
  const max = Number(salaryMax?.value || 0);
  const filtered = applications.filter((a) => {
    const fullName = `${a.last_name} ${a.first_name} ${a.middle_name || ""}`.toLowerCase();
    const haystack = [fullName, a.city, a.phone, a.work_experience, a.previous_activity, a.education].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) &&
      (!selectedStatus || a.status === selectedStatus) &&
      (!selectedCity || a.city === selectedCity) &&
      (!selectedSchedule || a.desired_schedule === selectedSchedule) &&
      (!min || Number(a.desired_salary) >= min) &&
      (!max || Number(a.desired_salary) <= max);
  });
  const sort = sortFilter?.value || "newest";
  filtered.sort((a,b) => {
    if (sort === "oldest") return new Date(a.created_at) - new Date(b.created_at);
    if (sort === "salaryHigh") return Number(b.desired_salary) - Number(a.desired_salary);
    if (sort === "salaryLow") return Number(a.desired_salary) - Number(b.desired_salary);
    return new Date(b.created_at) - new Date(a.created_at);
  });
  return filtered;
}

function candidateName(a) { return `${a.last_name} ${a.first_name} ${a.middle_name || ""}`.trim(); }
function candidateRow(a) { return `
  <tr>
    <td class="check-col"><input class="candidate-check" type="checkbox" data-id="${a.id}" ${selectedIds.has(String(a.id)) ? "checked" : ""} aria-label="Выбрать ${escapeAttr(candidateName(a))}"></td>
    <td><strong>${escapeHtml(candidateName(a))}</strong></td>
    <td>${escapeHtml(a.city)}</td>
    <td><a class="phone-link" href="tel:${escapeAttr(a.phone || "")}">${escapeHtml(a.phone || "—")}</a></td>
    <td>${a.age}</td><td>${escapeHtml(a.profession || "—")}</td><td>${escapeHtml(a.desired_schedule)}</td>
    <td>${Number(a.desired_salary).toLocaleString("ru-RU")} ₽</td>
    <td><select data-id="${a.id}" class="status-select" aria-label="Статус анкеты">${statusOptions(a.status)}</select></td>
    <td><div class="row-actions"><a class="call-btn" href="tel:${escapeAttr(a.phone || "")}" title="Позвонить">☎</a><button type="button" class="details-btn" data-id="${a.id}">Подробнее</button><button type="button" class="delete-btn" data-id="${a.id}" aria-label="Удалить анкету">Удалить</button></div></td>
  </tr>`; }

function candidateCard(a) { return `
  <article class="candidate-card">
    <div class="candidate-card-top"><label class="candidate-select"><input class="candidate-check" type="checkbox" data-id="${a.id}" ${selectedIds.has(String(a.id)) ? "checked" : ""}> <span>Выбрать</span></label><span class="status-pill ${escapeHtml(a.status)}">${escapeHtml(statusLabel(a.status))}</span></div>
    <h3>${escapeHtml(candidateName(a))}</h3>
    <div class="candidate-meta"><span>${escapeHtml(a.city)}</span><span>${a.age} лет</span><span>${Number(a.desired_salary).toLocaleString("ru-RU")} ₽</span></div>
    <p class="candidate-schedule">${escapeHtml(a.desired_schedule)}</p>
    <a class="mobile-phone" href="tel:${escapeAttr(a.phone || "")}">☎ ${escapeHtml(a.phone || "Телефон не указан")}</a>
    <div class="mobile-actions"><button type="button" class="details-btn" data-id="${a.id}">Подробнее</button><button type="button" class="delete-btn" data-id="${a.id}">Удалить</button></div>
    <label class="mobile-status">Статус<select data-id="${a.id}" class="status-select">${statusOptions(a.status)}</select></label>
  </article>`; }

function renderApplications() {
  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  if (applicationsBody) applicationsBody.innerHTML = visible.map(candidateRow).join("");
  if (mobileCandidates) mobileCandidates.innerHTML = visible.map(candidateCard).join("");
  if (empty) empty.hidden = filtered.length !== 0;
  const resultCount = document.querySelector("#resultCount");
  if (resultCount) resultCount.textContent = `${filtered.length} ${pluralize(filtered.length, "анкета", "анкеты", "анкет")}`;
  updateSelectionUI(filtered);
  updatePagination(filtered);
  updateFilterState();
  bindRenderedActions();
}

function updatePagination(filtered) {
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (pagination) pagination.hidden = filtered.length <= PAGE_SIZE;
  if (pageInfo) pageInfo.textContent = `Страница ${currentPage} из ${totalPages}`;
  if (prevPage) prevPage.disabled = currentPage <= 1;
  if (nextPage) nextPage.disabled = currentPage >= totalPages;
}

function updateFilterState() {
  if (!filterState) return;
  const parts = [];
  if (searchInput?.value.trim()) parts.push(`поиск: «${searchInput.value.trim()}»`);
  if (statusFilter?.value) parts.push(statusFilter.options[statusFilter.selectedIndex]?.text || "статус");
  if (cityFilter?.value) parts.push(cityFilter.value);
  if (scheduleFilter?.value) parts.push(scheduleFilter.value);
  if (salaryMin?.value) parts.push(`от ${Number(salaryMin.value).toLocaleString("ru-RU")} ₽`);
  if (salaryMax?.value) parts.push(`до ${Number(salaryMax.value).toLocaleString("ru-RU")} ₽`);
  filterState.textContent = parts.length ? `· ${parts.join(" · ")}` : "";
}

function resetFilters() {
  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "";
  if (cityFilter) cityFilter.value = "";
  if (scheduleFilter) scheduleFilter.value = "";
  if (salaryMin) salaryMin.value = "";
  if (salaryMax) salaryMax.value = "";
  if (sortFilter) sortFilter.value = "newest";
  currentPage = 1;
  renderApplications();
}

function bindRenderedActions() {
  document.querySelectorAll(".candidate-check").forEach((input) => input.addEventListener("change", () => {
    const id = String(input.dataset.id); if (input.checked) selectedIds.add(id); else selectedIds.delete(id); updateSelectionUI(getFiltered()); syncCheckBoxes();
  }));
  document.querySelectorAll(".status-select").forEach((select) => select.addEventListener("change", () => updateStatus(select)));
  document.querySelectorAll(".details-btn").forEach((button) => button.addEventListener("click", () => showDetails(button.dataset.id)));
  document.querySelectorAll(".delete-btn").forEach((button) => button.addEventListener("click", () => deleteApplication(button.dataset.id)));
}

async function updateStatus(select) {
  select.disabled = true;
  try {
    const response = await api(`/api/applications/${select.dataset.id}/status`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({status:select.value}) });
    if (!response.ok) { await loadApplications(); return; }
    const item = applications.find((a) => String(a.id) === String(select.dataset.id)); if (item) item.status = select.value;
    updateStats(); renderApplications();
  } finally { select.disabled = false; }
}

async function deleteApplication(id) {
  const item = applications.find((a) => String(a.id) === String(id)); if (!item) return;
  if (!confirm(`Удалить анкету ${candidateName(item)}? Это действие нельзя отменить.`)) return;
  const response = await api(`/api/applications/${id}`, {method:"DELETE"});
  if (!response.ok) { const data=await response.json().catch(()=>({})); alert(data.error || "Не удалось удалить анкету."); return; }
  selectedIds.delete(String(id)); applications=applications.filter((a)=>String(a.id)!==String(id)); renderApplications(); updateStats();
}

function showDetails(id) {
  const a = applications.find((item) => String(item.id) === String(id)); if (!a) return;
  const details=document.querySelector("#details"), body=document.querySelector("#detailsBody"); if(!details||!body)return;
  body.innerHTML=`<div class="details-title-row"><div><p class="admin-kicker">Карточка кандидата</p><h2>${escapeHtml(candidateName(a))}</h2></div><span class="status-pill ${escapeHtml(a.status)}">${escapeHtml(statusLabel(a.status))}</span></div>
    <div class="quick-contact"><a href="tel:${escapeAttr(a.phone||"")}">☎ Позвонить</a><button type="button" id="copyPhone">⧉ Скопировать телефон</button></div>
    <dl class="details-list">${detail("Телефон", a.phone||"—")}${detail("Username в Telegram", a.telegram_username||"—")}${detail("Возраст", `${a.age} лет`)}${detail("Город", a.city)}${detail("Профессия", a.profession||"—")}${detail("Чем занимался ранее", a.previous_activity||"—")}${detail("Место обучения", a.education||"—")}${detail("Опыт работы", a.work_experience||"—")}${detail("Желаемый график", a.desired_schedule)}${detail("Желаемый заработок", `${Number(a.desired_salary).toLocaleString("ru-RU")} ₽`)}${detail("Дата заявки", formatDate(a.created_at))}</dl>
    <div class="notes-box"><label for="candidateNotes">Заметка работодателя</label><textarea id="candidateNotes" rows="4" maxlength="5000" placeholder="Например: позвонить после 18:00, сильный опыт в продажах…">${escapeHtml(a.notes||"")}</textarea><button type="button" class="save-notes" data-save-notes="${a.id}">Сохранить заметку</button><span class="save-state" id="notesState" role="status"></span></div>
    <section class="admin-chat"><div class="admin-chat-head"><div><b>Чат с кандидатом</b><span id="adminChatStatus">Загрузка…</span></div><button type="button" id="adminChatRefresh">↻</button></div><div id="adminChatMessages" class="admin-chat-messages"></div><form id="adminChatForm" class="admin-chat-form"><textarea id="adminChatInput" rows="2" maxlength="2000" placeholder="Ответить кандидату…" required></textarea><button type="submit">Отправить</button></form></section>
    <div class="dialog-actions"><button type="button" class="danger-button" data-dialog-delete="${a.id}">Удалить анкету</button></div>`;
  body.querySelector("#copyPhone")?.addEventListener("click", async()=>{try{await navigator.clipboard.writeText(a.phone||""); const b=body.querySelector("#copyPhone"); b.textContent="✓ Скопировано"; setTimeout(()=>b.textContent="⧉ Скопировать телефон",1500);}catch{}});
  body.querySelector("[data-save-notes]")?.addEventListener("click", async()=>{const button=body.querySelector("[data-save-notes]"),ta=body.querySelector("#candidateNotes"),state=body.querySelector("#notesState"); button.disabled=true; const response=await api(`/api/applications/${a.id}/notes`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({notes:ta.value})}); if(response.ok){a.notes=ta.value.slice(0,5000);state.textContent="Сохранено";}else state.textContent="Не удалось сохранить";button.disabled=false;});
  body.querySelector("[data-dialog-delete]")?.addEventListener("click",async()=>{if(!confirm("Удалить эту анкету? Это действие нельзя отменить."))return; await deleteApplication(a.id); details.close();});

  let adminChatLastId = 0;
  let adminChatTimer = null;
  const adminChatMessages = body.querySelector("#adminChatMessages");
  const adminChatStatus = body.querySelector("#adminChatStatus");
  const adminChatInput = body.querySelector("#adminChatInput");
  const adminChatForm = body.querySelector("#adminChatForm");
  const renderAdminChat = (rows) => {
    if (!adminChatMessages) return;
    adminChatMessages.innerHTML = rows.length ? rows.map((m)=>`<div class="admin-chat-msg ${m.sender === "admin" ? "mine" : ""}"><div>${escapeHtml(m.message).replace(/\n/g,"<br>")}</div><time>${formatDate(m.created_at)}</time></div>`).join("") : '<div class="admin-chat-empty">Кандидат ещё не написал сообщений.</div>';
    if (rows.length) adminChatLastId = Math.max(...rows.map((m)=>Number(m.id)||0));
    adminChatMessages.scrollTop = adminChatMessages.scrollHeight;
  };
  const loadAdminChat = async () => {
    try {
      const response = await api(`/api/applications/${a.id}/chat`);
      const data = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить чат.");
      renderAdminChat(data.messages || []);
      if (adminChatStatus) adminChatStatus.textContent = "Чат активен";
    } catch (error) { if (adminChatStatus) adminChatStatus.textContent = error.message; }
  };
  adminChatForm?.addEventListener("submit", async (event)=>{
    event.preventDefault();
    const message = String(adminChatInput?.value||"").trim(); if (!message) return;
    const button = adminChatForm.querySelector("button[type=submit]"); if(button)button.disabled=true;
    try {
      const response = await api(`/api/applications/${a.id}/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message})});
      const data=await response.json().catch(()=>({})); if(!response.ok)throw new Error(data.error||"Не удалось отправить сообщение.");
      if(adminChatInput)adminChatInput.value="";
      await loadAdminChat();
    } catch(error){if(adminChatStatus)adminChatStatus.textContent=error.message;} finally{if(button)button.disabled=false;}
  });
  body.querySelector("#adminChatRefresh")?.addEventListener("click", loadAdminChat);
  loadAdminChat();
  adminChatTimer = setInterval(loadAdminChat, 4000);
  details.addEventListener("close",()=>{if(adminChatTimer)clearInterval(adminChatTimer);},{once:true});
  details.showModal();
}

function updateSelectionUI(filtered) {
  if(selectedCount) selectedCount.textContent=`${selectedIds.size} выбрано`;
  if(exportSelected) exportSelected.disabled=selectedIds.size===0;
  if(selectAll){const visible=filtered.map(a=>String(a.id)); selectAll.checked=visible.length>0 && visible.every(id=>selectedIds.has(id)); selectAll.indeterminate=visible.some(id=>selectedIds.has(id)) && !selectAll.checked;}
}
function syncCheckBoxes(){document.querySelectorAll(".candidate-check").forEach((x)=>x.checked=selectedIds.has(String(x.dataset.id)));}
function exportSelectedCsv(){if(!selectedIds.size)return; window.location.href=`/api/applications/export.csv?ids=${encodeURIComponent([...selectedIds].join(","))}`;}
function detail(label,value){return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;}
function updateStats(){setText("total",applications.length);setText("newCount",applications.filter(a=>a.status==="new").length);setText("reviewCount",applications.filter(a=>a.status==="review").length);setText("invitedCount",applications.filter(a=>a.status==="invited").length);setText("rejectedCount",applications.filter(a=>a.status==="rejected").length);}
function setText(id,value){const e=document.getElementById(id);if(e)e.textContent=value;}
function statusOptions(current){return [["new","Новая"],["review","Рассматривается"],["invited","Приглашён"],["rejected","Отказ"]].map(([v,l])=>`<option value="${v}" ${v===current?"selected":""}>${l}</option>`).join("");}
function statusLabel(status){return({new:"Новая",review:"Рассматривается",invited:"Приглашён",rejected:"Отказ"})[status]||status;}
function formatDate(value){const date=new Date(String(value).replace(" ","T")+"Z");return Number.isNaN(date.getTime())?String(value||"—"):date.toLocaleString("ru-RU");}
function pluralize(n,one,few,many){const n10=n%10,n100=n%100;if(n10===1&&n100!==11)return one;if(n10>=2&&n10<=4&&(n100<10||n100>=20))return few;return many;}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function escapeAttr(value){return escapeHtml(value).replace(/`/g,"&#96;");}

[searchInput,statusFilter,cityFilter,scheduleFilter,salaryMin,salaryMax,sortFilter].forEach((el)=>el?.addEventListener(el===searchInput||el===salaryMin||el===salaryMax?"input":"change",()=>{ currentPage = 1; renderApplications(); }));
clearFiltersButton?.addEventListener("click", resetFilters);
prevPage?.addEventListener("click",()=>{ if(currentPage>1){currentPage--;renderApplications();window.scrollTo({top:0,behavior:"smooth"});} });
nextPage?.addEventListener("click",()=>{ const pages=Math.max(1,Math.ceil(getFiltered().length/PAGE_SIZE)); if(currentPage<pages){currentPage++;renderApplications();window.scrollTo({top:0,behavior:"smooth"});} });
selectAll?.addEventListener("change",()=>{getFiltered().forEach(a=>selectAll.checked?selectedIds.add(String(a.id)):selectedIds.delete(String(a.id)));renderApplications();});
exportSelected?.addEventListener("click",exportSelectedCsv);
refreshButton?.addEventListener("click",loadApplications);
document.querySelector("#close")?.addEventListener("click",()=>document.querySelector("#details")?.close());
document.querySelector("#logout")?.addEventListener("click",async()=>{await api("/api/logout",{method:"POST"});window.location.href="/admin";});
loadApplications();
