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

async function ensureAdmin() {
  const data = await api('/api/auth/me');
  if (!data.user || data.user.role !== 'admin') {
    window.location.replace('/admin/login/');
    return null;
  }
  state.user = data.user;
  $('admin-user').textContent = data.user.email;
  return data.user;
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
    if (select) select.innerHTML = options.join('');
    if (select && state.currentBook) select.value = state.currentBook.id;
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
      await selectBook(button.dataset.openBook);
      goTo('dashboard');
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

function renderObject(value, level = 0) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'object') return `<p>${escapeHtml(value)}</p>`;
  if (Array.isArray(value)) {
    if (!value.length) return '<p>Sem itens.</p>';
    return `<ul>${value.map((item) => `<li>${typeof item === 'object' ? renderObject(item, level + 1) : escapeHtml(item)}</li>`).join('')}</ul>`;
  }
  return `<div class="ai-object">${Object.entries(value).map(([key, item]) => `
    <div class="ai-block">
      <h3>${escapeHtml(key.replace(/_/g, ' '))}</h3>
      ${renderObject(item, level + 1)}
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
  const research = (book.research_notes || []).map((row) => {
    try { return JSON.parse(row.note); } catch { return { note: row.note }; }
  })[0];
  if (research) renderAi('research-view', research);
  if (bible.identity || bible.story || bible.characters?.length) renderAi('bible-state', bible);
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

  const slug = book.slug;
  $('publication-status').innerHTML = `<span class="eyebrow">ESTADO ATUAL</span><strong>${escapeHtml(book.status)}</strong><p>${book.status === 'published' ? 'O título está visível na Store.' : 'O título ainda não está disponível na Store pública.'}</p>`;
  $('publication-price').value = Number(book.price_usd || 0).toFixed(2);

  $('sales-price').textContent = money(book.price_usd, book.currency || 'USD');

  $('file-view').textContent = '';
  loadFiles(slug).catch(() => {});
  loadSales(book.id).catch(() => {});
  loadCovers(book.id).catch(() => {});
  loadPublicationState(book.id).catch(() => {});
}

async function loadFiles(slug) {
  const target = $('files-view');
  if (!target || !state.currentBook) return;
  const data = await api(`/api/admin/files?book_id=${encodeURIComponent(state.currentBook.id)}`);
  const canUsePublicUrl = state.currentBook.status === 'published';
  target.innerHTML = `
    <strong>${escapeHtml(data.chapters || 0)} capítulos atuais · geração ${data.generated_on_demand ? 'sob pedido' : 'armazenada'}</strong>
    <span class="file-note">PDF e EPUB são produzidos a partir do texto do livro quando solicitados. Não é necessário Backblaze B2 para este fluxo.</span>
    ${canUsePublicUrl ? `<div class="file-links"><a href="/api/books/${encodeURIComponent(slug)}/download?format=pdf">Baixar PDF</a><a href="/api/books/${encodeURIComponent(slug)}/download?format=epub">Baixar EPUB</a></div>` : '<span class="file-note">Publique o livro para habilitar os downloads protegidos de produção.</span>'}
  `;
}

async function loadSales(bookId) {
  const data = await api(`/api/admin/sales?book_id=${encodeURIComponent(bookId)}`);
  $('sales-orders').textContent = data.orders;
  $('sales-revenue').textContent = money(data.revenue, data.currency || 'USD');
}

async function loadPublicationState(bookId) {
  // The current database keeps the editorial book status as the durable state.
  // The UI presents the same workflow and avoids inventing a state the schema cannot persist.
  document.querySelectorAll('.status-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.status === state.currentBook?.status);
  });
  if ($('publication-status-note')) setInline('publication-status-note', `Estado persistido: ${state.currentBook?.status || 'draft'}.`, 'success');
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
  setStatus(`Workers AI: ${action}…`);
  try {
    const data = await aiAction(action, {
      chapter_number: Number($('chapter-number')?.value || 1),
      instructions: $('chapter-instructions')?.value || '',
    });
    if (action === 'research') renderAi('research-view', data.report);
    if (action === 'story_bible') renderAi('bible-state', data.bible);
    if (action === 'outline') renderAi('bible-state', data.outline, 'OUTLINE');
    if (action === 'chapter') renderAi('chapters-list', data.chapter, `CAPÍTULO ${data.chapter?.title || ''}`);
    if (action === 'story_state') renderAi('world-view', data.state, 'STORY STATE');
    if (action === 'continuity') renderAi('continuity-view', data.report);
    if (action === 'qa') renderAi('qa-view', data.qa);
    if (action === 'originality') renderAi('originality-view', data.originality);
    if (action === 'seo') renderAi('seo-view', data.seo);
    await selectBook(state.currentBook.id, false);
    await loadOverview();
    setStatus(`Workers AI concluiu: ${action}.`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    finish();
  }
}

async function registryCheck() {
  if (!state.currentBook) throw new Error('Selecione um livro primeiro.');
  const name = $('registry-name').value.trim();
  if (!name) throw new Error('Indique o nome da nova entidade.');
  let metadata = {};
  const raw = $('registry-meta').value.trim();
  if (raw) metadata = JSON.parse(raw);
  const data = await api('/api/admin/registry/check', {
    method: 'POST',
    body: JSON.stringify({
      book_id: state.currentBook.id,
      entity_type: $('registry-type').value,
      canonical_name: name,
      metadata,
    }),
  });
  const target = $('registry-result');
  target.innerHTML = data.candidates?.length ? `
    <div class="similarity"><strong>Possíveis semelhanças</strong><br>${data.candidates.map((item) => `${escapeHtml(item.canonical_name)} · ${Math.round(Number(item.score) * 100)}%`).join('<br>')}<br><small>${data.vectorize_enabled ? 'Vectorize configurado.' : 'Busca local de fallback; Vectorize ainda não configurado.'}</small></div>
  ` : '<div class="notice">Nenhuma semelhança relevante encontrada nesta verificação.</div>';
}

async function registrySave() {
  if (!state.currentBook) throw new Error('Selecione um livro primeiro.');
  const name = $('registry-name').value.trim();
  if (!name) throw new Error('Indique o nome da entidade.');
  let metadata = {};
  const raw = $('registry-meta').value.trim();
  if (raw) metadata = JSON.parse(raw);
  await api('/api/admin/registry', {
    method: 'POST',
    body: JSON.stringify({
      book_id: state.currentBook.id,
      entity_type: $('registry-type').value,
      canonical_name: name,
      metadata,
    }),
  });
  $('registry-name').value = '';
  $('registry-meta').value = '';
  setStatus('Entidade registada.', 'success');
}

async function loadCovers(bookId) {
  const target = $('covers-view');
  if (!target) return;
  const data = await api(`/api/admin/covers?book_id=${encodeURIComponent(bookId)}`);
  if (!data.items?.length) {
    target.innerHTML = '<div class="empty">Ainda não existem capas. Gere a primeira com Workers AI.</div>';
    return;
  }
  target.innerHTML = data.items.map((cover) => `
    <article class="cover-card">
      <img class="cover-image" alt="Capa gerada" loading="lazy" src="/api/books/${encodeURIComponent(bookId)}/cover?cover=${encodeURIComponent(cover.id)}">
      <p>${escapeHtml(cover.model)} · ${Number(cover.selected) ? 'Selecionada' : 'Não selecionada'}</p>
      ${Number(cover.selected) ? '' : `<button class="secondary-button" type="button" data-select-cover="${escapeHtml(cover.id)}">Escolher esta</button>`}
    </article>
  `).join('');
  target.querySelectorAll('[data-select-cover]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api('/api/admin/cover/select', {
          method: 'POST',
          body: JSON.stringify({ cover_id: button.dataset.selectCover }),
        });
        await selectBook(state.currentBook.id, false);
        setStatus('Capa selecionada.', 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  });
}

async function savePublication() {
  if (!state.currentBook) throw new Error('Selecione um livro primeiro.');
  const status = document.querySelector('.status-button.active')?.dataset.status
    || state.currentBook.status
    || 'draft';
  const price = Number($('publication-price').value || 0).toFixed(2);
  await api(`/api/admin/books/${encodeURIComponent(state.currentBook.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, price_usd: price }),
  });
  await selectBook(state.currentBook.id, false);
  await loadBooks();
  await loadOverview();
  setInline('publication-status-note', `Guardado: ${state.currentBook.status}.`, 'success');
}

async function refreshSection(section) {
  if (section === 'books') renderBooksList();
  if (!state.currentBook && !['dashboard', 'books', 'create', 'series', 'settings'].includes(section)) {
    setStatus('Selecione um livro antes de abrir este módulo.', 'error');
    return;
  }
  try {
    if (section === 'dashboard') await loadOverview();
    if (section === 'books') await loadBooks();
    if (section === 'series') await loadSeries();
    if (['bible', 'characters', 'world', 'timeline', 'chapters', 'files', 'publication', 'sales', 'continuity', 'qa', 'originality', 'covers', 'seo'].includes(section)) renderBookWorkspace();
    if (section === 'settings') {
      const data = await api('/api/admin/settings');
      $('settings-view').innerHTML = `
        <div class="setting-card"><span>Workers AI</span><strong class="${data.ai.configured ? 'setting-ok' : 'setting-off'}">${data.ai.configured ? 'Configurado' : 'Não configurado'}</strong></div>
        <div class="setting-card"><span>Text model</span><strong>${escapeHtml(data.ai.text_model || '—')}</strong></div>
        <div class="setting-card"><span>Image model</span><strong>${escapeHtml(data.ai.image_model || '—')}</strong></div>
        <div class="setting-card"><span>Vectorize</span><strong class="${data.semantic_search.configured ? 'setting-ok' : 'setting-off'}">${data.semantic_search.configured ? 'Configurado' : 'Opcional / não ligado'}</strong></div>
        <div class="setting-card"><span>Embeddings</span><strong>${escapeHtml(data.semantic_search.embedding_model || '—')}</strong></div>
        <div class="setting-card"><span>Ficheiros</span><strong>PDF + EPUB sob pedido</strong></div>
      `;
    }
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', async () => {
    const section = tab.dataset.section;
    tabs.forEach((item) => item.classList.toggle('active', item === tab));
    views.forEach((view) => view.classList.toggle('hidden', view.id !== `section-${section}`));
    await refreshSection(section);
    if (section === 'create') $('book-form')?.querySelector('input')?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

document.querySelectorAll('[data-go]').forEach((button) => {
  button.addEventListener('click', () => goTo(button.dataset.go));
});

['book-context', 'mobile-book-context'].forEach((id) => {
  $(id)?.addEventListener('change', async (event) => {
    try { await selectBook(event.target.value); } catch (error) { setStatus(error.message, 'error'); }
  });
});

$('book-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const finish = setButtonBusy(button, true, 'A guardar…');
  try {
    const body = formObject(event.currentTarget);
    const data = await api('/api/admin/books', { method: 'POST', body: JSON.stringify(body) });
    await loadBooks();
    await selectBook(data.id, false);
    setInline('book-form-status', `Projeto criado: ${body.title}.`, 'success');
    goTo('dashboard');
  } catch (error) {
    setInline('book-form-status', error.message, 'error');
  } finally { finish(); }
});

$('create-and-research')?.addEventListener('click', async () => {
  $('book-form').requestSubmit();
  setTimeout(async () => {
    try {
      if (!state.currentBook) return;
      goTo('bible');
      const button = document.querySelector('[data-ai="research"]');
      if (button) await runAiButton(button);
    } catch (error) { setStatus(error.message, 'error'); }
  }, 350);
});

$('series-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const finish = setButtonBusy(button, true, 'A criar…');
  try {
    await api('/api/admin/series', { method: 'POST', body: JSON.stringify(formObject(event.currentTarget)) });
    event.currentTarget.reset();
    await loadSeries();
    setStatus('Série criada.', 'success');
  } catch (error) { setStatus(error.message, 'error'); }
  finally { finish(); }
});

document.querySelectorAll('.ai-action').forEach((button) => {
  button.addEventListener('click', () => runAiButton(button));
});

$('canon-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentBook) return setStatus('Selecione um livro primeiro.', 'error');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const finish = setButtonBusy(button, true, 'A guardar…');
  try {
    await api('/api/admin/canon', { method: 'POST', body: JSON.stringify({ book_id: state.currentBook.id, ...formObject(event.currentTarget) }) });
    await selectBook(state.currentBook.id, false);
    setStatus('Canon atualizado e versão guardada.', 'success');
  } catch (error) { setStatus(error.message, 'error'); }
  finally { finish(); }
});

$('registry-check')?.addEventListener('click', async () => {
  try { await registryCheck(); } catch (error) { setStatus(error.message, 'error'); }
});
$('registry-save')?.addEventListener('click', async () => {
  try { await registrySave(); } catch (error) { setStatus(error.message, 'error'); }
});

$('cover-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentBook) return setStatus('Selecione um livro primeiro.', 'error');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const finish = setButtonBusy(button, true, 'A gerar capa…');
  try {
    await api('/api/admin/cover', {
      method: 'POST',
      body: JSON.stringify({ book_id: state.currentBook.id, ...formObject(event.currentTarget) }),
    });
    event.currentTarget.reset();
    await loadCovers(state.currentBook.id);
    setStatus('Capa gerada com Workers AI.', 'success');
  } catch (error) { setStatus(error.message, 'error'); }
  finally { finish(); }
});

document.querySelectorAll('.status-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.status-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    setInline('publication-status-note', `Novo estado selecionado: ${button.dataset.status}.`, '');
  });
});
$('save-publication')?.addEventListener('click', async () => {
  try { await savePublication(); } catch (error) { setInline('publication-status-note', error.message, 'error'); }
});

$('logout')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.replace('/admin/login/');
});

(async () => {
  try {
    const user = await ensureAdmin();
    if (!user) return;
    await Promise.all([loadOverview(), loadBooks()]);
    setStatus(`Ligado como ${user.email}. Books Studio está pronto.`, 'success');
  } catch (error) {
    window.location.replace('/admin/login/');
  }
})();
