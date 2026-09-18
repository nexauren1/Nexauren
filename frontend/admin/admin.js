const state = {
  user: null,
  books: [],
  currentBook: null,
  selectedChapter: null,
  busy: false,
};

const $ = (id) => document.getElementById(id);
const navItems = [...document.querySelectorAll('.nav-item')];
const views = [...document.querySelectorAll('.view')];

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

function statusLabel(value) {
  return STATUS_LABELS[value] || String(value || '—');
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

function safeText(value) {
  return String(value ?? '').trim();
}

function countText(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return n.toLocaleString('pt-PT');
}

function setGlobal(message, kind = '') {
  const node = $('global-status');
  if (!node) return;
  node.textContent = message || '';
  node.className = 'global-status' + (kind ? ' ' + kind : '');
  clearTimeout(setGlobal.timer);
  if (message) {
    setGlobal.timer = setTimeout(() => {
      node.textContent = '';
      node.className = 'global-status';
    }, 5000);
  }
}

function setInline(id, message, kind = '') {
  const node = $(id);
  if (!node) return;
  node.textContent = message || '';
  node.className = 'inline-status' + (kind ? ' ' + kind : '');
}

function cleanApiError(value) {
  const message = String(value || '').trim();

  if (/unterminated string in json|json\.parse|unexpected token|invalid json|json mode/i.test(message)) {
    return 'A IA não conseguiu concluir esta etapa correctamente. Tenta novamente.';
  }

  return message || 'O pedido falhou.';
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

  const body = await response.text();
  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error('O servidor devolveu uma resposta inválida.');
  }

  if (!response.ok) {
    throw new Error(cleanApiError(data.error));
  }
  return data;
}

async function ensureAdmin() {
  const data = await api('/api/auth/me');
  if (data.user?.role !== 'admin') {
    window.location.replace('/admin/login/');
    return null;
  }
  state.user = data.user;
  $('admin-user').textContent = data.user.email || 'Administrador';
  return data.user;
}

function setNav(section) {
  navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.section === section);
  });
  views.forEach((view) => {
    view.classList.toggle('hidden', view.id !== 'section-' + section);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goTo(section) {
  const item = navItems.find((nav) => nav.dataset.section === section);
  if (item) item.click();
}

function bookStructure(book = state.currentBook) {
  const raw = book?.story_bible?.outline;
  if (Array.isArray(raw)) {
    return {
      front_matter: [],
      chapters: raw.filter((item) => item && Number(item.number) > 0)
        .sort((a, b) => Number(a.number) - Number(b.number)),
      back_matter: [],
    };
  }
  if (raw && typeof raw === 'object') {
    return {
      front_matter: Array.isArray(raw.front_matter) ? raw.front_matter : [],
      chapters: Array.isArray(raw.chapters) ? raw.chapters : [],
      back_matter: Array.isArray(raw.back_matter) ? raw.back_matter : [],
    };
  }
  return { front_matter: [], chapters: [], back_matter: [] };
}

function currentChapters(book = state.currentBook) {
  return (book?.chapters || [])
    .filter((item) => Number(item.is_current) === 1)
    .sort((a, b) => Number(a.chapter_number) - Number(b.chapter_number));
}

function hasResearch(book = state.currentBook) {
  const row = book?.research_notes?.[0];
  return Boolean(row);
}

function hasBible(book = state.currentBook) {
  return Boolean(book?.story_bible && Object.keys(book.story_bible).length);
}

function hasApprovedBible(book = state.currentBook) {
  return Boolean(book?.story_bible?.canon_locked);
}

function hasStructure(book = state.currentBook) {
  return bookStructure(book).chapters.length > 0;
}

function progress(book = state.currentBook) {
  if (!book) return 0;
  if (book.status === 'published') return 4;
  if (book.status === 'review') return 3;
  if (currentChapters(book).length) return 2;
  if (hasStructure(book)) return 2;
  if (hasBible(book)) return 1;
  return 0;
}

function renderBookOptions() {
  const options = ['<option value="">Seleccionar livro…</option>'];
  for (const book of state.books) {
    const selected = state.currentBook?.id === book.id ? ' selected' : '';
    options.push(
      '<option value="' + escapeHtml(book.id) + '"' + selected + '>'
      + escapeHtml(book.title || 'Sem título')
      + ' · ' + escapeHtml(statusLabel(book.status))
      + '</option>',
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
  state.books = Array.isArray(data.items) ? data.items : [];
  renderBookOptions();

  if (state.currentBook) {
    const same = state.books.find((book) => book.id === state.currentBook.id);
    if (same) return selectBook(same.id, false);
  }

  const saved = localStorage.getItem('nexauren_books_admin_book');
  const preferred = state.books.find((book) => book.id === saved);
  if (preferred) return selectBook(preferred.id, false);

  if (state.books[0]) return selectBook(state.books[0].id, false);
  renderAll();
}

async function selectBook(bookId, notify = false) {
  if (!bookId) {
    state.currentBook = null;
    state.selectedChapter = null;
    renderAll();
    return;
  }

  const data = await api('/api/admin/books/' + encodeURIComponent(bookId));
  state.currentBook = data.book || null;
  state.selectedChapter = currentChapters(state.currentBook)[0] || null;
  localStorage.setItem('nexauren_books_admin_book', bookId);
  renderAll();
  if (notify) setGlobal('Livro actual: ' + (state.currentBook?.title || '—'), 'success');
}

function renderDashboard() {
  const book = state.currentBook;
  $('dashboard-book-title').textContent = book?.title || 'Ainda não tens um livro seleccionado';
  $('dashboard-book-description').textContent = book
    ? (book.premise || book.description || 'Este livro está pronto para continuar.')
    : 'Cria o teu primeiro livro para começar.';
  $('book-stage').textContent = book ? statusLabel(book.status) : 'Sem livro';

  const tags = [];
  if (book?.language) tags.push('Português (Portugal)');
  if (book?.genre) tags.push(book.genre);
  if (book?.age_rating) tags.push(book.age_rating);
  $('dashboard-book-tags').innerHTML = tags
    .map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>')
    .join('');

  const p = progress(book);
  $('progress-label').textContent = p + ' de 4 passos';
  $('progress-fill').style.width = Math.round((p / 4) * 100) + '%';

  const next = p === 0
    ? ['Criar o primeiro livro', 'Define a ficha básica e os dados de publicação.', 'Criar livro', 'prepare']
    : p === 1 && !hasApprovedBible(book)
      ? ['Aprovar Bíblia Oficial', 'Revê a Bíblia criada pela IA e bloqueia o canon antes da escrita.', 'Aprovar Bíblia', 'prepare']
      : p === 1
        ? ['Criar estrutura do livro', 'A Bíblia está oficial. Agora cria o índice e os capítulos planeados.', 'Criar estrutura', 'prepare']
        : p === 2
          ? ['Continuar a escrita', 'Escreve os capítulos seguindo a Bíblia Oficial.', 'Escrever', 'writing']
          : p === 3
            ? ['Preparar publicação', 'Confirma a revisão e trata da capa e dos ficheiros.', 'Publicar', 'publish']
            : ['Livro publicado', 'O livro já passou pelo percurso principal.', 'Abrir publicação', 'publish'];

  $('next-title').textContent = next[0];
  $('next-copy').textContent = next[1];
  $('next-button').textContent = next[2];
  $('next-button').dataset.nextSection = next[3];
  $('next-button').dataset.nextAction = p === 0
    ? 'new'
    : p === 1
      ? (hasApprovedBible(book) ? 'structure' : 'approve')
      : '';

  const flow = [...document.querySelectorAll('#dashboard-flow button')];
  flow.forEach((button, index) => button.classList.toggle('done', index < p));
}

function renderPrepare() {
  const book = state.currentBook;
  $('prepare-empty').classList.toggle('hidden', Boolean(book));
  $('prepare-book').classList.toggle('hidden', !book);

  if (!book) return;

  $('prepare-stage').textContent = statusLabel(book.status);
  $('prepare-book-title').textContent = book.title || 'Sem título';
  $('prepare-book-idea').textContent =
    book.premise || book.description || 'Sem ideia registada.';

  const creation = book.book_metadata?.creation || {};
  const publication = book.book_metadata?.publication || {};

  $('prepare-book-meta').innerHTML = [
    book.genre,
    creation.series_name
      ? 'Série: ' + creation.series_name
      : null,
    creation.series_size
      ? creation.series_size + ' livros na série'
      : null,
    creation.chapter_size
      ? 'Capítulos: ' + creation.chapter_size
      : null,
  ]
    .filter(Boolean)
    .map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>')
    .join('');

  const bible = book.story_bible;
  const bibleReady = hasBible(book);
  const bibleLocked = hasApprovedBible(book);
  const structure = bookStructure(book);
  const structureReady = bibleLocked && structure.chapters.length > 0;

  $('bible-lock-state').textContent = !bibleReady
    ? 'Ainda não criada'
    : bibleLocked
      ? 'Oficial · bloqueada'
      : 'Criada · por aprovar';

  $('bible-generate').disabled = state.busy || bibleLocked;
  $('bible-approve').disabled = state.busy || !bibleReady || bibleLocked;
  $('book-structure').disabled = state.busy || !bibleLocked || structureReady;

  $('bible-summary').innerHTML = bible
    ? '<div class="result-line"><strong>Bíblia Oficial</strong>' +
      '<p>' + (bibleLocked
        ? 'A Bíblia foi aprovada e está bloqueada. Os capítulos deverão seguir este canon.'
        : 'A Bíblia foi criada. Revê o resultado e aprova para a tornar oficial.') +
      '</p></div>' +
      '<div class="result-line"><strong>Conteúdo</strong><p>' +
      countText((bible.characters || []).length) + ' personagens · ' +
      countText((bible.timeline || []).length) + ' pontos de cronologia · ' +
      countText((bible.relations || []).length) + ' relações</p></div>'
    : '<p class="reader-empty">A Bíblia ainda não foi criada.</p>';

  $('bible-view').innerHTML = bible
    ? '<strong>Bíblia Oficial criada.</strong><p>' +
      (bibleLocked ? 'Canon bloqueado.' : 'A aguardar aprovação.') + '</p>'
    : '<p class="reader-empty">Ainda não existe uma Bíblia Oficial.</p>';

  $('research-view').innerHTML =
    '<p class="reader-empty">A pesquisa não é necessária neste fluxo simples.</p>';

  $('structure-view').innerHTML = structure.chapters.length
    ? '<strong>Estrutura criada.</strong><p>' +
      structure.chapters.length + ' capítulos planeados.</p>'
    : '<p class="reader-empty">' +
      (bibleLocked
        ? 'A estrutura ainda não foi criada.'
        : 'Aprova a Bíblia antes de criar a estrutura.') +
      '</p>';

}

function structureItem(item, index) {
  return '<div class="structure-row">'
    + '<span>' + escapeHtml(item.number || String(index + 1)) + '</span>'
    + '<div><strong>' + escapeHtml(item.title || 'Sem título') + '</strong>'
    + '<p>' + escapeHtml(item.objective || item.description || item.content || '') + '</p></div>'
    + '</div>';
}

function renderWriting() {
  const book = state.currentBook;
  const structure = bookStructure(book);
  const hasPlan = Boolean(book && structure.chapters.length);

  $('writing-empty').classList.toggle('hidden', hasPlan);
  $('writing-book').classList.toggle('hidden', !hasPlan);

  const writeButton = $('write-next');
  writeButton.disabled = !hasPlan || state.busy;

  if (!hasPlan) return;

  const chapters = currentChapters(book);
  $('chapter-count').textContent = countText(structure.chapters.length) + ' capítulos';

  const rows = structure.chapters.map((chapter) => {
    const number = Number(chapter.number);
    const existing = chapters.find((item) => Number(item.chapter_number) === number);
    const active = state.selectedChapter?.id === existing?.id && existing;
    const actionText = existing ? 'Abrir' : 'Escrever';
    return '<button class="plan-row ' + (active ? 'active' : '') + '" type="button" data-chapter-plan="' + number + '">'
      + '<span class="plan-number">' + escapeHtml(number) + '</span>'
      + '<span class="plan-main"><strong>' + escapeHtml(chapter.title || 'Sem título') + '</strong>'
      + '<small>' + escapeHtml(chapter.objective || 'Plano ainda sem objectivo.') + '</small></span>'
      + '<span class="plan-state">' + actionText + '</span>'
      + '</button>';
  }).join('');

  $('chapter-plan').innerHTML = rows || '<p class="reader-empty">Sem capítulos planeados.</p>';

  document.querySelectorAll('[data-chapter-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      const number = Number(button.dataset.chapterPlan);
      const existing = chapters.find((item) => Number(item.chapter_number) === number);
      if (existing) {
        state.selectedChapter = existing;
        renderWriting();
      } else {
        writeChapter(number).catch((error) => setGlobal(error.message, 'error'));
      }
    });
  });

  if (!state.selectedChapter) {
    state.selectedChapter = chapters[0] || null;
  }

  if (state.selectedChapter) {
    const fresh = chapters.find((item) => item.id === state.selectedChapter.id);
    state.selectedChapter = fresh || state.selectedChapter;
  }

  const chapter = state.selectedChapter;
  $('selected-chapter-title').textContent = chapter
    ? 'Capítulo ' + chapter.chapter_number + ' · ' + (chapter.title || 'Sem título')
    : 'Selecciona um capítulo';
  $('selected-chapter-meta').textContent = chapter
    ? 'versão ' + (chapter.version_number ?? '—') + ' · ' + countText(String(chapter.content ?? '').length) + ' caracteres'
    : '—';

  const paragraphs = String(chapter?.content || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  $('selected-chapter-content').innerHTML = paragraphs.length
    ? paragraphs.map((part) => '<p>' + escapeHtml(part).replace(/\n/g, '<br>') + '</p>').join('')
    : '<p class="reader-empty">Quando escreveres este capítulo, o texto aparece aqui.</p>';

  const front = structure.front_matter.filter((item) => item && item.included !== false);
  const back = structure.back_matter.filter((item) => item && item.included !== false);
  $('structure-full-view').innerHTML = ''
    + '<section class="structure-group"><h3>Antes da história</h3>'
    + (front.length ? front.map(structureItem).join('') : '<p class="reader-empty">Sem elementos iniciais.</p>')
    + '</section>'
    + '<section class="structure-group"><h3>Índice e capítulos</h3>'
    + structure.chapters.map(structureItem).join('')
    + '</section>'
    + '<section class="structure-group"><h3>Depois da história</h3>'
    + (back.length ? back.map(structureItem).join('') : '<p class="reader-empty">Sem elementos finais.</p>')
    + '</section>';
}

function renderReview() {
  $('review-all').disabled = !state.currentBook || state.busy;
  if (!state.currentBook) {
    ['continuity-view', 'qa-view', 'originality-view'].forEach((id) => {
      $(id).innerHTML = '<p class="reader-empty">Selecciona um livro.</p>';
    });
  }
}

function renderPublication() {
  const book = state.currentBook;
  if (!book) {
    $('publication-status').innerHTML = '<strong>Sem livro.</strong><p>Selecciona um projecto primeiro.</p>';
    $('files-view').innerHTML = '<p class="reader-empty">Selecciona um livro.</p>';
    $('covers-view').innerHTML = '<p class="reader-empty">Selecciona um livro.</p>';
    return;
  }

  $('publication-price').value = Number(book.price_usd || 0).toFixed(2);
  $('publication-status').innerHTML = '<strong>' + escapeHtml(statusLabel(book.status)) + '</strong>'
    + '<p>' + (book.status === 'published'
      ? 'O livro está publicado.'
      : 'Guarda em “Em revisão” quando terminares a verificação.') + '</p>';

  document.querySelectorAll('.status-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.status === book.status);
  });

  loadFiles();
  loadCovers();
}

async function loadFiles() {
  if (!state.currentBook) return;
  const data = await api('/api/admin/files?book_id=' + encodeURIComponent(state.currentBook.id));
  const canOpen = state.currentBook.status === 'published';
  $('files-view').innerHTML = ''
    + '<strong>' + countText(data.chapters) + ' capítulos actuais</strong>'
    + '<p>' + escapeHtml(data.note || 'PDF e EPUB são gerados a pedido.') + '</p>'
    + (canOpen
      ? '<div class="file-links"><a href="/api/books/' + encodeURIComponent(state.currentBook.slug) + '/download?format=pdf">Abrir PDF</a><a href="/api/books/' + encodeURIComponent(state.currentBook.slug) + '/download?format=epub">Abrir EPUB</a></div>'
      : '<p class="small-muted">Publica o livro para activar os downloads.</p>');
}

async function loadCovers() {
  if (!state.currentBook) return;
  const data = await api('/api/admin/covers?book_id=' + encodeURIComponent(state.currentBook.id));
  if (!data.items?.length) {
    $('covers-view').innerHTML = '<p class="reader-empty">Ainda não existem capas. A geração usa automaticamente os dados do livro.</p>';
    return;
  }

  $('covers-view').innerHTML = data.items.map((cover) => {
    const selected = Number(cover.selected) === 1;
    return '<article class="cover-card ' + (selected ? 'selected' : '') + '">'
      + '<div class="cover-preview" data-cover-preview="' + escapeHtml(cover.id) + '"></div>'
      + '<div class="cover-meta"><strong>' + (selected ? 'Capa seleccionada' : 'Capa gerada') + '</strong>'
      + '<span>' + escapeHtml(cover.model || 'Workers AI') + '</span></div>'
      + (selected ? '' : '<button class="button button-secondary choose-cover" data-cover-id="' + escapeHtml(cover.id) + '" type="button">Escolher</button>')
      + '</article>';
  }).join('');

  const previews = await Promise.all(data.items.map(async (cover) => {
    try {
      const result = await api('/api/admin/covers/preview?cover_id=' + encodeURIComponent(cover.id));
      return { id: cover.id, data: result.data_uri };
    } catch {
      return null;
    }
  }));

  previews.filter(Boolean).forEach((item) => {
    const node = document.querySelector('[data-cover-preview="' + CSS.escape(item.id) + '"]');
    if (node) node.style.backgroundImage = "url('" + item.data + "')";
  });

  document.querySelectorAll('.choose-cover').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api('/api/admin/cover/select', {
          method: 'POST',
          body: JSON.stringify({ cover_id: button.dataset.coverId }),
        });
        await selectBook(state.currentBook.id, false);
        setGlobal('Capa seleccionada.', 'success');
      } catch (error) {
        setGlobal(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function createBook(body) {
  const data = await api('/api/admin/books', {
    method: 'POST',
    body: JSON.stringify({
      title: body.title.trim(),
      premise: body.premise.trim(),
      description: body.premise.trim(),
      genre: body.genre.trim(),
      series_name: body.series_name.trim(),
      series_size: Number(body.series_size || 0),
      chapter_size: body.chapter_size.trim(),
      author: body.author.trim() || state.user?.name || 'Nexauren',
      language: body.language.trim() || 'pt-PT',
      audience: body.audience.trim(),
      age_rating: body.age_rating.trim(),
      price_usd: Number(body.price_usd || 0).toFixed(2),
    }),
  });

  await loadBooks();
  await selectBook(data.id, false);
}

async function runBibleAction(action, successMessage) {
  if (!state.currentBook || state.busy) return;

  state.busy = true;
  $('bible-generate').disabled = true;
  $('bible-approve').disabled = true;
  $('book-structure').disabled = true;

  try {
    setGlobal('A processar a Bíblia Oficial…', 'busy');

    await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action,
        book_id: state.currentBook.id,
      }),
    });

    await selectBook(state.currentBook.id, false);
    setGlobal(successMessage, 'success');
  } catch (error) {
    setGlobal(error.message, 'error');
  } finally {
    state.busy = false;
    renderPrepare();
  }
}

async function generateBible() {
  return runBibleAction(
    'story_bible',
    'Bíblia Oficial criada. Revê-a antes de aprovar.',
  );
}

async function approveBible() {
  return runBibleAction(
    'approve_bible',
    'Bíblia Oficial aprovada e bloqueada. Agora podes criar o livro.',
  );
}

async function generateStructure() {
  if (!state.currentBook || state.busy) return;

  if (!hasApprovedBible(state.currentBook)) {
    setGlobal('Aprova a Bíblia Oficial antes de criar o livro.', 'error');
    return;
  }

  state.busy = true;
  $('book-structure').disabled = true;

  try {
    setGlobal('A criar a estrutura do livro…', 'busy');

    await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'structure',
        book_id: state.currentBook.id,
      }),
    });

    await selectBook(state.currentBook.id, false);
    setGlobal('Estrutura criada. O próximo passo é escrever os capítulos.', 'success');
    goTo('writing');
  } catch (error) {
    setGlobal(error.message, 'error');
  } finally {
    state.busy = false;
    renderPrepare();
  }
}

async function writeChapter(number) {
  if (!state.currentBook) throw new Error('Selecciona um livro primeiro.');
  if (state.busy) return;

  const structure = bookStructure(state.currentBook);
  const planned = structure.chapters.find((item) => Number(item.number) === Number(number));
  if (!planned) throw new Error('Este capítulo ainda não está no índice.');

  state.busy = true;
  $('write-next').disabled = true;
  setGlobal('A escrever o capítulo ' + number + '…', 'busy');

  try {
    await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'chapter',
        book_id: state.currentBook.id,
        chapter_number: Number(number),
        title: planned.title || ('Capítulo ' + number),
        language: 'pt-PT',
      }),
    });
    await loadBooks();
    await selectBook(state.currentBook.id, false);
    const fresh = currentChapters(state.currentBook).find(
      (item) => Number(item.chapter_number) === Number(number),
    );
    state.selectedChapter = fresh || null;
    renderWriting();
    setGlobal('Capítulo ' + number + ' escrito e guardado.', 'success');
  } catch (error) {
    setGlobal(error.message, 'error');
  } finally {
    state.busy = false;
    renderWriting();
  }
}

function nextChapterNumber() {
  const plan = bookStructure(state.currentBook).chapters
    .map((item) => Number(item.number))
    .filter(Boolean);
  const existing = new Set(currentChapters(state.currentBook).map(
    (item) => Number(item.chapter_number),
  ));
  const next = plan.find((number) => !existing.has(number));
  return next || (plan.length ? Math.max(...plan) + 1 : 1);
}

async function reviewBook() {
  if (!state.currentBook || state.busy) return;
  state.busy = true;
  $('review-all').disabled = true;

  try {
    const chapters = currentChapters(state.currentBook);
    const chapterNumber = chapters.length
      ? Number(chapters[chapters.length - 1].chapter_number)
      : 1;

    setGlobal('A verificar continuidade…', 'busy');
    const continuity = await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'continuity',
        book_id: state.currentBook.id,
        chapter_number: chapterNumber,
      }),
    });

    setGlobal('A executar a revisão geral…', 'busy');
    const qa = await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'qa',
        book_id: state.currentBook.id,
      }),
    });

    setGlobal('A comparar originalidade…', 'busy');
    const originality = await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'originality',
        book_id: state.currentBook.id,
      }),
    });

    renderResult('continuity-view', continuity.report);
    renderResult('qa-view', qa.qa);
    renderResult('originality-view', originality.originality);

    if (state.currentBook.status === 'writing') {
      await api('/api/admin/books/' + encodeURIComponent(state.currentBook.id), {
        method: 'PATCH',
        body: JSON.stringify({ status: 'review' }),
      });
      await loadBooks();
      await selectBook(state.currentBook.id, false);
    }

    setGlobal('Revisão concluída.', 'success');
  } catch (error) {
    setGlobal(error.message, 'error');
  } finally {
    state.busy = false;
    renderReview();
  }
}

function renderResult(targetId, value) {
  const target = $(targetId);
  if (!target) return;

  if (!value || typeof value !== 'object') {
    target.innerHTML = '<p>' + escapeHtml(value || 'Sem resultado.') + '</p>';
    return;
  }

  const entries = Object.entries(value);
  target.innerHTML = entries.slice(0, 8).map(([key, item]) => {
    let output = '';
    if (Array.isArray(item)) {
      output = item.length
        ? '<ul>' + item.slice(0, 10).map((part) => '<li>' + escapeHtml(
          typeof part === 'object' ? JSON.stringify(part) : part,
        ) + '</li>').join('') + '</ul>'
        : '<p class="small-muted">Sem itens.</p>';
    } else if (typeof item === 'object' && item !== null) {
      output = '<p>' + escapeHtml(JSON.stringify(item)) + '</p>';
    } else {
      output = '<p>' + escapeHtml(item) + '</p>';
    }
    return '<div class="result-line"><strong>' + escapeHtml(
      key.replace(/_/g, ' '),
    ) + '</strong>' + output + '</div>';
  }).join('');
}

async function generateCover() {
  if (!state.currentBook || state.busy) return;
  state.busy = true;
  $('cover-generate').disabled = true;
  $('cover-generate').textContent = 'A gerar…';
  setGlobal('A criar uma nova capa…', 'busy');
  try {
    await api('/api/admin/cover', {
      method: 'POST',
      body: JSON.stringify({
        book_id: state.currentBook.id,
      }),
    });
    await loadCovers();
    setGlobal('Capa criada.', 'success');
  } catch (error) {
    setGlobal(error.message, 'error');
  } finally {
    state.busy = false;
    $('cover-generate').disabled = false;
    $('cover-generate').textContent = 'Gerar capa';
  }
}

async function generateSeo() {
  if (!state.currentBook || state.busy) return;
  state.busy = true;
  $('seo-generate').disabled = true;
  $('seo-generate').textContent = 'A gerar…';
  setGlobal('A preparar o SEO…', 'busy');
  try {
    const data = await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'seo',
        book_id: state.currentBook.id,
      }),
    });
    renderResult('seo-view', data.seo);
    await loadBooks();
    await selectBook(state.currentBook.id, false);
    setGlobal('SEO criado e guardado.', 'success');
  } catch (error) {
    setGlobal(error.message, 'error');
  } finally {
    state.busy = false;
    $('seo-generate').disabled = false;
    $('seo-generate').textContent = 'Gerar SEO';
  }
}

async function savePublication() {
  if (!state.currentBook || state.busy) return;
  const status = document.querySelector('.status-button.active')?.dataset.status
    || state.currentBook.status;
  const price = Number($('publication-price').value || 0);

  try {
    await api('/api/admin/books/' + encodeURIComponent(state.currentBook.id), {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        price_usd: price.toFixed(2),
      }),
    });
    await loadBooks();
    await selectBook(state.currentBook.id, false);
    setGlobal('Estado de publicação guardado.', 'success');
  } catch (error) {
    setGlobal(error.message, 'error');
  }
}

function renderAll() {
  renderBookOptions();
  renderDashboard();
  renderPrepare();
  renderWriting();
  renderReview();
  renderPublication();
}

document.querySelectorAll('[data-section-link]').forEach((button) => {
  button.addEventListener('click', () => goTo(button.dataset.sectionLink));
});

navItems.forEach((button) => {
  button.addEventListener('click', () => {
    setNav(button.dataset.section);
    if (button.dataset.section === 'prepare') renderPrepare();
    if (button.dataset.section === 'writing') renderWriting();
    if (button.dataset.section === 'review') renderReview();
    if (button.dataset.section === 'publish') renderPublication();
    if (button.dataset.section === 'books') renderBooks();
  });
});

document.querySelectorAll('[data-action="new-book"]').forEach((button) => {
  button.addEventListener('click', () => {
    state.currentBook = null;
    state.selectedChapter = null;
    localStorage.removeItem('nexauren_books_admin_book');
    $('book-form')?.reset();
    goTo('prepare');
    renderAll();
  });
});

$('book-context')?.addEventListener('change', async (event) => {
  try {
    await selectBook(event.target.value, true);
  } catch (error) {
    setGlobal(error.message, 'error');
  }
});

$('mobile-book-context')?.addEventListener('change', async (event) => {
  try {
    await selectBook(event.target.value, true);
  } catch (error) {
    setGlobal(error.message, 'error');
  }
});

$('next-button')?.addEventListener('click', () => {
  const action = $('next-button').dataset.nextAction;
  const section = $('next-button').dataset.nextSection || 'prepare';

  if (action === 'new') {
    state.currentBook = null;
    state.selectedChapter = null;
    localStorage.removeItem('nexauren_books_admin_book');
    $('book-form')?.reset();
    goTo('prepare');
    return;
  }

  if (action === 'approve' && state.currentBook) {
    goTo('prepare');
    setTimeout(() => $('bible-approve')?.click(), 120);
    return;
  }

  if (action === 'structure' && state.currentBook) {
    goTo('prepare');
    setTimeout(() => $('book-structure')?.click(), 120);
    return;
  }

  goTo(section);
});

$('book-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;

  const payload = {
    title: safeText(form.elements.title?.value),
    premise: safeText(form.elements.premise?.value),
    genre: safeText(form.elements.genre?.value),
    series_name: safeText(form.elements.series_name?.value),
    series_size: safeText(form.elements.series_size?.value),
    chapter_size: safeText(form.elements.chapter_size?.value),
    author: safeText(form.elements.author?.value),
    language: safeText(form.elements.language?.value),
    audience: safeText(form.elements.audience?.value),
    age_rating: safeText(form.elements.age_rating?.value),
    price_usd: safeText(form.elements.price_usd?.value),
  };

  if (!payload.title || !payload.premise || !payload.genre || !payload.chapter_size) {
    setInline(
      'book-form-status',
      'Preenche título, ideia, género e tamanho do capítulo.',
      'error',
    );
    return;
  }

  const button = $('book-save');
  button.disabled = true;
  button.textContent = 'A criar…';
  setInline('book-form-status', 'A guardar os dados do projecto…');

  try {
    await createBook(payload);
    setInline(
      'book-form-status',
      'Projecto criado. Agora vem a Bíblia Oficial.',
      'success',
    );
    setGlobal('Projecto criado. Cria a Bíblia Oficial primeiro.', 'success');
    goTo('prepare');
  } catch (error) {
    setInline('book-form-status', error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Criar projecto';
  }
});

$(
  'bible-generate'
)?.addEventListener('click', generateBible);
$('bible-approve')?.addEventListener('click', approveBible);
$('book-structure')?.addEventListener('click', generateStructure);
$('write-next')?.addEventListener('click', () => writeChapter(nextChapterNumber()));
$('review-all')?.addEventListener('click', reviewBook);
$('cover-generate')?.addEventListener('click', generateCover);
$('seo-generate')?.addEventListener('click', generateSeo);
$('save-publication')?.addEventListener('click', savePublication);

document.querySelectorAll('.status-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.status-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

async function renderBooks() {
  const target = $('books-list');
  if (!state.books.length) {
    target.innerHTML = '<div class="card empty-panel"><h2>Ainda não tens livros.</h2><p>Cria o primeiro projecto para começar.</p></div>';
    return;
  }
  target.innerHTML = state.books.map((book) => '<article class="book-list-row">'
    + '<div><strong>' + escapeHtml(book.title || 'Sem título') + '</strong>'
    + '<p>' + escapeHtml(book.author || 'Nexauren') + ' · ' + escapeHtml(statusLabel(book.status)) + '</p></div>'
    + '<div class="book-row-actions"><span class="status">' + escapeHtml(statusLabel(book.status)) + '</span>'
    + '<button class="button button-secondary open-book" data-book-id="' + escapeHtml(book.id) + '" type="button">Abrir</button></div>'
    + '</article>').join('');

  target.querySelectorAll('.open-book').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await selectBook(button.dataset.bookId, true);
        goTo('dashboard');
      } catch (error) {
        setGlobal(error.message, 'error');
      }
    });
  });
}

async function boot() {
  try {
    const user = await ensureAdmin();
    if (!user) return;
    await loadBooks();
    renderAll();
  } catch (error) {
    setGlobal(error.message, 'error');
  }
}

$('logout')?.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } finally {
    window.location.replace('/admin/login/');
  }
});

boot();
