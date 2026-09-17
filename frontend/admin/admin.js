const tabs = [...document.querySelectorAll('.tab')];
const views = [...document.querySelectorAll('.view')];

const state = {
  user: null,
  books: [],
  currentBook: null,
  series: [],
  selectedChapter: null,
};

const $ = (id) => document.getElementById(id);

const STATUS_LABELS = {
  draft: 'Rascunho',
  research: 'Pesquisa',
  planning: 'Planeamento',
  writing: 'Escrita',
  review: 'Em revisão',
  approved: 'Aprovado',
  published: 'Publicado',
  archived: 'Arquivado',
};

const KEY_LABELS = {
  concept: 'Conceito',
  relevant_references: 'Referências relevantes',
  historical_context: 'Contexto histórico',
  geographic_context: 'Contexto geográfico',
  cultural_elements: 'Elementos culturais',
  possible_problems: 'Pontos a verificar',
  similar_ideas: 'Ideias semelhantes',
  important_terms: 'Termos importantes',
  unresolved_questions: 'Perguntas em aberto',
  verification_notes: 'Notas de verificação',
  identity: 'Identidade',
  story: 'História',
  characters: 'Personagens',
  relations: 'Relações',
  world: 'Mundo',
  timeline: 'Linha do tempo',
  style: 'Estilo',
  continuity: 'Continuidade',
  continuation: 'Continuação',
};

const NEXT_STEPS = {
  start: {
    label: 'Criar o primeiro livro',
    copy: 'Só precisas do título e da ideia. O resto pode ficar para depois.',
    button: 'Criar livro →',
    go: 'project',
  },
  research: {
    label: 'Pesquisar a ideia',
    copy: 'A IA prepara contexto, referências, dúvidas e pontos a verificar.',
    button: 'Pesquisar →',
    go: 'project',
    action: 'research',
  },
  story_bible: {
    label: 'Construir a história',
    copy: 'Transforma a ideia num mundo, personagens, relações e regras coerentes.',
    button: 'Criar Story Bible →',
    go: 'project',
    action: 'story_bible',
  },
  structure: {
    label: 'Montar a estrutura do livro',
    copy: 'Define folha de rosto, dedicatória, apresentação, prefácio, introdução, índice e capítulos.',
    button: 'Gerar estrutura →',
    go: 'writing',
    action: 'structure',
  },
  chapter: {
    label: 'Escrever o próximo capítulo',
    copy: 'Escolhe o capítulo planeado e gera a prosa com o título definido no plano.',
    button: 'Escrever capítulo →',
    go: 'writing',
    action: 'chapter',
  },
  quality: {
    label: 'Fazer a revisão',
    copy: 'Confirma continuidade, qualidade geral e problemas antes da publicação.',
    button: 'Abrir revisão →',
    go: 'quality',
  },
  production: {
    label: 'Preparar a publicação',
    copy: 'Trata da capa, ficheiros, SEO, preço e estado do livro.',
    button: 'Abrir publicação →',
    go: 'production',
  },
};

function money(value, currency = 'USD') {
  return Number(value || 0).toLocaleString('pt-PT', {
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

function labelFor(key) {
  return KEY_LABELS[key] || String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(value) {
  return STATUS_LABELS[value] || String(value || '—');
}

function statusClass(value) {
  return `status-${String(value || 'draft').toLowerCase()}`;
}

function setStatus(message, kind = '') {
  const node = $('global-status');
  if (!node) return;
  node.textContent = message || '';
  node.className = `global-status ${kind}`.trim();
  if (message) {
    clearTimeout(setStatus.timer);
    setStatus.timer = setTimeout(() => {
      if (node.textContent === message) node.textContent = '';
    }, 4200);
  }
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
    throw new Error(`O servidor devolveu uma resposta inválida (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(data.error || `O pedido falhou (${response.status}).`);
  }
  return data;
}

async function readAdminSession() {
  try {
    const data = await api('/api/auth/me');
    if (data.user?.role === 'admin') return data.user;
  } catch {
    // Retry in ensureAdmin.
  }
  return null;
}

async function ensureAdmin() {
  let user = await readAdminSession();
  if (!user) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    user = await readAdminSession();
  }
  if (!user) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    user = await readAdminSession();
  }
  if (!user) throw new Error('Não foi possível confirmar a sessão de administrador.');
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
  const options = ['<option value="">Seleccionar livro…</option>'];
  for (const book of state.books) {
    const selected = state.currentBook?.id === book.id ? ' selected' : '';
    options.push(
      `<option value="${escapeHtml(book.id)}"${selected}>${escapeHtml(book.title)} · ${escapeHtml(statusLabel(book.status))}</option>`,
    );
  }
  for (const id of ['book-context', 'mobile-book-context']) {
    const select = $(id);
    if (!select) continue;
    select.innerHTML = options.join('');
    if (state.currentBook) select.value = state.currentBook.id;
  }
}

function clearNewBookForm() {
  state.currentBook = null;
  state.selectedChapter = null;
  $('book-form')?.reset();
  const form = $('book-form');
  if (!form) return;
  form.elements.language.value = 'pt-PT';
  form.elements.author.value = 'Nexauren';
  form.elements.approx_chapter_count.value = '12';
  updateBookFormMode();
  renderBookOptions();
  renderDashboard();
  renderProject();
  renderWriting();
}

function updateBookFormMode() {
  const book = state.currentBook;
  if ($('project-page-title')) $('project-page-title').textContent = book ? 'Continuar projecto' : 'Criar o projecto';
  if ($('book-form-title')) $('book-form-title').textContent = book ? 'Editar livro' : 'Novo livro';
  if ($('book-save')) $('book-save').textContent = book ? 'Guardar alterações' : 'Guardar projecto';
  if ($('create-and-research')) $('create-and-research').textContent = book ? 'Guardar e pesquisar' : 'Guardar e pesquisar';
  if ($('project-stage')) {
    $('project-stage').textContent = book ? statusLabel(book.status) : 'Novo projecto';
    $('project-stage').className = `status-badge ${statusClass(book?.status)}`;
  }
  if (!$('book-form') || !book) return;
  const form = $('book-form');
  const fields = [
    'title', 'subtitle', 'author', 'language', 'genre', 'subgenre',
    'audience', 'age_rating', 'desired_size', 'approx_chapter_count',
    'style', 'pov', 'tone', 'pacing', 'premise',
  ];
  fields.forEach((field) => {
    const input = form.elements[field];
    if (!input) return;
    input.value = book[field] ?? (field === 'approx_chapter_count' ? 12 : '');
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
  updateBookFormMode();
}

async function selectBook(bookId, notify = true) {
  if (!bookId) {
    clearNewBookForm();
    return;
  }
  const data = await api(`/api/admin/books/${encodeURIComponent(bookId)}`);
  state.currentBook = data.book;
  state.selectedChapter = null;
  localStorage.setItem('nexauren_books_admin_book', bookId);
  renderBookOptions();
  updateBookFormMode();
  renderDashboard();
  renderProject();
  renderWriting();
  renderProduction().catch(() => {});
  renderQualityPlaceholders();
  if (notify) setStatus(`Livro activo: ${state.currentBook.title}`, 'success');
}

function renderBooksList() {
  const target = $('books-list');
  if (!target) return;
  if (!state.books.length) {
    target.innerHTML = '<div class="empty">Ainda não existem livros. Cria o primeiro projecto para começar.</div>';
    return;
  }
  target.innerHTML = state.books.map((book) => `
    <article class="book-row">
      <div>
        <strong>${escapeHtml(book.title)}</strong>
        <p>${escapeHtml(book.author || 'Nexauren')} · ${escapeHtml(book.genre || 'Sem género')} · ${escapeHtml(statusLabel(book.status))} · ${money(book.price_usd)}</p>
      </div>
      <div class="book-actions">
        <span class="status-badge ${statusClass(book.status)}">${escapeHtml(statusLabel(book.status))}</span>
        <button class="secondary-button" type="button" data-open-book="${escapeHtml(book.id)}">Abrir</button>
      </div>
    </article>
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

async function loadOverview() {
  const data = await api('/api/admin/overview');
  $('m-books').textContent = data.books.total;
  $('m-published').textContent = data.books.published;
  $('m-drafts').textContent = data.books.drafts;
  $('m-review').textContent = data.books.review;
  $('m-users').textContent = data.platform.users;
  $('m-revenue').textContent = money(data.platform.revenue);
  const ai = data.ai || {};
  $('ai-text-model').textContent = ai.text_model || '—';
  $('ai-image-model').textContent = ai.image_model || '—';
  $('ai-summary').textContent = ai.configured
    ? `IA pronta. ${Number(ai.jobs_last_24h || 0)} execução(ões) nas últimas 24 horas.`
    : 'A IA ainda não está configurada neste Worker.';
  $('ai-dot').className = `live-dot ${ai.configured ? 'ready' : 'offline'}`;
  $('ai-state').className = `ai-state ${ai.configured ? 'ready' : 'offline'}`;
  $('ai-state').querySelector('span').textContent = ai.configured ? 'IA pronta' : 'IA indisponível';
}

function renderObject(value, depth = 0) {
  if (value === null || value === undefined || value === '') return '<span class="muted-small">—</span>';
  if (typeof value !== 'object') return `<p>${escapeHtml(value)}</p>`;
  if (Array.isArray(value)) {
    if (!value.length) return '<p class="muted-small">Sem itens.</p>';
    return `<ul>${value.map((item) => `<li>${typeof item === 'object' ? renderObject(item, depth + 1) : escapeHtml(item)}</li>`).join('')}</ul>`;
  }
  return `<div class="ai-object ${depth > 0 ? 'nested' : ''}">${Object.entries(value).map(([key, item]) => `
    <div class="ai-block">
      <h3>${escapeHtml(labelFor(key))}</h3>
      ${renderObject(item, depth + 1)}
    </div>
  `).join('')}</div>`;
}

function renderCompactAI(targetId, payload, title = '') {
  const target = $(targetId);
  if (!target) return;
  const value = payload && typeof payload === 'object' ? payload : { resultado: payload };
  const arrays = Object.entries(value).filter(([, item]) => Array.isArray(item));
  const strings = Object.entries(value).filter(([, item]) => typeof item === 'string' && item.trim());
  const scalar = Object.entries(value).filter(([, item]) => typeof item !== 'object' && typeof item !== 'string');

  const boxes = [];
  if (arrays.length) {
    arrays.slice(0, 4).forEach(([key, items]) => {
      boxes.push(`<div class="ai-summary-box"><span>${escapeHtml(labelFor(key))}</span><strong>${items.length}</strong></div>`);
    });
  }
  scalar.slice(0, 2).forEach(([key, item]) => {
    boxes.push(`<div class="ai-summary-box"><span>${escapeHtml(labelFor(key))}</span><strong>${escapeHtml(item)}</strong></div>`);
  });

  const previews = [];
  strings.slice(0, 3).forEach(([key, item]) => {
    previews.push(`<div class="ai-preview-item"><strong>${escapeHtml(labelFor(key))}</strong><p>${escapeHtml(item)}</p></div>`);
  });

  target.innerHTML = `
    ${title ? `<div class="section-label">${escapeHtml(title)}</div>` : ''}
    ${boxes.length ? `<div class="ai-summary-grid">${boxes.join('')}</div>` : ''}
    ${previews.length ? `<div class="ai-preview">${previews.join('')}</div>` : ''}
    <details class="json-details"><summary>Ver detalhes técnicos</summary><pre class="ai-json">${escapeHtml(JSON.stringify(payload, null, 2))}</pre></details>
  `;
}

function getResearch(book) {
  const row = book?.research_notes?.[0];
  if (!row) return null;
  try { return JSON.parse(row.note); } catch { return { note: row.note }; }
}

function getStructure(book) {
  const outline = book?.story_bible?.outline;
  if (Array.isArray(outline)) {
    const special = outline.find((item) => item?.type === 'book_structure');
    const chapters = outline
      .filter((item) => item && item.type !== 'book_structure' && Number(item.number) > 0)
      .sort((a, b) => Number(a.number) - Number(b.number));
    return {
      front_matter: special?.front_matter || [],
      chapters,
      back_matter: special?.back_matter || [],
      generated: Boolean(special),
    };
  }
  if (outline && typeof outline === 'object') {
    return {
      front_matter: outline.front_matter || [],
      chapters: outline.chapters || [],
      back_matter: outline.back_matter || [],
      generated: true,
    };
  }
  return { front_matter: [], chapters: [], back_matter: [], generated: false };
}

function currentChapters(book) {
  return (book?.chapters || [])
    .filter((item) => Number(item.is_current) === 1)
    .sort((a, b) => Number(a.chapter_number) - Number(b.chapter_number));
}

function projectProgress(book) {
  if (!book) return { key: 'start', done: 0 };
  const research = Boolean(getResearch(book));
  const bible = Boolean(book.story_bible && Object.keys(book.story_bible).length);
  const structure = getStructure(book).generated;
  const chapters = currentChapters(book).length > 0;
  const quality = book.status === 'review' || book.status === 'approved' || book.status === 'published';
  const published = book.status === 'published';
  if (published) return { key: 'production', done: 6 };
  if (quality) return { key: 'production', done: 5 };
  if (chapters) return { key: 'quality', done: 4 };
  if (structure) return { key: 'chapter', done: 3 };
  if (bible) return { key: 'structure', done: 2 };
  if (research) return { key: 'story_bible', done: 1 };
  return { key: 'research', done: 0 };
}

function renderDashboard() {
  const book = state.currentBook;
  $('dashboard-book-title').textContent = book?.title || 'Ainda não seleccionaste um livro';
  $('dashboard-book-description').textContent = book
    ? `${book.author || 'Nexauren'} · ${book.genre || 'Sem género'} · ${statusLabel(book.status)}`
    : 'Cria um projecto para começar.';
  $('book-stage').textContent = book ? statusLabel(book.status) : 'Sem livro';
  $('book-stage').className = `status-badge ${statusClass(book?.status)}`;
  const tags = [];
  if (book?.language) tags.push(book.language === 'pt-PT' ? 'Português (Portugal)' : book.language);
  if (book?.age_rating) tags.push(book.age_rating);
  if (book?.audience) tags.push(book.audience);
  if (book?.subgenre) tags.push(book.subgenre);
  $('dashboard-book-tags').innerHTML = tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

  const progress = projectProgress(book);
  const step = NEXT_STEPS[progress.key] || NEXT_STEPS.start;
  $('dashboard-next-title').textContent = step.label;
  $('dashboard-next-copy').textContent = step.copy;
  const nextButton = $('dashboard-next');
  nextButton.textContent = step.button;
  nextButton.dataset.go = step.go || 'project';
  nextButton.dataset.action = step.action || '';
  nextButton.dataset.newBook = progress.key === 'start' ? 'true' : 'false';

  const progressLabel = $('progress-label');
  progressLabel.textContent = `${progress.done} de 6 passos concluídos`;
  $('progress-fill').style.width = `${Math.round((progress.done / 6) * 100)}%`;

  const structure = getStructure(book);
  const chapters = currentChapters(book);
  const steps = [...document.querySelectorAll('#workflow-steps button')];
  steps.forEach((button, index) => button.classList.toggle('done', index < progress.done));
  if (steps[5]) steps[5].classList.toggle('done', book?.status === 'published');
}

function renderProject() {
  const book = state.currentBook;
  updateBookFormMode();
  const research = getResearch(book);
  const bible = book?.story_bible || null;
  if (research) renderCompactAI('research-view', research, 'Pesquisa');
  else $('research-view').innerHTML = '<div class="empty-state">Ainda não há pesquisa. Podes fazê-la quando o projecto estiver guardado.</div>';
  if (bible) renderStoryBibleSummary(bible);
  else $('bible-state').innerHTML = '<div class="empty-state">Ainda não existe uma Story Bible.</div>';

  const canon = book?.canonical_facts || [];
  $('canon-list').innerHTML = canon.length ? canon.map((item) => `
    <div class="canon-row">
      <div><strong>${escapeHtml(item.fact_key)}</strong><span>${escapeHtml(item.fact_value)} · v${escapeHtml(item.version)}</span></div>
      <span class="${Number(item.immutable) ? 'locked' : ''}">${Number(item.immutable) ? 'Bloqueado' : 'Rascunho'}</span>
    </div>
  `).join('') : '<div class="empty">Ainda não existem factos canónicos.</div>';

  const characters = bible?.characters || [];
  $('characters-list').innerHTML = characters.length ? characters.slice(0, 12).map((item) => `
    <article class="entity-card"><strong>${escapeHtml(item.name || item.id || 'Sem nome')}</strong>${item.age !== undefined ? `<span>Idade: ${escapeHtml(item.age)}</span>` : ''}${item.role ? `<span>Função: ${escapeHtml(item.role)}</span>` : ''}</article>
  `).join('') : '<div class="empty">A Story Bible ainda não tem personagens estruturados.</div>';

  $('world-view').innerHTML = bible?.world ? renderObject(bible.world) : '<div class="empty">Ainda não existe um mundo estruturado.</div>';
  const timeline = bible?.timeline || [];
  $('timeline-view').innerHTML = timeline.length ? timeline.slice(0, 15).map((item) => `
    <article class="timeline-item"><time>${escapeHtml(item.date || item.when || item.period || 'EVENTO')}</time><div><strong>${escapeHtml(item.title || item.name || 'Evento')}</strong><p>${escapeHtml(item.description || item.summary || '')}</p></div></article>
  `).join('') : '<div class="empty">Ainda não existem eventos.</div>';
}

function renderStoryBibleSummary(bible) {
  const characters = Array.isArray(bible.characters) ? bible.characters.length : 0;
  const relations = Array.isArray(bible.relations) ? bible.relations.length : 0;
  const timeline = Array.isArray(bible.timeline) ? bible.timeline.length : 0;
  const world = bible.world && typeof bible.world === 'object'
    ? Object.keys(bible.world).length
    : 0;
  $('bible-state').innerHTML = `
    <div class="ai-summary-grid">
      <div class="ai-summary-box"><span>Personagens</span><strong>${characters}</strong></div>
      <div class="ai-summary-box"><span>Relações</span><strong>${relations}</strong></div>
      <div class="ai-summary-box"><span>Eventos</span><strong>${timeline}</strong></div>
      <div class="ai-summary-box"><span>Áreas do mundo</span><strong>${world}</strong></div>
    </div>
    <div class="ai-preview">
      <div class="ai-preview-item"><strong>${escapeHtml(bible.story?.premise || bible.story?.summary || 'História estruturada')}</strong><p>Story Bible guardada e pronta para a fase de estrutura.</p></div>
    </div>
    <details class="json-details"><summary>Ver dados técnicos da Story Bible</summary><pre class="ai-json">${escapeHtml(JSON.stringify(bible, null, 2))}</pre></details>
  `;
}

function structurePart(label, items, emptyText) {
  return `
    <section class="structure-section">
      <div class="structure-section-head"><span class="section-label">${escapeHtml(label)}</span><span>${items.length} elemento(s)</span></div>
      ${items.length ? items.map((item, index) => `
        <article class="structure-item">
          <span class="structure-no">${item.number ? escapeHtml(item.number) : String(index + 1).padStart(2, '0')}</span>
          <div><strong>${escapeHtml(item.title || item.name || 'Sem título')}</strong><p>${escapeHtml(item.purpose || item.objective || item.description || item.content || '')}</p></div>
          <span class="structure-mark">${item.included === false ? 'Opcional' : 'Incluído'}</span>
        </article>
      `).join('') : `<div class="empty">${escapeHtml(emptyText)}</div>`}
    </section>
  `;
}

function renderStructure() {
  const target = $('structure-view');
  if (!target) return;
  const structure = getStructure(state.currentBook);
  if (!structure.generated) {
    target.innerHTML = '<div class="empty-state large-empty">A estrutura vem antes da escrita. Gera-a para criar folha de rosto, dedicatória, apresentação, prefácio, introdução, índice, capítulos e elementos finais.</div>';
    return;
  }
  const toc = structure.chapters.map((chapter) => `
    <div class="toc-row"><span>Capítulo ${escapeHtml(chapter.number)}</span><strong>${escapeHtml(chapter.title || 'Sem título')}</strong></div>
  `).join('');
  target.innerHTML = `
    ${structurePart('Antes da história', structure.front_matter, 'Nenhum elemento inicial definido.')}
    <section class="structure-section">
      <div class="structure-section-head"><span class="section-label">ÍNDICE</span><span>${structure.chapters.length} capítulos</span></div>
      <div class="toc-list">${toc || '<div class="empty-state">Ainda não existem capítulos no índice.</div>'}</div>
    </section>
    ${structurePart('Capítulos', structure.chapters, 'Nenhum capítulo planeado.')}
    ${structurePart('Depois da história', structure.back_matter, 'Nenhum elemento final definido.')}
  `;

  const selector = $('chapter-number');
  if (selector) {
    const current = selector.value;
    selector.innerHTML = structure.chapters.length
      ? structure.chapters.map((chapter) => `<option value="${escapeHtml(chapter.number)}">${escapeHtml(chapter.number)} · ${escapeHtml(chapter.title || 'Sem título')}</option>`).join('')
      : '<option value="1">1 · Capítulo 1</option>';
    selector.value = current && [...selector.options].some((option) => option.value === current)
      ? current
      : String(structure.chapters[0]?.number || 1);
  }
  updateChapterPlanPreview();
}

function nextChapterNumber() {
  const existing = currentChapters(state.currentBook).map((item) => Number(item.chapter_number));
  const planned = getStructure(state.currentBook).chapters.map((item) => Number(item.number)).filter(Boolean);
  for (const number of planned) if (!existing.includes(number)) return number;
  return Math.max(0, ...existing, ...planned) + 1 || 1;
}

function updateChapterPlanPreview() {
  const selector = $('chapter-number');
  const preview = $('chapter-plan-preview');
  const pill = $('chapter-plan-pill');
  if (!selector || !preview || !pill) return;
  const chapterNumber = Number(selector.value || 1);
  const planned = getStructure(state.currentBook).chapters.find((item) => Number(item.number) === chapterNumber);
  pill.textContent = planned ? `Capítulo ${chapterNumber}` : 'Sem plano';
  preview.innerHTML = planned
    ? `<strong>${escapeHtml(planned.title || `Capítulo ${chapterNumber}`)}</strong><span>${escapeHtml(planned.objective || planned.description || 'Sem objectivo definido.')}</span>`
    : '<strong>Sem plano para este capítulo.</strong><span>Gera primeiro a estrutura editorial.</span>';
}

function renderChapters() {
  const chapters = currentChapters(state.currentBook);
  $('chapter-count').textContent = chapters.length;
  const target = $('chapters-list');
  if (!chapters.length) {
    target.innerHTML = '<div class="empty-state">Ainda não há capítulos escritos.</div>';
  } else {
    target.innerHTML = chapters.map((chapter) => `
      <button class="chapter-item ${state.selectedChapter?.id === chapter.id ? 'active' : ''}" type="button" data-chapter-id="${escapeHtml(chapter.id)}">
        <span class="chapter-item-number">${escapeHtml(chapter.chapter_number)}</span>
        <div><strong>${escapeHtml(chapter.title || 'Sem título')}</strong><small>v${escapeHtml(chapter.version_number)} · ${Number(chapter.content || '').length.toLocaleString('pt-PT')} caracteres</small></div>
      </button>
    `).join('');
  }
  target.querySelectorAll('[data-chapter-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedChapter = chapters.find((item) => item.id === button.dataset.chapterId) || null;
      $('chapter-number').value = state.selectedChapter?.chapter_number || 1;
      updateChapterPlanPreview();
      renderChapterReader();
      renderChapters();
    });
  });
  if (!state.selectedChapter && chapters.length) state.selectedChapter = chapters[0];
  if (state.selectedChapter) {
    state.selectedChapter = chapters.find((item) => item.id === state.selectedChapter.id) || chapters[0] || null;
    $('chapter-number').value = state.selectedChapter?.chapter_number || $('chapter-number').value || 1;
  }
  updateChapterPlanPreview();
  renderChapterReader();
}

function renderChapterReader() {
  const chapter = state.selectedChapter;
  if (!chapter) {
    $('selected-chapter-title').textContent = 'Nenhum capítulo seleccionado';
    $('selected-chapter-meta').textContent = '—';
    $('selected-chapter-content').className = 'chapter-content empty-state';
    $('selected-chapter-content').textContent = 'Quando tiveres texto, ele aparece aqui com uma leitura limpa.';
    return;
  }
  $('selected-chapter-title').textContent = `Capítulo ${chapter.chapter_number} · ${chapter.title || 'Sem título'}`;
  $('selected-chapter-meta').textContent = `versão ${chapter.version_number} · ${Number(chapter.content || '').length.toLocaleString('pt-PT')} caracteres`;
  $('selected-chapter-content').className = 'chapter-content';
  $('selected-chapter-content').textContent = chapter.content || 'Sem conteúdo.';
}

function renderWriting() {
  const book = state.currentBook;
  $('writing-stage').textContent = book ? statusLabel(book.status) : 'Sem livro';
  $('writing-stage').className = `status-badge ${statusClass(book?.status)}`;
  renderStructure();
  renderChapters();
}

function renderQualityPlaceholders() {
  for (const id of ['continuity-view', 'qa-view', 'originality-view']) {
    const node = $(id);
    if (!node?.dataset.hasResult) node.innerHTML = '<div class="empty-state">Ainda não existe um relatório.</div>';
  }
}

async function renderProduction() {
  const book = state.currentBook;
  if (!book) {
    $('files-view').innerHTML = '<div class="empty-state">Selecciona um livro primeiro.</div>';
    $('covers-view').innerHTML = '';
    $('publication-status').innerHTML = '<strong>Sem livro</strong><p>Escolhe um livro antes de preparar a publicação.</p>';
    return;
  }
  $('publication-price').value = Number(book.price_usd || 0).toFixed(2);
  $('sales-price').textContent = money(book.price_usd, book.currency || 'USD');
  $('publication-status').innerHTML = `<span class="eyebrow">ESTADO</span><strong>${escapeHtml(statusLabel(book.status))}</strong><p>${book.status === 'published' ? 'O livro está publicado.' : 'Ainda não está publicado.'}</p>`;
  document.querySelectorAll('.status-button').forEach((button) => button.classList.toggle('active', button.dataset.status === book.status));
  loadFiles(book.slug).catch((error) => setInline('publication-status-note', error.message, 'error'));
  loadSales(book.id).catch((error) => setInline('publication-status-note', error.message, 'error'));
  loadCovers(book.id).catch((error) => setStatus(error.message, 'error'));
}

async function loadFiles(slug) {
  const data = await api(`/api/admin/files?book_id=${encodeURIComponent(state.currentBook.id)}`);
  const target = $('files-view');
  if (!target) return;
  const published = state.currentBook.status === 'published';
  target.innerHTML = `
    <strong>${escapeHtml(data.chapters || 0)} capítulos actuais</strong>
    <span class="file-note">PDF e EPUB são gerados sob pedido a partir do manuscrito.</span>
    ${published ? `<div class="file-links"><a href="/api/books/${encodeURIComponent(slug)}/download?format=pdf">Abrir PDF</a><a href="/api/books/${encodeURIComponent(slug)}/download?format=epub">Abrir EPUB</a></div>` : '<span class="file-note">Publica o livro para activar os downloads.</span>'}
  `;
}

async function loadSales(bookId) {
  const data = await api(`/api/admin/sales?book_id=${encodeURIComponent(bookId)}`);
  $('sales-orders').textContent = data.orders;
  $('sales-revenue').textContent = money(data.revenue, data.currency || 'USD');
}

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
      <strong>${Number(cover.selected) ? 'Capa seleccionada' : 'Capa gerada'}</strong>
      <span>${escapeHtml(cover.model || '')}</span>
      ${Number(cover.selected) ? '' : `<button class="secondary-button choose-cover" data-cover-id="${escapeHtml(cover.id)}" type="button">Escolher</button>`}
    </article>
  `).join('');

  const previews = await Promise.all(data.items.map(async (item) => {
    try {
      const raw = await api(`/api/admin/covers/preview?cover_id=${encodeURIComponent(item.id)}`);
      return { id: item.id, dataUri: raw.data_uri };
    } catch {
      return null;
    }
  }));
  previews.filter(Boolean).forEach((item) => {
    const node = target.querySelector(`[data-cover-id="${CSS.escape(item.id)}"]`);
    if (node) node.style.backgroundImage = `url('${item.dataUri}')`;
  });

  target.querySelectorAll('.choose-cover').forEach((button) => {
    button.addEventListener('click', async () => {
      const finish = setButtonBusy(button, true, 'A escolher…');
      try {
        await api('/api/admin/cover/select', { method: 'POST', body: JSON.stringify({ cover_id: button.dataset.coverId }) });
        await selectBook(state.currentBook.id, false);
        setStatus('Capa seleccionada.', 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        finish();
      }
    });
  });
}

async function loadSeries() {
  const data = await api('/api/admin/series');
  state.series = data.items || [];
  $('series-list').innerHTML = state.series.length ? state.series.map((series) => `
    <article class="book-row"><div><strong>${escapeHtml(series.name)}</strong><p>${escapeHtml(series.book_count)} livro(s) · ${escapeHtml(series.slug)}</p></div></article>
  `).join('') : '<div class="empty">Nenhuma série criada.</div>';
}

async function loadSettings() {
  try {
    const data = await api('/api/admin/settings');
    $('settings-view').innerHTML = `
      <div class="system-card"><span>IA</span><strong>${data.ai.configured ? 'Ligada' : 'Desligada'}</strong><small>Workers AI</small></div>
      <div class="system-card"><span>Pesquisa semântica</span><strong>${data.semantic_search.configured ? 'Vectorize' : 'Local'}</strong><small>Motor de pesquisa</small></div>
      <div class="system-card"><span>Ficheiros</span><strong>PDF + EPUB</strong><small>Geração sob pedido</small></div>
      <div class="technical-details-box"><strong>Detalhes técnicos</strong><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></div>
    `;
  } catch (error) {
    $('settings-view').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function aiAction(action, extra = {}) {
  if (!state.currentBook) throw new Error('Selecciona um livro primeiro.');
  return api('/api/admin/ai', {
    method: 'POST',
    body: JSON.stringify({ action, book_id: state.currentBook.id, ...extra }),
  });
}

async function runAiButton(button) {
  const action = button.dataset.ai;
  const finish = setButtonBusy(button, true, 'A trabalhar…');
  setStatus('A preparar o próximo passo…', 'busy');
  try {
    const extra = {};
    if (action === 'chapter') {
      const structure = getStructure(state.currentBook);
      const chapterNumber = Math.max(1, Number($('chapter-number').value || nextChapterNumber()));
      const planned = structure.chapters.find((item) => Number(item.number) === chapterNumber);
      extra.chapter_number = chapterNumber;
      extra.instructions = $('chapter-instructions').value.trim();
      extra.language = 'pt-PT';
      if (planned?.title) {
        extra.instructions = `${extra.instructions}\n\nTítulo obrigatório: ${planned.title}`.trim();
      }
    }
    const data = await aiAction(action, extra);

    if (action === 'research') {
      renderCompactAI('research-view', data.report, 'Pesquisa da ideia');
      await selectBook(state.currentBook.id, false);
      setStatus('Pesquisa concluída e guardada.', 'success');
      goTo('project');
      return;
    }
    if (action === 'story_bible') {
      await selectBook(state.currentBook.id, false);
      setStatus('Story Bible criada e guardada.', 'success');
      goTo('project');
      return;
    }
    if (action === 'structure') {
      await selectBook(state.currentBook.id, false);
      setStatus('Estrutura criada: pré-texto, índice, capítulos e elementos finais.', 'success');
      goTo('writing');
      return;
    }
    if (action === 'chapter') {
      await selectBook(state.currentBook.id, false);
      const chapter = currentChapters(state.currentBook).find((item) => Number(item.chapter_number) === Number(extra.chapter_number));
      state.selectedChapter = chapter || null;
      $('chapter-number').value = extra.chapter_number;
      renderWriting();
      if (chapter) {
        state.selectedChapter = chapter;
        renderChapterReader();
      }
      setStatus(`Capítulo ${extra.chapter_number} gerado e guardado.`, 'success');
      goTo('writing');
      return;
    }
    if (action === 'story_state') {
      await selectBook(state.currentBook.id, false);
      setStatus('Estado da história actualizado.', 'success');
      return;
    }
    if (action === 'continuity') {
      renderCompactAI('continuity-view', data.report, 'Continuidade');
      $('continuity-view').dataset.hasResult = '1';
      goTo('quality');
      setStatus('Continuidade verificada.', 'success');
      return;
    }
    if (action === 'qa') {
      renderCompactAI('qa-view', data.qa, 'Revisão');
      $('qa-view').dataset.hasResult = '1';
      goTo('quality');
      setStatus('Revisão concluída.', 'success');
      return;
    }
    if (action === 'originality') {
      renderCompactAI('originality-view', data.originality, 'Originalidade');
      $('originality-view').dataset.hasResult = '1';
      goTo('quality');
      setStatus('Verificação de originalidade concluída.', 'success');
      return;
    }
    if (action === 'seo') {
      renderCompactAI('seo-view', data.seo, 'SEO');
      setStatus('SEO gerado e guardado.', 'success');
      goTo('production');
      return;
    }
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    finish();
  }
}

function startNewBook() {
  clearNewBookForm();
  goTo('project');
}

document.querySelectorAll('.ai-action').forEach((button) => {
  button.addEventListener('click', () => runAiButton(button));
});

document.querySelectorAll('[data-go]').forEach((button) => {
  if (button.id === 'dashboard-next') return;
  button.addEventListener('click', () => {
    const section = button.dataset.go;
    if (button.dataset.newBook === 'true') {
      startNewBook();
      return;
    }
    goTo(section);
  });
});

$('dashboard-next')?.addEventListener('click', async () => {
  const action = $('dashboard-next').dataset.action;
  if ($('dashboard-next').dataset.newBook === 'true' || action === 'start') {
    startNewBook();
    return;
  }
  const section = $('dashboard-next').dataset.go || 'project';
  goTo(section);
  if (action && ['research', 'story_bible', 'structure'].includes(action)) {
    setTimeout(() => document.querySelector(`.ai-action[data-ai="${action}"]`)?.click(), 180);
  }
  if (action === 'chapter') {
    setTimeout(() => {
      const selector = $('chapter-number');
      selector.value = String(nextChapterNumber());
      updateChapterPlanPreview();
      $('chapter-instructions').focus();
    }, 180);
  }
});

$('book-context')?.addEventListener('change', async (event) => {
  try { await selectBook(event.target.value); } catch (error) { setStatus(error.message, 'error'); }
});
$('mobile-book-context')?.addEventListener('change', async (event) => {
  try { await selectBook(event.target.value); } catch (error) { setStatus(error.message, 'error'); }
});

$('chapter-number')?.addEventListener('change', updateChapterPlanPreview);

$('book-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('book-save');
  const finish = setButtonBusy(button, true, state.currentBook ? 'A guardar…' : 'A criar…');
  try {
    const body = formObject(form);
    if (!body.title?.trim() || !body.premise?.trim()) {
      throw new Error('Indica pelo menos o título e a ideia do livro.');
    }
    body.language = 'pt-PT';
    if (state.currentBook) {
      const data = await api(`/api/admin/books/${encodeURIComponent(state.currentBook.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      state.currentBook = data.book;
      await loadBooks();
      await selectBook(state.currentBook.id, false);
      setInline('book-form-status', 'Alterações guardadas.', 'success');
    } else {
      const data = await api('/api/admin/books', { method: 'POST', body: JSON.stringify(body) });
      await loadBooks();
      await selectBook(data.id, false);
      setInline('book-form-status', 'Projecto criado.', 'success');
      setStatus('Projecto criado. Agora podes fazer a pesquisa.', 'success');
    }
  } catch (error) {
    setInline('book-form-status', error.message, 'error');
  } finally {
    finish();
  }
});

$('create-and-research')?.addEventListener('click', async () => {
  const form = $('book-form');
  if (!form.reportValidity()) return;
  const button = $('create-and-research');
  const finish = setButtonBusy(button, true, 'A preparar…');
  try {
    const body = formObject(form);
    if (!body.title?.trim() || !body.premise?.trim()) throw new Error('Indica o título e a ideia do livro.');
    body.language = 'pt-PT';
    if (!state.currentBook) {
      const data = await api('/api/admin/books', { method: 'POST', body: JSON.stringify(body) });
      await loadBooks();
      await selectBook(data.id, false);
    } else {
      const data = await api(`/api/admin/books/${encodeURIComponent(state.currentBook.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      state.currentBook = data.book;
      await loadBooks();
      await selectBook(state.currentBook.id, false);
    }
    await runAiButton(document.querySelector('.ai-action[data-ai="research"]'));
  } catch (error) {
    setInline('book-form-status', error.message, 'error');
  } finally {
    finish();
  }
});

$('series-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/admin/series', { method: 'POST', body: JSON.stringify(formObject(event.currentTarget)) });
    event.currentTarget.reset();
    await loadSeries();
    setStatus('Série criada.', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

$('canon-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentBook) return setStatus('Selecciona um livro primeiro.', 'error');
  const body = formObject(event.currentTarget);
  body.book_id = state.currentBook.id;
  body.immutable = Boolean(body.immutable);
  try {
    await api('/api/admin/canon', { method: 'POST', body: JSON.stringify(body) });
    await selectBook(state.currentBook.id, false);
    event.currentTarget.reset();
    setStatus('Facto guardado.', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

$('registry-check')?.addEventListener('click', async () => {
  if (!state.currentBook) return setStatus('Selecciona um livro primeiro.', 'error');
  const name = $('registry-name').value.trim();
  if (!name) return setStatus('Indica o nome da entidade.', 'error');
  let metadata = {};
  try { metadata = JSON.parse($('registry-meta').value || '{}'); } catch { return setStatus('As notas têm de ser JSON válido.', 'error'); }
  try {
    const data = await api('/api/admin/registry/check', {
      method: 'POST',
      body: JSON.stringify({ book_id: state.currentBook.id, entity_type: $('registry-type').value, canonical_name: name, metadata }),
    });
    $('registry-result').innerHTML = data.candidates?.length
      ? `<div class="notice"><strong>Possíveis semelhanças</strong>${data.candidates.map((item) => `<p>${escapeHtml(item.canonical_name)} · ${Math.round(item.score * 100)}%</p>`).join('')}</div>`
      : '<div class="notice">Nenhuma semelhança relevante encontrada no registo local.</div>';
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

$('registry-save')?.addEventListener('click', async () => {
  if (!state.currentBook) return setStatus('Selecciona um livro primeiro.', 'error');
  const name = $('registry-name').value.trim();
  if (!name) return setStatus('Indica o nome da entidade.', 'error');
  let metadata = {};
  try { metadata = JSON.parse($('registry-meta').value || '{}'); } catch { return setStatus('As notas têm de ser JSON válido.', 'error'); }
  try {
    await api('/api/admin/registry', { method: 'POST', body: JSON.stringify({ book_id: state.currentBook.id, entity_type: $('registry-type').value, canonical_name: name, metadata }) });
    $('registry-name').value = '';
    $('registry-meta').value = '';
    setStatus('Entidade guardada.', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

$('cover-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentBook) return setStatus('Selecciona um livro primeiro.', 'error');
  const button = event.currentTarget.querySelector('button');
  const finish = setButtonBusy(button, true, 'A gerar capa…');
  try {
    const body = formObject(event.currentTarget);
    const data = await api('/api/admin/cover', { method: 'POST', body: JSON.stringify({ book_id: state.currentBook.id, prompt: body.prompt }) });
    await loadCovers(state.currentBook.id);
    setStatus(`Capa gerada.`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    finish();
  }
});

$('save-publication')?.addEventListener('click', async () => {
  if (!state.currentBook) return setStatus('Selecciona um livro primeiro.', 'error');
  const activeStatus = document.querySelector('.status-button.active');
  const status = activeStatus?.dataset.status || state.currentBook.status;
  try {
    const data = await api(`/api/admin/books/${encodeURIComponent(state.currentBook.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, price_usd: $('publication-price').value }),
    });
    state.currentBook = data.book;
    await loadBooks();
    await selectBook(state.currentBook.id, false);
    setStatus('Estado de publicação guardado.', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

document.querySelectorAll('.status-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.status-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

tabs.forEach((tab) => {
  tab.addEventListener('click', async () => {
    const section = tab.dataset.section;
    tabs.forEach((item) => item.classList.toggle('active', item === tab));
    views.forEach((view) => view.classList.toggle('hidden', view.id !== `section-${section}`));
    if (section === 'dashboard') renderDashboard();
    if (section === 'books') { renderBooksList(); await loadBooks(); }
    if (section === 'project') renderProject();
    if (section === 'writing') renderWriting();
    if (section === 'quality') renderQualityPlaceholders();
    if (section === 'production') await renderProduction();
    if (section === 'series') await loadSeries();
    if (section === 'settings') await loadSettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

$('logout')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  window.location.replace('/admin/login/');
});

(async () => {
  try {
    const user = await ensureAdmin();
    await Promise.all([loadOverview(), loadBooks()]);
    renderDashboard();
    renderProject();
    renderWriting();
    renderQualityPlaceholders();
    setStatus(`Admin ligado: ${user.email}`, 'success');
  } catch (error) {
    $('admin-user').textContent = 'Sessão indisponível';
    setStatus(error.message, 'error');
  }
})();