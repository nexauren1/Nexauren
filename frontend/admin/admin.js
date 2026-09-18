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

function wordCount(value) {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

const BIBLE_LABELS = {
  title: 'Título',
  genre: 'Género',
  subgenre: 'Subgénero',
  format: 'Formato',
  logline: 'Logline',
  synopsis: 'Sinopse',
  editorial_scope: 'Escala editorial',
  scale: 'Escala',
  character_count_target: 'Personagens definidos pela IA',
  relation_count_target: 'Relações definidas pela IA',
  location_count_target: 'Locais definidos pela IA',
  timeline_milestone_target: 'Marcos da cronologia',
  plot_thread_target: 'Fios narrativos',
  premise: 'Premissa',
  central_conflict: 'Conflito central',
  protagonist_goal: 'Objectivo do protagonista',
  stakes: 'Consequências em jogo',
  themes: 'Temas',
  beginning: 'Início',
  inciting_incident: 'Incidente desencadeador',
  rising_action: 'Escalada',
  midpoint: 'Ponto médio',
  crisis: 'Crise',
  climax: 'Clímax',
  resolution: 'Resolução',
  protagonist_arc: 'Arco do protagonista',
  ending: 'Final',
  setting: 'Cenário',
  time: 'Época',
  culture: 'Contexto cultural',
  technology: 'Tecnologia',
  speculative_element: 'Elemento especulativo',
  phenomenon: 'Fenómeno',
  rules: 'Regras do mundo',
  limitations: 'Limitações',
  key_locations: 'Locais principais',
  locations: 'Locais',
  institutions: 'Instituições',
  social_context: 'Contexto social',
  important_objects_or_systems: 'Objectos ou sistemas importantes',
  pov: 'Ponto de vista',
  tense: 'Tempo verbal',
  voice: 'Voz narrativa',
  tone: 'Tom',
  pacing: 'Ritmo',
  dialogue_guidance: 'Orientação dos diálogos',
  description_guidance: 'Orientação das descrições',
  scene_rules: 'Regras de cena',
  immutable_facts: 'Factos imutáveis',
  names_and_terms: 'Nomes e termos canónicos',
  must_not_change: 'Não pode mudar',
  knowledge_boundaries: 'Limites de conhecimento',
  forbidden_elements: 'Elementos proibidos',
  unresolved_threads: 'Fios por resolver',
  reveal_rules: 'Regras de revelação',
  future_threads: 'Fios futuros',
  series_threads: 'Fios da série',
  this_book_ending: 'Final deste livro',
  roles: 'Funções',
  identity: 'Identidade',
  background: 'Passado',
  wants: 'Quer',
  needs: 'Precisa',
  fears: 'Medos',
  flaws: 'Falhas',
  strengths: 'Forças',
  arc: 'Arco',
  relationships: 'Relações',
  knowledge_boundaries: 'O que sabe / não sabe',
  secrets: 'Segredos',
  id: 'ID canónico',
  order: 'Ordem',
  phase: 'Fase',
  event: 'Acontecimento',
  cause: 'Causa',
  consequence: 'Consequência',
  reveals: 'Revelação',
  from_character_id: 'De',
  to_character_id: 'Para',
  from: 'De',
  to: 'Para',
  type: 'Tipo',
  dynamic: 'Dinâmica',
  evolution: 'Evolução',
  included: 'Incluído',
  content: 'Conteúdo',
};

function humanizeBibleKey(key) {
  const clean = String(key || '').trim();
  if (BIBLE_LABELS[clean]) return BIBLE_LABELS[clean];
  return clean
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function bibleValue(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value.map((item) => bibleValue(item)).filter(Boolean).join(' · ');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${humanizeBibleKey(key)}: ${bibleValue(item)}`)
      .filter(Boolean)
      .join(' · ');
  }
  return String(value).trim();
}

function renderBibleObject(value) {
  if (!value || typeof value !== 'object') return escapeHtml(bibleValue(value));
  if (Array.isArray(value)) {
    return '<div class="bible-list">' + value.map((item, index) =>
      '<div class="bible-row"><strong>' + (index + 1) + '</strong><p>'
      + escapeHtml(bibleValue(item)) + '</p></div>',
    ).join('') + '</div>';
  }
  return Object.entries(value)
    .filter(([, item]) => bibleValue(item))
    .map(([key, item]) => {
      const nested = item && typeof item === 'object';
      return '<div class="bible-field">' +
        '<span>' + escapeHtml(humanizeBibleKey(key)) + '</span>' +
        (nested
          ? renderBibleObject(item)
          : '<p>' + escapeHtml(bibleValue(item)) + '</p>') +
        '</div>';
    }).join('');
}

function renderBibleScope(scope) {
  if (!scope || typeof scope !== 'object') return '';
  const values = [
    ['Escala', scope.scale],
    ['Personagens', scope.character_count_target],
    ['Relações', scope.relation_count_target],
    ['Locais', scope.location_count_target],
    ['Marcos', scope.timeline_milestone_target],
    ['Fios narrativos', scope.plot_thread_target],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!values.length) return '';
  return '<section class="bible-section bible-scope"><h3>Escala decidida pela IA</h3>' +
    '<div class="bible-scope-grid">' +
    values.map(([label, value]) =>
      '<div class="bible-scope-card"><strong>' + escapeHtml(value) +
      '</strong><span>' + escapeHtml(label) + '</span></div>',
    ).join('') + '</div></section>';
}

function renderBibleDetail(bible) {
  if (!bible) return '<p class="reader-empty">A Bíblia ainda não foi criada.</p>';
  const groups = [
    ['Identidade', bible.identity],
    ['História', bible.story],
    ['Mundo', bible.world],
    ['Estilo', bible.style],
    ['Continuidade', bible.continuity],
    ['Continuação', bible.continuation],
  ];
  const body = groups.map(([title, value]) => {
    if (!value || typeof value !== 'object') return '';
    const html = renderBibleObject(value);
    return html ? '<section class="bible-section"><h3>' + escapeHtml(title) + '</h3>' + html + '</section>' : '';
  }).join('');

  const characters = Array.isArray(bible.characters) ? bible.characters : [];
  const cast = characters.map((item, index) => {
    const name = item?.name || item?.canonical_name || 'Sem nome definido';
    const fields = renderBibleObject({
      identity: item?.identity,
      background: item?.background,
      wants: item?.wants,
      needs: item?.needs,
      fears: item?.fears,
      flaws: item?.flaws,
      strengths: item?.strengths,
      arc: item?.arc,
      relationships: item?.relationships,
      knowledge_boundaries: item?.knowledge_boundaries,
      secrets: item?.secrets,
    });
    return '<article class="bible-char bible-char-detail"><div class="bible-char-head">'
      + '<strong>' + escapeHtml(name) + '</strong>'
      + (item?.role ? '<span class="bible-pill">' + escapeHtml(item.role) + '</span>' : '')
      + '</div><small>Personagem ' + (index + 1) + '</small>'
      + fields + '</article>';
  }).join('');

  const relations = Array.isArray(bible.relations) ? bible.relations : [];
  const relationHtml = relations.map((item) =>
    '<div class="bible-row"><strong>'
    + escapeHtml(item?.from_character_id || item?.from || '—')
    + ' → ' + escapeHtml(item?.to_character_id || item?.to || '—')
    + '</strong><p>' + escapeHtml(
      bibleValue(item?.type || item?.dynamic || item?.evolution || item),
    ) + '</p></div>',
  ).join('');

  const timeline = Array.isArray(bible.timeline) ? bible.timeline : [];
  const timelineHtml = timeline.map((item, index) =>
    '<div class="bible-row"><strong>Marco ' + escapeHtml(item?.order || index + 1) +
    (item?.phase ? ' · ' + escapeHtml(item.phase) : '') + '</strong><p>' +
    escapeHtml(bibleValue(item?.event)) + '</p><p><b>Causa:</b> ' +
    escapeHtml(bibleValue(item?.cause)) + '</p><p><b>Consequência:</b> ' +
    escapeHtml(bibleValue(item?.consequence)) + '</p>' +
    (item?.reveals ? '<p><b>Revelação:</b> ' + escapeHtml(bibleValue(item.reveals)) + '</p>' : '') +
    '</div>',
  ).join('');

  return '<div class="bible-detail">' +
    renderBibleScope(bible.identity?.editorial_scope) +
    body +
    (cast ? '<section class="bible-section"><h3>Personagens (' + characters.length + ')</h3>' + cast + '</section>' : '') +
    (relationHtml ? '<section class="bible-section"><h3>Relações (' + relations.length + ')</h3>' + relationHtml + '</section>' : '') +
    (timelineHtml ? '<section class="bible-section"><h3>Cronologia (' + timeline.length + ')</h3>' + timelineHtml + '</section>' : '') +
    '</div>';
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


function setCreationActivity(active, title = '', detail = '', steps = [], currentStep = 0) {
  const panel = $('creation-activity');
  if (!panel) return;

  panel.classList.toggle('hidden', !active);
  if (!active) {
    panel.removeAttribute('data-active');
    return;
  }

  panel.setAttribute('data-active', 'true');
  $('creation-activity-title').textContent = title || 'A trabalhar…';
  $('creation-activity-detail').textContent = detail || '';

  const labels = Array.isArray(steps) && steps.length
    ? steps.slice(0, 3)
    : ['A preparar', 'A criar', 'A concluir'];

  for (let i = 0; i < 3; i += 1) {
    const node = $('creation-step-' + (i + 1));
    if (!node) continue;
    node.textContent = labels[i] || '';
    node.classList.toggle('current', i === currentStep);
    node.classList.toggle('done', i < currentStep);
  }
}

function setFormBusy(formId, busy) {
  const form = $(formId);
  if (!form) return;
  form.classList.toggle('is-busy', busy);
  form.querySelectorAll('input, select, textarea, button').forEach((field) => {
    field.disabled = busy;
  });
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
      book_plan: {},
      front_matter: [],
      chapters: raw.filter((item) => item && Number(item.number) > 0)
        .sort((a, b) => Number(a.number) - Number(b.number)),
      back_matter: [],
    };
  }
  if (raw && typeof raw === 'object') {
    return {
      book_plan: raw.book_plan
        && typeof raw.book_plan === 'object'
        ? raw.book_plan : {},
      front_matter: Array.isArray(raw.front_matter) ? raw.front_matter : [],
      chapters: Array.isArray(raw.chapters) ? raw.chapters : [],
      back_matter: Array.isArray(raw.back_matter) ? raw.back_matter : [],
    };
  }
  return {
    book_plan: {},
    front_matter: [],
    chapters: [],
    back_matter: [],
  };
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
  $('bible-generate').textContent =
    bibleReady && !bibleLocked
      ? 'Regenerar Bíblia Oficial'
      : 'Criar Bíblia Oficial';
  $('bible-approve').disabled = state.busy || !bibleReady || bibleLocked;
  const writtenCount = currentChapters(book).length;
  const canCreateStructure = bibleLocked && writtenCount === 0;
  $('book-structure').disabled = state.busy || !canCreateStructure;
  $('book-structure').textContent =
    structureReady && writtenCount === 0
      ? 'Regenerar estrutura'
      : 'Criar estrutura do livro';

  $('bible-summary').innerHTML = bible
    ? '<div class="result-line"><strong>Bíblia Oficial</strong>' +
      '<p>' + (bibleLocked
        ? 'A Bíblia foi aprovada e está bloqueada. Os capítulos deverão seguir este canon.'
        : 'A Bíblia foi criada. Revê o resultado e aprova para a tornar oficial.') +
      '</p></div>' +
      '<div class="result-line"><strong>Conteúdo</strong><p>' +
      countText((bible.characters || []).length) + ' personagens · ' +
      countText((bible.timeline || []).length) + ' pontos de cronologia · ' +
      countText((bible.relations || []).length) + ' relações' +
      (bible.identity?.editorial_scope?.scale
        ? ' · escala ' + escapeHtml(bible.identity.editorial_scope.scale)
        : '') +
      '</p></div>'
    : '<p class="reader-empty">A Bíblia ainda não foi criada.</p>';

  $('bible-view').innerHTML = bible
    ? '<strong>' +
      (bibleLocked
        ? 'Bíblia Oficial bloqueada.'
        : 'Bíblia Oficial por aprovar.') +
      '</strong><p>' +
      countText(bible.characters?.length || 0) +
      ' personagens · ' +
      countText(bible.timeline?.length || 0) +
      ' marcos · ' +
      countText(bible.relations?.length || 0) +
      ' relações</p>' +
      renderBibleDetail(bible)
    : '<p class="reader-empty">Ainda não existe uma Bíblia Oficial.</p>';

  $('research-view').innerHTML =
    '<p class="reader-empty">A pesquisa não é necessária neste fluxo simples.</p>';

  const structurePlan = structure.book_plan || {};
  const planSummary = structure.chapters.length
    ? '<div class="result-line"><strong>Plano editorial</strong><p>' +
      '<b>' + escapeHtml(structurePlan.chapter_count || structure.chapters.length) +
      '</b> capítulos' +
      (structurePlan.estimated_word_count
        ? ' · estimativa de ' + escapeHtml(structurePlan.estimated_word_count) + ' palavras'
        : '') +
      (structurePlan.pacing_strategy
        ? '<br>Ritmo: ' + escapeHtml(structurePlan.pacing_strategy)
        : '') +
      (structurePlan.ending_strategy
        ? '<br>Final: ' + escapeHtml(structurePlan.ending_strategy)
        : '') +
      '</p></div>'
    : '';
  $('structure-view').innerHTML = structure.chapters.length
    ? planSummary +
      '<strong>Estrutura completa criada.</strong><p>' +
      structure.chapters.length + ' capítulos planeados a partir da Bíblia Oficial bloqueada.</p>'
    : '<p class="reader-empty">' +
      (bibleLocked
        ? 'A estrutura ainda não foi criada.'
        : 'Aprova a Bíblia antes de criar a estrutura.') +
      '</p>';

}

function structureItem(item, index) {
  const fields = [
    ['Papel', item.arc_role],
    ['Objectivo', item.objective],
    ['Personagens', Array.isArray(item.characters)
      ? item.characters.join(', ')
      : item.characters],
    ['Local', item.location],
    ['Conflito', item.conflict],
    ['Viragem', item.turning_point],
    ['Resultado', item.result],
    ['Próxima causa', item.cause_forward],
  ].filter((entry) => entry[1]);

  return '<div class="structure-row">' +
    '<span>' + escapeHtml(item.number || String(index + 1)) + '</span>' +
    '<div><strong>' + escapeHtml(item.title || 'Sem título') + '</strong>' +
    fields.map((entry) =>
      '<p><b>' + escapeHtml(entry[0]) + ':</b> ' +
      escapeHtml(entry[1]) + '</p>',
    ).join('') +
    '</div></div>';
}

function renderWriting() {
  const book = state.currentBook;
  const structure = bookStructure(book);
  const hasPlan = Boolean(book && structure.chapters.length);

  $('writing-empty').classList.toggle('hidden', hasPlan);
  $('writing-book').classList.toggle('hidden', !hasPlan);

  const writeButton = $('write-next');

  if (!hasPlan) {
    writeButton.disabled = true;
    writeButton.textContent = 'Estrutura necessária';
    return;
  }

  const chapters = currentChapters(book);
  const next = nextChapterNumber();

  writeButton.disabled = !next || state.busy;
  writeButton.textContent = next
    ? 'Escrever capítulo ' + next
    : 'Livro completo';

  $('chapter-count').textContent =
    countText(structure.chapters.length) + ' capítulos';

  const rows = structure.chapters.map((chapter) => {
    const number = Number(chapter.number);
    const existing = chapters.find(
      (item) => Number(item.chapter_number) === number,
    );
    const active = state.selectedChapter?.id === existing?.id && existing;
    const isNext = number === next;
    const actionText = existing
      ? 'Abrir'
      : isNext
        ? 'Escrever'
        : 'Bloqueado';
    const disabled =
      !existing && !isNext ? ' disabled' : '';

    return '<button class="plan-row ' +
      (active ? 'active' : '') +
      (disabled ? ' locked' : '') +
      '" type="button" data-chapter-plan="' +
      number + '"' + disabled + '>' +
      '<span class="plan-number">' +
      escapeHtml(number) + '</span>' +
      '<span class="plan-main"><strong>' +
      escapeHtml(chapter.title || 'Sem título') +
      '</strong><small>' +
      escapeHtml(chapter.objective || 'Plano ainda sem objectivo.') +
      '</small></span><span class="plan-state">' +
      actionText + '</span></button>';
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
  const creation = book.book_metadata?.creation || {};
  $('selected-chapter-meta').textContent = chapter
    ? 'versão ' + (chapter.version_number ?? '—') +
      ' · ' + countText(wordCount(chapter.content)) +
      ' palavras · alvo ' + (creation.chapter_size || '—')
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
  $('review-all').disabled =
    !state.currentBook ||
    state.busy ||
    currentChapters(state.currentBook).length === 0;
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

  const data = await api(
    '/api/admin/files?book_id=' +
    encodeURIComponent(state.currentBook.id),
  );

  const canOpen = state.currentBook.status === 'published';
  const publicPdf = '/api/books/' +
    encodeURIComponent(state.currentBook.slug) +
    '/download?format=pdf';
  const publicEpub = '/api/books/' +
    encodeURIComponent(state.currentBook.slug) +
    '/download?format=epub';

  const problems = [
    ...(data.missing_chapters || []).map(
      (number) => 'Capítulo ' + number + ' em falta',
    ),
    ...(data.invalid_chapters || []).map(
      (number) => 'Capítulo ' + number +
        ' fora do tamanho definido',
    ),
  ];

  const pdfButton = $('pdf-generate');
  if (pdfButton) {
    pdfButton.disabled =
      !data.can_generate_pdf || state.busy;
    pdfButton.dataset.pdfUrl =
      data.can_generate_pdf
        ? '/api/admin/files/download?book_id=' +
          encodeURIComponent(state.currentBook.id) +
          '&format=pdf'
        : '';
  }

  $('files-view').innerHTML = ''
    + '<strong>' + countText(data.chapters) +
      ' de ' + countText(data.planned_chapters) +
      ' capítulos</strong>'
    + '<p>' + countText(data.word_count) +
      ' palavras no manuscrito · alvo por capítulo: ' +
      escapeHtml(data.target_range || '—') + '</p>'
    + (problems.length
      ? '<div class="file-state error"><strong>O livro ainda não está pronto</strong><p>' +
        problems.map(escapeHtml).join(' · ') +
        '</p></div>'
      : '<div class="file-state success"><strong>Manuscrito completo e validado.</strong><p>' +
        escapeHtml(data.note || '') +
        '</p></div>')
    + (canOpen
      ? '<div class="file-links">' +
        '<a class="button" href="' + publicPdf +
        '">Abrir PDF público</a>' +
        '<a class="button" href="' + publicEpub +
        '">Abrir EPUB público</a>' +
        '</div>'
      : '')
    + (!data.can_generate_pdf
      ? '<p class="small-muted">Escreve e valida todos os capítulos para activar a geração do PDF.</p>'
      : '');
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
    setCreationActivity(
      true,
      action === 'approve_bible'
        ? 'A bloquear a Bíblia Oficial…'
        : 'A criar a Bíblia Oficial…',
      action === 'approve_bible'
        ? 'Estamos a validar a Bíblia e a torná-la a fonte oficial do livro.'
        : 'A IA está a construir a história e a validar os dados antes de os guardar.',
      ['Preparar pedido', 'IA a trabalhar', 'Validar resultado'],
      1,
    );
    setGlobal('A processar a Bíblia Oficial…', 'busy');

    await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action,
        book_id: state.currentBook.id,
      }),
    });

    setCreationActivity(
      true,
      'Resultado recebido. A finalizar…',
      'Estamos a guardar a etapa e a actualizar o estúdio.',
      ['Pedido concluído', 'Resultado recebido', 'Finalizar'],
      2,
    );
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
    setCreationActivity(
      true,
      'A criar a estrutura do livro…',
      'A IA está a transformar a Bíblia Oficial num plano de capítulos ligado entre si.',
      ['Ler Bíblia Oficial', 'Criar estrutura', 'Finalizar plano'],
      1,
    );
    setGlobal('A criar a estrutura do livro…', 'busy');

    await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'structure',
        book_id: state.currentBook.id,
      }),
    });

    setCreationActivity(
      true,
      'Estrutura recebida. A finalizar…',
      'Estamos a guardar o índice e a preparar a escrita.',
      ['Bíblia lida', 'Plano recebido', 'Finalizar'],
      2,
    );
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
  const planned = structure.chapters.find(
    (item) => Number(item.number) === Number(number),
  );
  if (!planned) throw new Error('Este capítulo ainda não está no índice.');

  const next = nextChapterNumber();
  if (!next || Number(number) !== Number(next)) {
    throw new Error(
      next
        ? 'Escreve primeiro o capítulo ' + next + '.'
        : 'Todos os capítulos planeados já foram escritos.',
    );
  }

  state.busy = true;
  $('write-next').disabled = true;
  setCreationActivity(
    true,
    'A escrever o capítulo ' + number + '…',
    'A IA está a transformar o plano deste capítulo em manuscrito completo.',
    ['Preparar capítulo', 'Escrever manuscrito', 'Validar resultado'],
    1,
  );
  setGlobal('A escrever o capítulo ' + number + '…', 'busy');

  try {
    await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'chapter',
        book_id: state.currentBook.id,
        chapter_number: Number(number),
        title: planned.title || ('Capítulo ' + number),
        language: state.currentBook.language || 'pt-PT',
      }),
    });
    setCreationActivity(
      true,
      'Capítulo escrito. A validar…',
      'O manuscrito foi recebido. Estamos a actualizar o livro.',
      ['Plano concluído', 'Manuscrito recebido', 'Finalizar capítulo'],
      2,
    );
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

  const existing = new Set(
    currentChapters(state.currentBook).map(
      (item) => Number(item.chapter_number),
    ),
  );

  return plan.find((number) => !existing.has(number)) || null;
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

    setCreationActivity(
      true,
      'A rever o livro…',
      'Estamos a executar as verificações uma a uma. O resultado aparece nesta página.',
      ['Ver continuidade', 'Rever qualidade', 'Comparar originalidade'],
      0,
    );
    setGlobal('A verificar continuidade…', 'busy');
    const continuity = await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'continuity',
        book_id: state.currentBook.id,
        chapter_number: chapterNumber,
      }),
    });

    setCreationActivity(
      true,
      'Continuidade concluída. A rever qualidade…',
      'Agora a revisão verifica a preparação do manuscrito para publicação.',
      ['Continuidade concluída', 'Rever qualidade', 'Comparar originalidade'],
      1,
    );
    setGlobal('A executar a revisão geral…', 'busy');
    const qa = await api('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'qa',
        book_id: state.currentBook.id,
      }),
    });

    setCreationActivity(
      true,
      'Qualidade concluída. A comparar originalidade…',
      'Estamos a terminar a revisão do livro com a última verificação.',
      ['Continuidade concluída', 'Qualidade concluída', 'Comparar originalidade'],
      2,
    );
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
  button.textContent = 'A criar…';
  setFormBusy('book-form', true);
  setCreationActivity(
    true,
    'A criar o teu projecto…',
    'Os dados foram recebidos. Estamos a criar o espaço do livro.',
    ['Receber ficha', 'Criar projecto', 'Preparar próximo passo'],
    0,
  );
  setInline('book-form-status', 'A criar o projecto…');

  try {
    await createBook(payload);
    setCreationActivity(
      true,
      'Projecto criado. A preparar o estúdio…',
      'O livro já existe. Estamos a carregar o próximo passo.',
      ['Ficha recebida', 'Projecto criado', 'Preparar Bíblia Oficial'],
      2,
    );
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
    setCreationActivity(false);
    setFormBusy('book-form', false);
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
$('pdf-generate')?.addEventListener('click', () => {
  const url = $('pdf-generate')?.dataset.pdfUrl;
  if (url) window.location.href = url;
});
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
