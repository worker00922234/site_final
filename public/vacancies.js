(() => {
  const grid = document.getElementById('vacancyGrid');
  const empty = document.getElementById('vacancyEmpty');
  const count = document.getElementById('vacancyCount');
  const search = document.getElementById('vacancySearch');
  const year = document.getElementById('year');
  if (!grid || !empty || !count || !search) return;

  let vacancies = [];

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

  const safe = (value, fallback = '—') => {
    const text = String(value ?? '').trim();
    return text || fallback;
  };

  function render(filter = '') {
    const q = String(filter).trim().toLowerCase();
    const rows = vacancies.filter((vacancy) => {
      const haystack = [
        vacancy.title,
        vacancy.category,
        vacancy.city,
        vacancy.schedule,
        vacancy.salary,
        vacancy.description
      ].map((value) => String(value ?? '')).join(' ').toLowerCase();
      return !q || haystack.includes(q);
    });

    count.textContent = rows.length;
    grid.hidden = rows.length === 0;
    empty.hidden = rows.length !== 0;

    grid.innerHTML = rows.map((vacancy, index) => `
      <article class="vacancy-card">
        <div class="vacancy-card-top">
          <span class="vacancy-tag">${esc(safe(vacancy.category, 'Вакансия'))}</span>
          <span class="vacancy-id">№ ${String(index + 1).padStart(2, '0')}</span>
        </div>
        <h2>${esc(safe(vacancy.title, 'Вакансия'))}</h2>
        <p>${esc(safe(vacancy.description, 'Подробности доступны на странице вакансии.'))}</p>
        <div class="vacancy-meta">
          <span>⌖ ${esc(safe(vacancy.city))}</span>
          <span>◷ ${esc(safe(vacancy.schedule))}</span>
          <span>₽ ${esc(safe(vacancy.salary))}</span>
        </div>
        <div class="vacancy-card-actions">
          <a class="secondary-button" href="/vacancies/${encodeURIComponent(String(vacancy.slug || ''))}">Подробнее</a>
          <a class="primary-button" href="/?vacancy=${encodeURIComponent(String(vacancy.title || ''))}">Откликнуться <span>→</span></a>
        </div>
      </article>
    `).join('');
  }

  async function loadVacancies() {
    grid.hidden = false;
    grid.innerHTML = '<div class="vacancy-loading">Загружаем вакансии…</div>';
    empty.hidden = true;

    try {
      const response = await fetch('/api/vacancies', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      vacancies = Array.isArray(payload) ? payload : (Array.isArray(payload.vacancies) ? payload.vacancies : []);
      render(search.value);
    } catch (error) {
      console.error('Не удалось загрузить вакансии:', error);
      vacancies = [];
      count.textContent = '0';
      grid.innerHTML = '';
      grid.hidden = true;
      empty.hidden = false;
      empty.textContent = 'Не удалось загрузить вакансии. Обновите страницу ещё раз.';
    }
  }

  search.addEventListener('input', (event) => render(event.target.value));
  if (year) year.textContent = new Date().getFullYear();
  loadVacancies();
})();
