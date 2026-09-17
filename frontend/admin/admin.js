const tabs = [...document.querySelectorAll('.tab')];
const views = [...document.querySelectorAll('.view')];
const state = {
  user: null,
  books: [],
  currentBook: null,
  series: [],
  ai: null,
};

const $ = (id) => document.getElementById(id);

function money(value, currency = 'USD') {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency,
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;',
  }[char]));
}

function setStatus(message, kind = '') {
  const node = $('global-status');
  if (!node) return;
  node.textContent = message || '';
  node.className = `global-status ${kind}`.trim();
}

function setInline(id, message, kind = '') {
  const node = $(id);
  if (!node) return;
  node.textContent = message || '';
  node.className = `inline-status ${kind}`.trim();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server returned an invalid response (${response.status}).`);
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

async function readAdminSession() {
  try {
    const data = await api('/api/auth/me');
    if (data.user?.role === 'admin') return data.user;
  } catch {
    // Retry below. The login response may still be settling in the browser.
  }
  return null;
}

async function ensureAdmin() {
  let user = await readAdminSession();

  // A fresh HttpOnly cookie can occasionally take a short moment to become
  // available after navigation on mobile browsers/CDN edges. Retry before
  // ever sending the administrator back through the login screen.
  if (!user) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    user = await readAdminSession();
  }
  if (!user) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    user = await readAdminSession();
  }

  if (!user) {
    throw new Error('Admin session could not be confirmed.');
  }

  state.user = user;
  $('admin-user').textContent = user.email;
  return user;
}

function goTo(section) {
  const tab = document.querySelector(`.tab[data-section="${section}"]`);
  if (tab) tab.click();
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) return () => {};
  const original = button.textContent;
  button.disabled = busy;
  if (busy) button.textContent = busyLabel;
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

function renderBookOptions() {
  const options = ['<option value="">Selecionar livro…</option>'];
  for (const book of state.books) {
    const selected = state.currentBook?.id === book.id ? ' selected' : '';
    options.push(
      `<option value="${escapeHtml(book.id)}"${selected}>${escapeHtml(book.title)} · ${escapeHtml(book.status)}</option>`,
    );
  }
  ['book-context', 'mobile-book-context'].forEach((id) => {
    const select = $(id);
    if (!select) return;
    select.innerHTML = options.join('');
    if (state.currentBook) select.value = state.currentBook.id;
  });
}

async function loadBooks() {
  const data = await api('/api/admin/books');
  state.books = data.items || [];
  renderBookOptions();
  if (!state.currentBook && state.books.length) {
    const stored = localStorage.getItem('nexauren_books_admin_book');
    const preferred = state.books.find((book) => book.id === stored);
    await selectBook(preferred?.id || state.books[0].id, false);
  } else if (state.currentBook) {
    const fresh = state.books.find((book) => book.id === state.currentBook.id);
    if (fresh) await selectBook(fresh.id, false);
  }
  renderBooksList();
}

async function selectBook(bookId, notify = true) {
  if (!bookId) {
    state.currentBook = null;
    renderBookOptions();
    renderDashboardBook();
    return;
  }
  const data = await api(`/api/admin/books/${encodeURIComponent(bookId)}`);
  state.currentBook = data.book;
  localStorage.setItem('nexauren_books_admin_book', bookId);
  renderBookOptions();
  renderDashboardBook();
  renderBookWorkspace();
  if (notify) setStatus(`Livro ativo: ${state.currentBook.title}`, 'success');
}

function renderBooksList() {
  const target = $('books-list');
  if (!target) return;
  if (!state.books.length) {
    target.innerHTML = '<div class="empty">Ainda não existem projetos. Crie o primeiro livro para começar o pipeline.</div>';
    return;
  }
  target.innerHTML = state.books.map((book) => `
    <div class="list-row">
      <div>
        <strong>${escapeHtml(book.title)}</strong>
        <span>${escapeHtml(book.author || 'Nexauren')} · ${escapeHtml(book.status)} · ${money(book.price_usd)}</span>
      </div>
      <button class="secondary-button" type="button" data-open-book="${escapeHtml(book.id)}">Abrir</button>
    </div>
  `).join('');

  target.querySelectorAll('[data-open-book]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await selectBook(button.dataset.openBook);
        goTo('dashboard');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  });
}

function renderDashboardBook() {
  const book = state.currentBook;
  $('dashboard-book-title').textContent = book?.title || 'Selecione um livro';
  $('book-stage').textContent = book?.status || 'Nenhum livro ativo';
  const info = $('dashboard-book-info');
  if (!info) return;
  if (!book) {
    info.innerHTML = '<div><span>Estado</span><strong>—</strong></div><div><span>Autor</span><strong>—</strong></div><div><span>Género</span><strong>—</strong></div><div><span>Capítulos</span><strong>—</strong></div>';
    return;
  }
  const chapters = book.chapters || [];
  const currentChapters = chapters.filter((item) => Number(item.is_current) === 1);
  info.innerHTML = `
    <div><span>Estado</span><strong>${escapeHtml(book.status)}</strong></div>
    <div><span>Autor</span><strong>${escapeHtml(book.author || 'Nexauren')}</strong></div>
    <div><span>Género</span><strong>${escapeHtml(book.genre || '—')}</strong></div>
    <div><span>Capítulos</span><strong>${currentChapters.length} / ${Number(book.approx_chapter_count || 0) || '—'}</strong></div>
  `;
}

async function loadOverview() {
  const data = await api('/api/admin/overview');
  $('m-books').textContent = data.books.total;
  $('m-published').textContent = data.books.published;
  $('m-drafts').textContent = data.books.drafts;
  $('m-review').textContent = data.books.review;
  $('m-users').textContent = data.platform.users;
  $('m-revenue').textContent = money(data.platform.revenue);

  const ai = data.ai || {};
  state.ai = ai;
  $('ai-text-model').textContent = ai.text_model || '—';
  $('ai-image-model').textContent = ai.image_model || '—';
  $('ai-summary').textContent = ai.configured
    ? `Workers AI está ligado. ${Number(ai.jobs_last_24h || 0)} execução(ões) nas últimas 24 horas.`
    : 'Workers AI ainda não está disponível neste Worker.';
  $('ai-dot').className = `live-dot ${ai.configured ? 'ready' : 'offline'}`;
  $('ai-state').className = `ai-state ${ai.configured ? 'ready' : 'offline'}`;
  $('ai-state').querySelector('span').textContent = ai.configured ? 'Workers AI pronto' : 'Workers AI offline';
}

function renderObject(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'object') return `<p>${escapeHtml(value)}</p>`;
  if (Array.isArray(value)) {
    if (!value.length) return '<p>Sem itens.</p>';
    return `<ul>${value.map((item) => `<li>${typeof item === 'object' ? renderObject(item) : escapeHtml(item)}</li>`).join('')}</ul>`;
  }
  return `<div class="ai-object">${Object.entries(value).map(([key, item]) => `
    <div class="ai-block">
      <h3>${escapeHtml(key.replace(/_/g, ' '))}</h3>
      ${renderObject(item)}
    </div>
  `).join('')}</div>`;
}

function renderAi(targetId, payload, title = '') {
  const target = $(targetId);
  if (!target) return;
  target.innerHTML = `${title ? `<div class="pipeline-label">${escapeHtml(title)}</div>` : ''}${renderObject(payload)}<details><summary>JSON estruturado</summary><pre class="ai-json">${escapeHtml(JSON.stringify(payload, null, 2))}</pre></details>`;
}

function renderBookWorkspace() {
  const book = state.currentBook;
  if (!book) return;
  const bible = book.story_bible || {};
  const researchRows = book.research_notes || [];
  let research = null;
  if (researchRows[0]) {
    try { research = JSON.parse(researchRows[0].note); } catch { research = { note: researchRows[0].note }; }
  }
  if (research) renderAi('research-view', research);
  if (Object.keys(bible).length) renderAi('bible-state', bible);
  else $('bible-state').innerHTML = '<div class="empty-state">A Story Bible ainda não foi gerada.</div>';

  const canon = book.canonical_facts || [];
  $('canon-list').innerHTML = canon.length ? canon.map((item) => `
    <div class="canon-row">
      <div><strong>${escapeHtml(item.fact_key)}</strong><span>${escapeHtml(item.fact_value)} · v${escapeHtml(item.version)}</span></div>
      <span class="${Number(item.immutable) ? 'locked' : ''}">${Number(item.immutable) ? '🔒 Locked' : 'Draft fact'}</span>
    </div>
  `).join('') : '<div class="empty">Nenhum facto canónico guardado.</div>';

  const characters = bible.characters || [];
  $('characters-list').innerHTML = characters.length ? characters.map((item) => `
    <article class="entity-card">
      <strong>${escapeHtml(item.name || item.id || 'Character')}</strong>
      <span>${escapeHtml(item.id || '')}</span>
      ${item.age !== undefined ? `<span>Idade: ${escapeHtml(item.age)}</span>` : ''}
      ${item.role ? `<span>Função: ${escapeHtml(item.role)}</span>` : ''}
    </article>
  `).join('') : '<div class="empty">A Story Bible ainda não tem personagens estruturados.</div>';

  const world = bible.world || {};
  $('world-view').innerHTML = Object.keys(world).length ? renderObject(world) : '<div class="empty-state">O World Builder será preenchido pela Story Bible.</div>';

  const timeline = bible.timeline || [];
  $('timeline-view').innerHTML = timeline.length ? timeline.map((item) => `
    <article class="timeline-item"><time>${escapeHtml(item.date || item.when || item.period || 'EVENTO')}</time><div><strong>${escapeHtml(item.title || item.name || 'Evento')}</strong><p>${escapeHtml(item.description || item.summary || '')}</p></div></article>
  `).join('') : '<div class="empty">Ainda não existem eventos na linha do tempo.</div>';

  const chapters = book.chapters || [];
  $('chapters-list').innerHTML = chapters.length ? chapters.map((chapter) => `
    <article class="chapter-row">
      <div class="chapter-number">Cap. ${escapeHtml(chapter.chapter_number)}</div>
      <div><strong>${escapeHtml(chapter.title || 'Sem título')}</strong><p>${escapeHtml(String(chapter.content || '').slice(0, 280))}${String(chapter.content || '').length > 280 ? '…' : ''}</p></div>
      <span class="version-pill">v${escapeHtml(chapter.version_number)}${Number(chapter.is_current) ? ' · atual' : ''}</span>
    </article>
  `).join('') : '<div class="empty">Nenhum capítulo foi gerado ainda.</div>';

  $('publication-status').innerHTML = `<span class="eyebrow">ESTADO ATUAL</span><strong>${escapeHtml(book.status)}</strong><p>${book.status === 'published' ? 'O título está visível na Store.' : 'O título ainda não está disponível na Store pública.'}</p>`;
  $('publication-price').value = Number(book.price_usd || 0).toFixed(2);
  $('sales-price').textContent = money(book.price_usd, book.currency || 'USD');
  loadFiles(book.slug).catch(() => {});
  loadSales(book.id).catch(() => {});
  loadCovers(book.id).catch(() => {});
  loadPublicationState(book.id).catch(() => {});
}

async function loadFiles(slug) {
  const target = $('files-view');
  if (!target || !state.currentBook) return;
  const data = await api(`/api/admin/files?book_id=${encodeURIComponent(state.currentBook.id)}`);
  const isPublished = state.currentBook.status === 'published';
  target.innerHTML = `
    <strong>${escapeHtml(data.chapters || 0)} capítulos atuais · geração ${data.generated_on_demand ? 'sob pedido' : 'armazenada'}</strong>
    <span class="file-note">PDF e EPUB são produzidos a partir do texto do livro quando solicitados. Não é necessário Backblaze B2.</span>
    ${isPublished ? `<div class="file-links"><a href="/api/books/${encodeURIComponent(slug)}/download?format=pdf">Baixar PDF</a><a href="/api/books/${encodeURIComponent(slug)}/download?format=epub">Baixar EPUB</a></div>` : '<span class="file-note">Publique o livro para habilitar os downloads de produção.</span>'}
  `;
}

async function loadSales(bookId) {
  const data = await api(`/api/admin/sales?book_id=${encodeURIComponent(bookId)}`);
  $('sales-orders').textContent = data.orders;
  $('sales-revenue').textContent = money(data.revenue, data.currency || 'USD');
}

async function loadPublicationState() {
  document.querySelectorAll('.status-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.status === state.currentBook?.status);
  });
  setInline('publication-status-note', `Estado persistido: ${state.currentBook?.status || 'draft'}.`, 'success');
}

async function loadSeries() {
  const data = await api('/api/admin/series');
  state.series = data.items || [];
  $('series-list').innerHTML = state.series.length ? state.series.map((series) => `
    <div class="list-row"><div><strong>${escapeHtml(series.name)}</strong><span>${escapeHtml(series.book_count)} livro(s) · ${escapeHtml(series.slug)}</span></div></div>
  `).join('') : '<div class="empty">Nenhuma série criada.</div>';
}

async function aiAction(action, extra = {}) {
  if (!state.currentBook) throw new Error('Selecione um livro primeiro.');
  return api('/api/admin/ai', {
    method: 'POST',
    body: JSON.stringify({ action, book_id: state.currentBook.id, ...extra }),
  });
}

async function runAiButton(button) {
  const action = button.dataset.ai;
  const finish = setButtonBusy(button, true, 'A processar…');
  setStatus(`Workers AI: ${action}…`, 'busy');
  try {
    const extra = {};
    if (action === 'chapter') {
      extra.chapter_number = Number($('chapter-number').value || 1);
      extra.instructions = $('chapter-instructions').value.trim();
    }
    const data = await aiAction(action, extra);
    if (action === 'research') renderAi('research-view', data.report, 'Research Report');
    if (action === 'story_bible') {
      await selectBook(state.currentBook.id, false);
      renderAi('bible-state', data.bible, 'Story Bible');
      goTo('bible');
    }
    if (action === 'outline') {
      await selectBook(state.currentBook.id, false);
      renderBookWorkspace();
      setStatus('Outline gerado e guardado na Story Bible.', 'success');
    }
    if (action === 'chapter') {
      await selectBook(state.currentBook.id, false);
      goTo('chapters');
    }
    if (action === 'story_state') {
      await selectBook(state.currentBook.id, false);
      setStatus('Story State atualizado.', 'success');
    }
    if (action === 'continuity') renderAi('continuity-view', data.report, 'Continuity Check');
    if (action === 'qa') renderAi('qa-view', data.qa, 'Book QA');
    if (action === 'originality') renderAi('originality-view', data.originality, 'Originality Check');
    if (action === 'seo') renderAi('seo-view', data.seo, 'SEO');
    setStatus(`Workers AI: ${action} concluído.`, 'success');
    if (['continuity', 'qa', 'originality', 'seo'].includes(action)) goTo(action === 'continuity' ? 'continuity' : action);
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    finish();
  }
}

document.querySelectorAll('.ai-action').forEach((button) => {
  button.addEventListener('click', () => runAiButton(button));
});

document.querySelectorAll('[data-go]').forEach((button) => {
  button.addEventListener('click', () => goTo(button.dataset.go));
});

$('book-context')?.addEventListener('change', async (event) => {
  try { await selectBook(event.target.value); } catch (error) { setStatus(error.message, 'error'); }
});
$('mobile-book-context')?.addEventListener('change', async (event) => {
  try { await selectBook(event.target.value); } catch (error) { setStatus(error.message, 'error'); }
});

$('book-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const finish = setButtonBusy(button, true, 'A guardar…');
  setInline('book-form-status', 'A guardar projeto…');
  try {
    const body = formObject(event.currentTarget);
    const data = await api('/api/admin/books', { method: 'POST', body: JSON.stringify(body) });
    setInline('book-form-status', 'Livro criado. A carregar o workspace…', 'success');
    event.currentTarget.reset();
    await loadBooks();
    await selectBook(data.id);
    goTo('bible');
  } catch (error) {
    setInline('book-form-status', error.message, 'error');
  } finally { finish(); }
});

$('create-and-research')?.addEventListener('click', async () => {
  const form = $('book-form');
  if (!form.reportValidity()) return;
  const button = $('create-and-research');
  const finish = setButtonBusy(button, true, 'A criar e pesquisar…');
  setInline('book-form-status', 'A criar o projeto e iniciar o Research Agent…');
  try {
    const data = await api('/api/admin/books', { method: 'POST', body: JSON.stringify(formObject(form)) });
    form.reset();
    await loadBooks();
    await selectBook(data.id);
    const research = await aiAction('research');
    renderAi('research-view', research.report, 'Research Report');
    setInline('book-form-status', 'Projeto criado e Research Report guardado.', 'success');
    goTo('bible');
  } catch (error) {
    setInline('book-form-status', error.message, 'error');
  } finally { finish(); }
});

$('series-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/admin/series', { method: 'POST', body: JSON.stringify(formObject(event.currentTarget)) });
    event.currentTarget.reset();
    await loadSeries();
    setStatus('Série criada.', 'success');
  } catch (error) { setStatus(error.message, 'error'); }
});

$('canon-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentBook) return setStatus('Selecione um livro primeiro.', 'error');
  const body = formObject(event.currentTarget);
  body.book_id = state.currentBook.id;
  body.immutable = body.immutable ? true : false;
  try {
    await api('/api/admin/canon', { method: 'POST', body: JSON.stringify(body) });
    await selectBook(state.currentBook.id, false);
    setStatus('Facto canónico guardado.', 'success');
  } catch (error) { setStatus(error.message, 'error'); }
});

$('registry-check')?.addEventListener('click', async () => {
  if (!state.currentBook) return setStatus('Selecione um livro primeiro.', 'error');
  const name = $('registry-name').value.trim();
  if (!name) return setStatus('Informe o nome da entidade.', 'error');
  let metadata = {};
  try { metadata = JSON.parse($('registry-meta').value || '{}'); } catch { return setStatus('Os metadados precisam ser JSON válido.', 'error'); }
  try {
    const data = await api('/api/admin/registry/check', { method: 'POST', body: JSON.stringify({
      book_id: state.currentBook.id,
      entity_type: $('registry-type').value,
      canonical_name: name,
      metadata,
    }) });
    const result = $('registry-result');
    result.innerHTML = data.candidates?.length
      ? `<div class="notice"><strong>Possíveis semelhanças</strong>${data.candidates.map((item) => `<p>${escapeHtml(item.canonical_name)} · ${Math.round(item.score * 100)}%</p>`).join('')}</div>`
      : '<div class="notice">Nenhuma semelhança relevante encontrada no registo local.</div>';
  } catch (error) { setStatus(error.message, 'error'); }
});

$('registry-save')?.addEventListener('click', async () => {
  if (!state.currentBook) return setStatus('Selecione um livro primeiro.', 'error');
  const name = $('registry-name').value.trim();
  if (!name) return setStatus('Informe o nome da entidade.', 'error');
  let metadata = {};
  try { metadata = JSON.parse($('registry-meta').value || '{}'); } catch { return setStatus('Os metadados precisam ser JSON válido.', 'error'); }
  try {
    await api('/api/admin/registry', { method: 'POST', body: JSON.stringify({
      book_id: state.currentBook.id,
      entity_type: $('registry-type').value,
      canonical_name: name,
      metadata,
    }) });
    setStatus('Entidade registada.', 'success');
    $('registry-name').value = '';
    $('registry-meta').value = '';
  } catch (error) { setStatus(error.message, 'error'); }
});

$('cover-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentBook) return setStatus('Selecione um livro primeiro.', 'error');
  const button = event.currentTarget.querySelector('button');
  const finish = setButtonBusy(button, true, 'A gerar capa…');
  try {
    const body = formObject(event.currentTarget);
    const data = await api('/api/admin/cover', { method: 'POST', body: JSON.stringify({
      book_id: state.currentBook.id,
      prompt: body.prompt,
    }) });
    await loadCovers(state.currentBook.id);
    setStatus(`Capa ${data.id} gerada.`, 'success');
  } catch (error) { setStatus(error.message, 'error'); }
  finally { finish(); }
});

async function loadCovers(bookId) {
  const target = $('covers-view');
  if (!target) return;
  const data = await api(`/api/admin/covers?book_id=${encodeURIComponent(bookId)}`);
  if (!data.items?.length) {
    target.innerHTML = '<div class="empty">Ainda não existem capas geradas.</div>';
    return;
  }
  target.innerHTML = data.items.map((cover) => `
    <article class="cover-card ${Number(cover.selected) ? 'selected' : ''}">
      <div class="cover-preview" data-cover-id="${escapeHtml(cover.id)}"></div>
      <div><strong>${Number(cover.selected) ? 'Selecionada' : 'Capa gerada'}</strong><span>${escapeHtml(cover.model)}</span></div>
      ${Number(cover.selected) ? '' : `<button class="secondary-button choose-cover" data-cover-id="${escapeHtml(cover.id)}" type="button">Escolher</button>`}
    </article>
  `).join('');
  const previews = [...target.querySelectorAll('.cover-preview')];
  const response = await Promise.all(data.items.map(async (item) => {
    const raw = await api(`/api/admin/covers/preview?cover_id=${encodeURIComponent(item.id)}`);
    return { id: item.id, data_uri: raw.data_uri };
  }));
  for (const item of response) {
    const node = target.querySelector(`[data-cover-id="${CSS.escape(item.id)}"]`);
    if (node) node.style.backgroundImage = `url('${item.data_uri}')`;
  }
  target.querySelectorAll('.choose-cover').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api('/api/admin/cover/select', { method: 'POST', body: JSON.stringify({ cover_id: button.dataset.coverId }) });
        await selectBook(state.currentBook.id, false);
        setStatus('Capa selecionada.', 'success');
      } catch (error) { setStatus(error.message, 'error'); }
    });
  });
}

$('save-publication')?.addEventListener('click', async () => {
  if (!state.currentBook) return setStatus('Selecione um livro primeiro.', 'error');
  const statusButton = document.querySelector('.status-button.active');
  const status = statusButton?.dataset.status || state.currentBook.status;
  try {
    const data = await api(`/api/admin/books/${encodeURIComponent(state.currentBook.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, price_usd: $('publication-price').value }),
    });
    state.currentBook = data.book;
    await loadBooks();
    await selectBook(state.currentBook.id, false);
    setStatus('Publicação guardada.', 'success');
  } catch (error) { setStatus(error.message, 'error'); }
});

document.querySelectorAll('.status-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.status-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

async function loadSettings() {
  try {
    const data = await api('/api/admin/settings');
    $('settings-view').innerHTML = `
      <article class="settings-card"><span>Workers AI</span><strong>${data.ai.configured ? 'Configurado' : 'Não configurado'}</strong><code>${escapeHtml(data.ai.text_model || '—')}</code></article>
      <article class="settings-card"><span>Semantic search</span><strong>${data.semantic_search.configured ? 'Vectorize ligado' : 'Fallback local'}</strong><code>${escapeHtml(data.semantic_search.embedding_model || '—')}</code></article>
      <article class="settings-card"><span>Ficheiros</span><strong>Geração sob pedido</strong><code>PDF · EPUB</code></article>
    `;
  } catch (error) { $('settings-view').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', async () => {
    const section = tab.dataset.section;
    tabs.forEach((item) => item.classList.toggle('active', item === tab));
    views.forEach((view) => view.classList.toggle('hidden', view.id !== `section-${section}`));

    if (section === 'books') await loadBooks();
    if (section === 'series') await loadSeries();
    if (section === 'settings') await loadSettings();
  });
});

$('logout')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  window.location.replace('/admin/login/');
});

(async () => {
  try {
    const user = await ensureAdmin();
    await Promise.all([loadOverview(), loadBooks()]);
    setStatus(`Admin ligado: ${user.email}`, 'success');
  } catch (error) {
    $('admin-user').textContent = 'Session unavailable';
    setStatus(error.message, 'error');
  }
})();
