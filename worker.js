const SESSION_COOKIE = '__Host-nexauren_session';
const SESSION_DAYS = 14;
const PASSWORD_ITERATIONS = 30000;
const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

async function hashPassword(password, saltHex) {
  const salt = saltHex
    ? hexToBytes(saltHex)
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PASSWORD_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return { hash: bytesToHex(bits), salt: bytesToHex(salt) };
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  const cookies = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionCookie(token, maxAge = SESSION_DAYS * 86400) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

async function createSession(env, userId) {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const createdAt = now();
  const expiresAt = createdAt + SESSION_DAYS * 86400;

  await env.DB.prepare(
    `INSERT INTO sessions
      (id, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(tokenHash, userId, createdAt, expiresAt, createdAt).run();

  return { token, expiresAt };
}

async function getSession(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.expires_at,
            u.email, u.name, u.role, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
      LIMIT 1`,
  ).bind(tokenHash).first();
  if (!session) return null;
  if (Number(session.expires_at) <= now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(tokenHash).run();
    return null;
  }
  await env.DB.prepare(
    'UPDATE sessions SET last_seen_at = ? WHERE id = ?',
  ).bind(now(), tokenHash).run();
  return session;
}

async function requireUser(env, request) {
  return getSession(env, request);
}

async function requireAdmin(env, request) {
  const session = await getSession(env, request);
  if (!session || session.role !== 'admin') return null;
  return session;
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${bytesToHex(bytes)}`;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `item-${Date.now()}`;
}

function safeJsonParse(value, fallback = {}) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function clip(value, max = 18000) {
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value ?? {});
  return text.length <= max ? text : `${text.slice(0, max)}\n…[clipped]`;
}

async function bodyJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function authRegister(env, request) {
  const body = await bodyJson(request);
  const email = cleanEmail(body?.email);
  const password = String(body?.password || '');
  const name = String(body?.name || '').trim().slice(0, 80);
  if (!validEmail(email)) return json({ error: 'Enter a valid email.' }, 400);
  if (password.length < 8) {
    return json({ error: 'Password must contain at least 8 characters.' }, 400);
  }
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
  ).bind(email).first();
  if (existing) {
    return json({ error: 'An account with this email already exists.' }, 409);
  }
  const id = randomId('usr');
  const passwordData = await hashPassword(password);
  const createdAt = now();
  await env.DB.prepare(
    `INSERT INTO users
      (id, email, password_hash, password_salt, name, role, created_at)
     VALUES (?, ?, ?, ?, ?, 'user', ?)`,
  ).bind(
    id,
    email,
    passwordData.hash,
    passwordData.salt,
    name || null,
    createdAt,
  ).run();
  const session = await createSession(env, id);
  return json(
    { user: { id, email, name: name || null, role: 'user' } },
    201,
    { 'Set-Cookie': sessionCookie(session.token) },
  );
}

async function authLogin(env, request) {
  const body = await bodyJson(request);
  const email = cleanEmail(body?.email);
  const password = String(body?.password || '');
  if (!validEmail(email) || !password) {
    return json({ error: 'Email and password are required.' }, 400);
  }
  const user = await env.DB.prepare(
    `SELECT id, email, password_hash, password_salt, name, role
       FROM users WHERE email = ? LIMIT 1`,
  ).bind(email).first();
  if (!user) return json({ error: 'Invalid email or password.' }, 401);
  const candidate = await hashPassword(password, user.password_salt);
  if (candidate.hash !== user.password_hash) {
    return json({ error: 'Invalid email or password.' }, 401);
  }
  const session = await createSession(env, user.id);
  return json(
    { user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      } },
    200,
    { 'Set-Cookie': sessionCookie(session.token) },
  );
}

async function authLogout(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    const tokenHash = await sha256(token);
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(tokenHash).run();
  }
  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie('', 0),
  });
}

async function getBook(env, bookId) {
  const book = await env.BOOKS_DB.prepare(
    'SELECT * FROM books WHERE id = ? LIMIT 1',
  ).bind(bookId).first();
  if (!book) return null;
  const bible = await env.BOOKS_DB.prepare(
    'SELECT * FROM story_bibles WHERE book_id = ? LIMIT 1',
  ).bind(bookId).first();
  const state = await env.BOOKS_DB.prepare(
    'SELECT * FROM story_states WHERE book_id = ? LIMIT 1',
  ).bind(bookId).first();
  return {
    ...book,
    story_bible: bible ? {
      identity: safeJsonParse(bible.identity_json),
      world: safeJsonParse(bible.world_json),
      characters: safeJsonParse(bible.characters_json, []),
      relations: safeJsonParse(bible.relations_json, []),
      story: safeJsonParse(bible.story_json),
      timeline: safeJsonParse(bible.timeline_json, []),
      outline: safeJsonParse(bible.chapters_json, []),
      style: safeJsonParse(bible.style_json),
      continuity: safeJsonParse(bible.continuity_json),
      continuation: safeJsonParse(bible.continuation_json),
      canon_locked: Boolean(bible.canon_locked),
      version: bible.version,
    } : null,
    story_state: state ? safeJsonParse(state.state_json) : null,
  };
}

async function getBookChapters(env, bookId) {
  const result = await env.BOOKS_DB.prepare(
    `SELECT id, chapter_number, version_number, title, content,
            outline_json, story_state_json, continuity_report_json,
            status, is_current, created_at
       FROM chapter_versions
      WHERE book_id = ?
      ORDER BY chapter_number ASC, version_number DESC`,
  ).bind(bookId).all();
  return result.results || [];
}

async function getBookContext(env, bookId) {
  const book = await getBook(env, bookId);
  if (!book) return null;
  const [chapters, facts, research, metadata] = await Promise.all([
    getBookChapters(env, bookId),
    env.BOOKS_DB.prepare(
      `SELECT id, fact_key, fact_value, immutable, version,
              reason, created_at, updated_at
         FROM canonical_facts WHERE book_id = ? ORDER BY fact_key`,
    ).bind(bookId).all(),
    env.BOOKS_DB.prepare(
      `SELECT id, title, note, source, where_used, provenance_json,
              created_at, updated_at
         FROM research_notes WHERE book_id = ?
        ORDER BY created_at DESC LIMIT 50`,
    ).bind(bookId).all(),
    env.BOOKS_DB.prepare(
      `SELECT metadata_json, updated_at
         FROM book_metadata
        WHERE book_id = ?
        LIMIT 1`,
    ).bind(bookId).first(),
  ]);
  const bookMetadata = metadata
    ? safeJsonParse(metadata.metadata_json)
    : {};

  return {
    ...book,
    chapters,
    canonical_facts: facts.results || [],
    research_notes: research.results || [],
    book_metadata: bookMetadata,
    series_name: bookMetadata?.creation?.series_name || '',
    series_size: bookMetadata?.creation?.series_size || 0,
    chapter_size: bookMetadata?.creation?.chapter_size || '',
  };
}

function bookTitlePrompt(book) {
  return [
    `Title: ${book.title}`,
    `Subtitle: ${book.subtitle || ''}`,
    `Language: ${book.language || 'pt-PT'}`,
    `Country/context: ${book.country_context || ''}`,
    `Genre: ${book.genre || ''}`,
    `Subgenre: ${book.subgenre || ''}`,
    `Audience: ${book.audience || ''}`,
    `Age rating: ${book.age_rating || ''}`,
    `Desired size: ${book.desired_size || ''}`,
    `Approximate chapters: ${book.approx_chapter_count || 0}`,
    `Series name: ${book.book_metadata?.creation?.series_name || ''}`,
    `Series size: ${book.book_metadata?.creation?.series_size || ''}`,
    `Chapter size: ${book.book_metadata?.creation?.chapter_size || ''}`,
    `Style: ${book.style || ''}`,
    `POV: ${book.pov || ''}`,
    `Tone: ${book.tone || ''}`,
    `Pacing: ${book.pacing || ''}`,
    `Initial idea: ${book.premise || book.description || ''}`,
    `Author references: ${book.author_references || ''}`,
    `Required themes/words: ${book.required_themes || ''}`,
    `Forbidden elements: ${book.forbidden_elements || ''}`,
  ].join('\n');
}

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    concept: { type: 'string' },
    relevant_references: { type: 'array', items: { type: 'string' } },
    historical_context: { type: 'array', items: { type: 'string' } },
    geographic_context: { type: 'array', items: { type: 'string' } },
    cultural_elements: { type: 'array', items: { type: 'string' } },
    possible_problems: { type: 'array', items: { type: 'string' } },
    similar_ideas: { type: 'array', items: { type: 'string' } },
    important_terms: { type: 'array', items: { type: 'string' } },
    unresolved_questions: { type: 'array', items: { type: 'string' } },
    verification_notes: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'concept', 'relevant_references', 'historical_context',
    'geographic_context', 'cultural_elements', 'possible_problems',
    'similar_ideas', 'important_terms', 'unresolved_questions',
    'verification_notes',
  ],
};

const STORY_BIBLE_SCHEMA = {
  type: 'object',
  properties: {
    identity: { type: 'object', additionalProperties: true },
    story: { type: 'object', additionalProperties: true },
    characters: { type: 'array', items: { type: 'object', additionalProperties: true } },
    relations: { type: 'array', items: { type: 'object', additionalProperties: true } },
    world: { type: 'object', additionalProperties: true },
    timeline: { type: 'array', items: { type: 'object', additionalProperties: true } },
    style: { type: 'object', additionalProperties: true },
    continuity: { type: 'object', additionalProperties: true },
    continuation: { type: 'object', additionalProperties: true },
  },
  required: [
    'identity', 'story', 'characters', 'relations', 'world',
    'timeline', 'style', 'continuity', 'continuation',
  ],
};

const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    front_matter: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'included', 'content'],
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          included: { type: 'boolean' },
          content: { type: 'string' },
        },
      },
    },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'number', 'title', 'arc_role', 'objective', 'characters',
          'location', 'conflict', 'turning_point', 'result',
          'cause_forward',
        ],
        properties: {
          number: { type: 'integer' },
          title: { type: 'string' },
          arc_role: { type: 'string' },
          objective: { type: 'string' },
          characters: { type: 'array', items: { type: 'string' } },
          location: { type: 'string' },
          conflict: { type: 'string' },
          turning_point: { type: 'string' },
          result: { type: 'string' },
          cause_forward: { type: 'string' },
        },
      },
    },
    back_matter: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'included', 'content'],
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          included: { type: 'boolean' },
          content: { type: 'string' },
        },
      },
    },
  },
  required: ['front_matter', 'chapters', 'back_matter'],
};

const CHAPTER_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'content', 'summary'],
};

const STORY_STATE_SCHEMA = {
  type: 'object',
  properties: {
    characters: { type: 'array', items: { type: 'object', additionalProperties: true } },
    objects: { type: 'array', items: { type: 'object', additionalProperties: true } },
    knowledge: { type: 'array', items: { type: 'object', additionalProperties: true } },
    open_threads: { type: 'array', items: { type: 'string' } },
    current_events: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'characters', 'objects', 'knowledge',
    'open_threads', 'current_events',
  ],
};

const CONTINUITY_SCHEMA = {
  type: 'object',
  properties: {
    passed_checks: { type: 'integer' },
    problems: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    severity: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['passed_checks', 'problems', 'severity', 'summary'],
};

const QA_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    critical_issues: { type: 'array', items: { type: 'string' } },
    publish_blocked: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['checks', 'critical_issues', 'publish_blocked', 'summary'],
};

const ORIGINALITY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    matches: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    compared_against: { type: 'array', items: { type: 'string' } },
    limitations: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'matches', 'compared_against', 'limitations'],
};

const SEO_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    meta_title: { type: 'string' },
    meta_description: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    short_description: { type: 'string' },
    full_description: { type: 'string' },
    og_title: { type: 'string' },
    og_description: { type: 'string' },
    social_text: { type: 'string' },
    categories: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'slug', 'meta_title', 'meta_description', 'keywords',
    'short_description', 'full_description', 'og_title',
    'og_description', 'social_text', 'categories', 'tags',
  ],
};

function parseAIJsonResponse(result) {
  if (result == null) {
    throw new Error('Workers AI devolveu uma resposta vazia.');
  }

  if (result?.error) {
    throw new Error(
      typeof result.error === 'string'
        ? result.error
        : JSON.stringify(result.error),
    );
  }

  let response = result?.response ?? result?.result?.response ?? result;

  if (response && typeof response === 'object') {
    if (response.response && typeof response.response === 'string') {
      response = response.response;
    } else {
      return response;
    }
  }

  if (typeof response !== 'string') {
    throw new Error('Workers AI devolveu um formato de resposta inesperado.');
  }

  const text = response.trim();
  if (!text) {
    throw new Error('Workers AI devolveu uma resposta vazia.');
  }

  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(text.slice(firstObject, lastObject + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        const repaired = candidate
          .replace(/,\\s*([}\\]])/g, '$1')
          .replace(/([\\{,]\\s*)([A-Za-z_$][A-Za-z0-9_$-]*)\\s*:/g, '$1"$2":');
        return JSON.parse(repaired);
      } catch {
        // Tenta a próxima representação possível.
      }
    }
  }

  throw new Error(
    'Workers AI devolveu JSON inválido. A estrutura foi interrompida ou contém uma propriedade malformada.',
  );
}


function parseChapterSize(value) {
  const text = String(value || '')
    .replace(/\u00a0/g, ' ')
    .trim();
  const match = text.match(/(\d[\d\s.,]*)\s*[\-–—]\s*(\d[\d\s.,]*)/);
  if (!match) {
    return { min: 800, max: 1200, target: 1000 };
  }

  const parseNumber = (part) => Number(
    String(part).replace(/[^0-9]/g, ''),
  ) || 0;

  const first = parseNumber(match[1]);
  const second = parseNumber(match[2]);
  if (!first || !second || second < first) {
    return { min: 800, max: 1200, target: 1000 };
  }

  return {
    min: first,
    max: second,
    target: Math.round((first + second) / 2),
  };
}

function countWords(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function chapterManuscriptIssues(contentValue, range) {
  const content = String(contentValue || '').trim();
  const words = countWords(content);
  const paragraphs = content
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const minimumAcceptable = Math.max(
    120,
    Math.floor(range.min * 0.9),
  );
  const maximumAcceptable = Math.ceil(range.max * 1.05);
  const lower = content.toLowerCase();
  const issues = [];

  if (words < minimumAcceptable) {
    issues.push(
      `demasiado curto: ${words} palavras, alvo ${range.min}-${range.max}`,
    );
  }

  if (words > maximumAcceptable) {
    issues.push(
      `demasiado longo: ${words} palavras, alvo ${range.min}-${range.max}`,
    );
  }

  if (paragraphs.length < 4 && words >= 500) {
    issues.push('tem poucas cenas/parágrafos para um capítulo completo');
  }

  if (
    /resumo do capitulo|resumo deste capitulo|este capitulo conta|esta parte da historia|ao longo da jornada/i.test(lower)
  ) {
    issues.push('parece um resumo da história em vez de uma cena narrativa');
  }

  return { words, paragraphs: paragraphs.length, issues };
}

function validateAIResponse(action, response) {
  if (!response || typeof response !== 'object') {
    throw new Error('A resposta da IA está vazia ou malformada.');
  }

  if (action === 'story_bible') {
    const requiredObjects = [
      'identity',
      'story',
      'world',
      'style',
      'continuity',
      'continuation',
    ];
    const missing = requiredObjects.filter(
      (key) => !response[key]
        || typeof response[key] !== 'object',
    );

    if (
      missing.length
      || !Array.isArray(response.characters)
      || !Array.isArray(response.relations)
      || !Array.isArray(response.timeline)
    ) {
      throw new Error('A Bíblia Oficial recebida está incompleta.');
    }
  }

  if (action === 'structure' || action === 'outline') {
    if (
      !Array.isArray(response.chapters)
      || !response.chapters.length
    ) {
      throw new Error('A estrutura recebida não contém capítulos.');
    }

    const numbers = response.chapters
      .map((item) => Number(item?.number))
      .filter(Number.isInteger);

    if (
      numbers.length !== response.chapters.length
      || new Set(numbers).size !== numbers.length
    ) {
      throw new Error(
        'A estrutura recebida contém capítulos inválidos.',
      );
    }
  }

  if (action === 'chapter') {
    if (
      typeof response.title !== 'string'
      || !response.title.trim()
      || typeof response.content !== 'string'
      || !response.content.trim()
    ) {
      throw new Error('O capítulo recebido está incompleto.');
    }
  }

  return response;
}

function friendlyAIError(error) {
  const message = String(error?.message || error || '').trim();

  if (/json|unterminated|string/i.test(message)) {
    return new Error(
      'A IA não conseguiu concluir esta etapa correctamente. Tenta novamente.',
    );
  }

  if (/timeout|timed out|deadline|busy|overloaded|rate limit|429/i.test(message)) {
    return new Error(
      'A IA está temporariamente ocupada. Tenta novamente dentro de alguns segundos.',
    );
  }

  return new Error(
    'Não foi possível concluir esta etapa com a IA agora. Tenta novamente.',
  );
}

async function runAIJson(env, action, bookId, system, user, schema, adminId) {
  if (!env.AI) {
    throw new Error('Workers AI binding is not configured on this Worker.');
  }

  const jobId = randomId('job');
  const started = now();

  await env.BOOKS_DB.prepare(
    `INSERT INTO ai_jobs
      (id, book_id, action, status, model, created_at, created_by)
     VALUES (?, ?, ?, 'running', ?, ?, ?)`,
  ).bind(jobId, bookId || null, action, TEXT_MODEL, started, adminId).run();

  try {
    const aiRequest = (
      systemPrompt,
      userPrompt,
      structured = true,
      maxTokens = action === 'chapter'
        ? 9000
        : action === 'story_bible'
          ? 6500
          : 5000,
    ) => env.AI.run(
      TEXT_MODEL,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: structured
          ? {
              type: 'json_schema',
              json_schema: schema,
            }
          : {
              type: 'json_object',
            },
        max_tokens: maxTokens,
        temperature: action === 'chapter' ? 0.55 : 0.15,
      },
    );

    const compactRule = [
      'A saída deve ser completa e terminar correctamente.',
      'Mantém cada campo textual curto e directo.',
      'Não repitas informação em várias propriedades.',
      'Não uses markdown nem texto fora do JSON.',
    ].join(' ');

    let result;
    let response;
    let firstError;

    try {
      result = await aiRequest(
        system,
        [user, compactRule].join('\\n\\n'),
        true,
        action === 'chapter'
          ? 9000
          : action === 'story_bible'
            ? 6500
            : 5000,
      );
      response = validateAIResponse(
        action,
        parseAIJsonResponse(result),
      );
    } catch (error) {
      firstError = error;
    }

    if (!response) {
      const retrySystem = [
        system,
        '',
        'A resposta anterior estava incompleta ou inválida.',
        compactRule,
        'Gera tudo novamente desde o início.',
        'Devolve APENAS um JSON válido e completo.',
      ].join('\\n');

      const retryUser = [
        user,
        '',
        'RETRY: JSON compacto, completo e válido.',
      ].join('\\n');

      const retryTokens = action === 'chapter'
        ? 9000
        : action === 'story_bible'
          ? 6500
          : 5000;

      try {
        result = await aiRequest(
          retrySystem,
          retryUser,
          false,
          retryTokens,
        );
        response = validateAIResponse(
          action,
          parseAIJsonResponse(result),
        );
      } catch (secondError) {
        firstError = secondError || firstError;
      }
    }

    if (!response) {
      const finalSystem = [
        system,
        '',
        'ÚLTIMA TENTATIVA.',
        'Responde com o JSON mínimo necessário para cumprir o schema.',
        'Usa frases muito curtas.',
        'Evita listas extensas.',
        'Fecha todas as chaves e colchetes.',
        'Não escrevas nada fora do JSON.',
      ].join('\\n');

      const finalTokens = action === 'chapter'
        ? 8500
        : action === 'story_bible'
          ? 6000
          : 4500;

      try {
        result = await aiRequest(
          finalSystem,
          [user, 'Resposta mínima e completa.'].join('\\n\\n'),
          false,
          finalTokens,
        );
        response = validateAIResponse(
          action,
          parseAIJsonResponse(result),
        );
      } catch (thirdError) {
        throw friendlyAIError(thirdError || firstError);
      }
    }

    await env.BOOKS_DB.prepare(
      `INSERT INTO ai_generations
        (id, job_id, book_id, action, model, input_json,
         output_json, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      randomId('gen'),
      jobId,
      bookId || null,
      action,
      TEXT_MODEL,
      JSON.stringify({ system, user: clip(user, 50000) }),
      JSON.stringify(response),
      now(),
      adminId,
    ).run();

    await env.BOOKS_DB.prepare(
      `UPDATE ai_jobs
          SET status = 'completed', completed_at = ?, error = NULL
        WHERE id = ?`,
    ).bind(now(), jobId).run();

    return response;
  } catch (error) {
    await env.BOOKS_DB.prepare(
      `UPDATE ai_jobs
          SET status = 'failed', completed_at = ?, error = ?
        WHERE id = ?`,
    ).bind(
      now(),
      String(error?.message || error),
      jobId,
    ).run();

    throw error;
  }
}
async function saveResearch(env, bookId, report) {
  await env.BOOKS_DB.prepare(
    `INSERT INTO research_notes
      (id, book_id, title, note, source, where_used,
       provenance_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    randomId('research'),
    bookId,
    'AI Research Report',
    JSON.stringify(report, null, 2),
    'Workers AI · Research synthesis draft',
    'Research stage only — not canon until approved.',
    JSON.stringify({ model: TEXT_MODEL, verified: false }),
    now(),
    now(),
  ).run();
}

async function saveStoryBible(env, bookId, bible, locked = false) {
  await env.BOOKS_DB.prepare(
    `INSERT INTO story_bibles
      (book_id, identity_json, world_json, characters_json,
       relations_json, story_json, timeline_json, chapters_json,
       style_json, continuity_json, continuation_json,
       canon_locked, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(book_id) DO UPDATE SET
       identity_json = excluded.identity_json,
       world_json = excluded.world_json,
       characters_json = excluded.characters_json,
       relations_json = excluded.relations_json,
       story_json = excluded.story_json,
       timeline_json = excluded.timeline_json,
       chapters_json = excluded.chapters_json,
       style_json = excluded.style_json,
       continuity_json = excluded.continuity_json,
       continuation_json = excluded.continuation_json,
       canon_locked = excluded.canon_locked,
       version = story_bibles.version + 1,
       updated_at = excluded.updated_at`,
  ).bind(
    bookId,
    JSON.stringify(bible.identity || {}),
    JSON.stringify(bible.world || {}),
    JSON.stringify(bible.characters || []),
    JSON.stringify(bible.relations || []),
    JSON.stringify(bible.story || {}),
    JSON.stringify(bible.timeline || []),
    JSON.stringify([]),
    JSON.stringify(bible.style || {}),
    JSON.stringify(bible.continuity || {}),
    JSON.stringify(bible.continuation || {}),
    locked ? 1 : 0,
    now(),
  ).run();
}

async function saveOutline(env, bookId, outline) {
  const structure = {
    front_matter: Array.isArray(outline.front_matter)
      ? outline.front_matter : [],
    chapters: Array.isArray(outline.chapters)
      ? outline.chapters : [],
    back_matter: Array.isArray(outline.back_matter)
      ? outline.back_matter : [],
  };
  await env.BOOKS_DB.prepare(
    `UPDATE story_bibles
        SET chapters_json = ?, updated_at = ?
      WHERE book_id = ?`,
  ).bind(JSON.stringify(structure), now(), bookId).run();
}

async function saveChapter(
  env,
  bookId,
  chapterNumber,
  chapter,
  adminId,
  instructions,
  wordCount = countWords(chapter?.content),
  range = parseChapterSize('800-1200'),
) {
  const latest = await env.BOOKS_DB.prepare(
    `SELECT COALESCE(MAX(version_number), 0) AS version
       FROM chapter_versions
      WHERE book_id = ? AND chapter_number = ?`,
  ).bind(bookId, chapterNumber).first();
  const versionNumber = Number(latest?.version || 0) + 1;
  await env.BOOKS_DB.prepare(
    `UPDATE chapter_versions SET is_current = 0
      WHERE book_id = ? AND chapter_number = ?`,
  ).bind(bookId, chapterNumber).run();
  await env.BOOKS_DB.prepare(
    `INSERT INTO chapter_versions
      (id, book_id, chapter_number, version_number, title, content,
       outline_json, story_state_json, continuity_report_json,
       status, is_current, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'draft', 1, ?, ?)`,
  ).bind(
    randomId('chapter'),
    bookId,
    chapterNumber,
    versionNumber,
    chapter.title,
    chapter.content,
    JSON.stringify({
      chapter_number: chapterNumber,
      word_count: wordCount,
      target_range: `${range.min}-${range.max}`,
      instructions: instructions || '',
    }),
    now(),
    adminId,
  ).run();
  await env.BOOKS_DB.prepare(
    `UPDATE books SET status = 'writing', updated_at = ? WHERE id = ?`,
  ).bind(now(), bookId).run();
  return { version: versionNumber };
}

async function saveStoryState(env, bookId, chapterNumber, state) {
  await env.BOOKS_DB.prepare(
    `INSERT INTO story_states
      (id, book_id, chapter_number, state_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET
       chapter_number = excluded.chapter_number,
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`,
  ).bind(
    randomId('state'),
    bookId,
    chapterNumber,
    JSON.stringify(state),
    now(),
    now(),
  ).run();
  return { ok: true };
}

function normalizeTokens(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

function tokenSimilarity(a, b) {
  const left = normalizeTokens(a);
  const right = normalizeTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

async function semanticCandidates(env, bookId, entityType, name, metadata) {
  const local = await env.BOOKS_DB.prepare(
    `SELECT id, canonical_name, aliases_json, metadata_json
       FROM entity_registry
      WHERE entity_type = ? AND book_id != ?
      ORDER BY updated_at DESC LIMIT 200`,
  ).bind(entityType, bookId).all();
  const target = `${name} ${JSON.stringify(metadata || {})}`;
  const candidates = (local.results || [])
    .map((item) => {
      const aliases = safeJsonParse(item.aliases_json, []);
      const existing = `${item.canonical_name} ${aliases.join(' ')} ${item.metadata_json || ''}`;
      return {
        ...item,
        score: Number(tokenSimilarity(target, existing).toFixed(3)),
      };
    })
    .filter((item) => item.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return {
    candidates,
    vectorize_enabled: Boolean(env.BOOKS_VECTORIZE),
    embedding_model: env.BOOKS_VECTORIZE ? EMBED_MODEL : null,
  };
}

async function adminAI(request, env, admin) {
  const body = await bodyJson(request);
  const action = String(body?.action || '').trim();
  const bookId = String(body?.book_id || '').trim();
  if (action !== 'health' && !bookId) {
    return json({ error: 'Select a book first.' }, 400);
  }
  if (action === 'health') {
    return json({
      configured: Boolean(env.AI),
      text_model: TEXT_MODEL,
      image_model: IMAGE_MODEL,
      vectorize: Boolean(env.BOOKS_VECTORIZE),
    });
  }
  const context = await getBookContext(env, bookId);
  if (!context) return json({ error: 'Book not found.' }, 404);
  const base = bookTitlePrompt(context);

  if (action === 'research') {
    const report = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Researcher. Analyze a book idea before creative canon is created. Produce a research draft, not a definitive fact database. Separate likely references from items that require human verification. Never silently convert research into canon. Return only JSON matching the schema.',
      `${base}\n\nResearch stage requirement: identify relevant context, references, possible factual risks, similar ideas and questions that must be resolved.`,
      RESEARCH_SCHEMA,
      admin.user_id,
    );
    await saveResearch(env, bookId, report);
    return json({ ok: true, action, report });
  }

  if (action === 'story_bible') {
    if (context.story_bible?.canon_locked) {
      return json({
        error: 'A Bíblia Oficial já foi aprovada e está bloqueada.',
      }, 409);
    }

    const bible = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Official Story Bible Architect. Create the definitive creative canon from the author inputs only. Never write chapter prose. The Bible must be detailed enough that another writer can write the entire book without inventing canon. Preserve the exact title, premise, genre, series requirements and chapter-size requirements. Build: identity with title, genre, subgenre, logline, synopsis and format; story with central conflict, stakes, themes, beginning, inciting incident, midpoint, climax, resolution and protagonist arc; characters with stable ids, role, identity, wants, needs, flaw, arc, relationships and knowledge boundaries; relations; world with setting, time, culture, rules and limitations; timeline in causal order; style with POV, tense, voice, tone, pacing and dialogue guidance; continuity with immutable facts, must-not-change rules and unresolved threads; continuation with this book\'s ending plus future-safe series threads. Never invent a named place, person, object or rule that is not supported by the author premise or by another element of the Bible you are defining. Keep core fields concise, but complete. Maximum 8 characters, 12 relations and 12 timeline milestones. Return only JSON matching the schema.',
      `${base}\n\nBook requirements:\n- Genre: ${context.genre || 'Not specified'}\n- Series name: ${context.series_name || 'Standalone'}\n- Series size: ${context.series_size || 'Not specified'}\n- Chapter size: ${context.chapter_size || context.desired_size || 'Not specified'}\n\nCreate the Official Story Bible now.`,
      STORY_BIBLE_SCHEMA,
      admin.user_id,
    );
    await saveStoryBible(env, bookId, bible, false);
    await env.BOOKS_DB.prepare(
      `UPDATE books SET status = 'planning', updated_at = ? WHERE id = ?`,
    ).bind(now(), bookId).run();
    return json({ ok: true, action, bible, locked: false });
  }

  if (action === 'approve_bible') {
    if (!context.story_bible) {
      return json({ error: 'Cria a Bíblia Oficial primeiro.' }, 400);
    }

    await env.BOOKS_DB.prepare(
      `UPDATE story_bibles
          SET canon_locked = 1,
              version = version + 1,
              updated_at = ?
        WHERE book_id = ?`,
    ).bind(now(), bookId).run();

    return json({
      ok: true,
      action,
      locked: true,
      bible: (await getBookContext(env, bookId)).story_bible,
    });
  }

  if (action === 'structure' || action === 'outline') {
    if (!context.story_bible?.canon_locked) {
      return json({
        error: 'A Bíblia Oficial precisa ser aprovada antes de criar o livro.',
      }, 400);
    }
    const structure = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Editorial Structure Planner. Create the complete chapter map for this one book from the locked Story Bible. Use European Portuguese. Structure must follow causality: an event creates a consequence, which creates the next problem. Start with setup and inciting incident, build escalating complications and a meaningful midpoint, drive toward a climax, then resolve the central conflict and protagonist arc. For each chapter provide: arc_role, a concrete objective, only canon characters, canon location, concrete conflict, turning point, result, and cause_forward explaining what this chapter causes next. Titles must describe a specific story event rather than generic labels such as "A Verdade", "A Batalha" or "O Futuro". Do not introduce characters, locations, objects, powers, facts or relationships absent from the locked Bible. The final chapter must actually conclude this book unless the Bible explicitly says it is a continuation. Plan 12 chapters by default, maximum 16, unless the story clearly needs another count. Include only useful front/back matter. Keep each field to one short sentence. Never write chapter prose. Return only JSON matching the schema.',
      `Book:\n${clip(base, 10000)}\n\nStory Bible:\n${clip(context.story_bible, 18000)}\n\nRequested approximate chapter count: ${context.approx_chapter_count || 'AI may choose based on the story'}. Target chapter size: ${context.book_metadata?.creation?.chapter_size || 'not specified'}. Series size: ${context.book_metadata?.creation?.series_size || 'not specified'}. Create a concise editorial skeleton now.`,
      OUTLINE_SCHEMA,
      admin.user_id,
    );
    await saveOutline(env, bookId, structure);
    await env.BOOKS_DB.prepare(
      `UPDATE books SET status = 'planning', updated_at = ? WHERE id = ?`,
    ).bind(now(), bookId).run();
    return json({ ok: true, action: 'structure', structure });
  }

  if (action === 'chapter') {
    if (!context.story_bible?.canon_locked) {
      return json({
        error: 'A Bíblia Oficial precisa ser aprovada antes de escrever o livro.',
      }, 400);
    }
    const chapterNumber = Math.max(1, Number(body?.chapter_number || 1));
    const structure = context.story_bible?.outline;
    const plannedChapters = Array.isArray(structure?.chapters)
      ? structure.chapters
      : Array.isArray(structure) ? structure : [];
    const requestedOutline = plannedChapters.find(
      (item) => Number(item.number) === chapterNumber,
    );
    if (!requestedOutline) {
      return json({
        error: 'Prepara primeiro a estrutura do livro. Este capítulo ainda não tem título nem plano.',
      }, 400);
    }
    const currentChapter = context.chapters.find(
      (item) => Number(item.chapter_number) === chapterNumber
        && Number(item.is_current) === 1,
    );
    const previous = context.chapters.filter(
      (item) => Number(item.chapter_number) < chapterNumber
        && Number(item.is_current) === 1,
    ).slice(-2);
    const instructions = String(body?.instructions || '').trim();
    const language = String(
      body?.language || context.language || 'pt-PT',
    ).trim() || 'pt-PT';
    const requestedTitle = String(
      body?.title || requestedOutline.title || `Capítulo ${chapterNumber}`,
    ).trim();
    if (chapterNumber > 1) {
      const previousNumber = chapterNumber - 1;
      const previousWritten = context.chapters.some(
        (item) => Number(item.chapter_number) === previousNumber
          && Number(item.is_current) === 1
          && String(item.content || '').trim(),
      );

      if (!previousWritten) {
        return json({
          error: `Escreve primeiro o capítulo ${previousNumber}. A escrita é sequencial para proteger a continuidade da história.`,
        }, 409);
      }
    }

    const range = parseChapterSize(
      context.book_metadata?.creation?.chapter_size
        || context.chapter_size
        || context.desired_size,
    );

    const chapterSystem = `You are the NexaurenBooks Writer. Write exactly one finished book chapter in ${language}. The approved chapter title is fixed and must not change. The locked Story Bible is the highest authority, followed by locked canonical facts, current Story State, approved chapter plan and relevant previous chapters. Never invent canon. Never introduce a new named person, named location, object, rule, relationship, age, backstory or knowledge state unless it already exists in the authoritative context.

Write MANUSCRIPT PROSE, not a synopsis or summary. Start inside a concrete scene. Dramatize the events: show actions, setting, sensory detail, decisions, consequences and character reactions. Use natural dialogue when the scene benefits from it. Let scenes unfold instead of saying that characters "faced challenges", "discovered secrets" or "went on a journey". Avoid exposition dumps, generic reflections, chapter-summary language, meta-commentary and writing-process language. Every scene must change the situation or deepen a character conflict. End on the approved result or a concrete hook that leads to the next chapter. The content field must contain prose only; do not repeat the title inside content. Return only JSON matching the schema.`;

    const chapterUser = `Language: ${language}

Fixed chapter number: ${chapterNumber}
Fixed chapter title: ${requestedTitle}
Required chapter size: ${range.min}-${range.max} words
Target: approximately ${range.target} words

QUALITY GATE:
- Produce a real chapter, not a summary.
- Stay within the requested word range.
- Use multiple paragraphs and concrete scenes.
- Do not skip major events with phrases such as "dias depois" unless the approved plan requires a time jump.
- Never add "Lisboa", another city, a new country or another named place unless it is explicitly present in the Story Bible.
- Never add characters outside the approved cast.
- Do not end with a generic moral or summary unless the plan explicitly requires it.

Story Bible:
${clip(context.story_bible, 18000)}

Canonical facts:
${clip(context.canonical_facts, 6000)}

Story State:
${clip(context.story_state || {}, 6000)}

Relevant previous chapters:
${clip(previous, 9000)}

Approved chapter plan:
${clip(requestedOutline, 7000)}

Existing current version (regeneration target):
${clip(currentChapter || {}, 5000)}

Admin instructions:
${instructions}

Generate chapter ${chapterNumber} now.`;

    let chapter;
    let manuscriptCheck;
    let lastIssues = [];

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const regeneration = attempt === 1
        ? ''
        : `

REGENERATION REQUIRED:
The previous draft failed the manuscript quality gate:
- ${lastIssues.join('; ')}
Write the entire chapter again from the beginning. Do not shorten it into a summary. Stay inside the requested range.
`;

      chapter = await runAIJson(
        env,
        action,
        bookId,
        chapterSystem + regeneration,
        chapterUser,
        CHAPTER_SCHEMA,
        admin.user_id,
      );

      chapter.title = requestedTitle;
      chapter.summary = String(chapter.summary || '').trim();
      manuscriptCheck = chapterManuscriptIssues(
        chapter.content,
        range,
      );

      if (!manuscriptCheck.issues.length) break;
      lastIssues = manuscriptCheck.issues;
      chapter = null;
    }

    if (!chapter || !manuscriptCheck?.words) {
      return json({
        error: `A IA não conseguiu produzir um capítulo completo dentro do tamanho definido (${range.min}-${range.max} palavras). Tenta novamente.`,
      }, 502);
    }

    const saved = await saveChapter(
      env,
      bookId,
      chapterNumber,
      chapter,
      admin.user_id,
      instructions,
      manuscriptCheck.words,
      range,
    );

    return json({
      ok: true,
      action,
      chapter,
      word_count: manuscriptCheck.words,
      target_range: `${range.min}-${range.max}`,
      version: saved.version,
    });
  }

  if (action === 'story_state') {
    const chapterNumber = Math.max(1, Number(body?.chapter_number || 1));
    const chapter = context.chapters.find(
      (item) => Number(item.chapter_number) === chapterNumber
        && Number(item.is_current) === 1,
    );
    if (!chapter) return json({ error: 'Generate or select a current chapter first.' }, 400);
    const state = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Story State Manager. Read the current chapter against the Story Bible and canonical facts. Record only state changes supported by the chapter. Do not invent future facts. Return only JSON.',
      `Story Bible:\n${clip(context.story_bible, 22000)}\n\nCanonical facts:\n${clip(context.canonical_facts, 10000)}\n\nPrevious Story State:\n${clip(context.story_state || {}, 12000)}\n\nChapter ${chapterNumber}:\n${clip(chapter.content, 30000)}`,
      STORY_STATE_SCHEMA,
      admin.user_id,
    );
    await saveStoryState(env, bookId, chapterNumber, state);
    return json({ ok: true, action, state });
  }

  if (action === 'continuity') {
    const chapterNumber = Math.max(1, Number(body?.chapter_number || 1));
    const chapter = context.chapters.find(
      (item) => Number(item.chapter_number) === chapterNumber
        && Number(item.is_current) === 1,
    );
    if (!chapter) return json({ error: 'Current chapter not found.' }, 400);
    const report = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Continuity Checker. Verify names, ages, locations, presence, knowledge, objects, relationships, chronology, repeated events and established characteristics. Compare against Story Bible, canonical facts and current Story State. Report concrete problems and counts. Never declare a problem solved without evidence.',
      `Story Bible:\n${clip(context.story_bible, 24000)}\n\nCanonical facts:\n${clip(context.canonical_facts, 12000)}\n\nStory State:\n${clip(context.story_state || {}, 12000)}\n\nChapter ${chapterNumber}:\n${clip(chapter.content, 32000)}`,
      CONTINUITY_SCHEMA,
      admin.user_id,
    );
    await env.BOOKS_DB.prepare(
      `INSERT INTO continuity_checks
        (id, book_id, chapter_number, report_json, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      randomId('continuity'),
      bookId,
      chapterNumber,
      JSON.stringify(report),
      report.severity || 'info',
      now(),
    ).run();
    return json({ ok: true, action, report });
  }

  if (action === 'qa') {
    const qa = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Publication QA Agent. Evaluate whether this book is ready for publication. Check Story Bible, Characters, Timeline, Chapters, Continuity, Grammar/Style at a high level, Ending, Metadata and available digital formats. A critical issue must block publication. Return JSON only.',
      `Book:\n${clip(context, 50000)}\n\nEvaluate publication readiness.`,
      QA_SCHEMA,
      admin.user_id,
    );
    await env.BOOKS_DB.prepare(
      `INSERT INTO qa_runs
        (id, book_id, kind, result_json, status, created_at)
       VALUES (?, ?, 'full', ?, 'completed', ?)`,
    ).bind(randomId('qa'), bookId, JSON.stringify(qa), now()).run();
    return json({ ok: true, action, qa });
  }

  if (action === 'originality') {
    const catalog = await env.BOOKS_DB.prepare(
      `SELECT id, title, author, genre, premise FROM books
        WHERE id != ? ORDER BY created_at DESC LIMIT 100`,
    ).bind(bookId).all();
    const originality = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Originality Checker. Compare the current concept and text against the provided Nexauren Books catalogue sample. Never state that a work is 100% original. Describe meaningful similarities and the limits of the check. Return JSON only.',
      `Current book:\n${clip(context, 35000)}\n\nNexauren Books catalogue sample:\n${clip(catalog.results || [], 16000)}\n\nReturn a careful comparison report.`,
      ORIGINALITY_SCHEMA,
      admin.user_id,
    );
    await env.BOOKS_DB.prepare(
      `INSERT INTO originality_checks
        (id, book_id, status, result_json, created_at, created_by)
       VALUES (?, ?, 'completed', ?, ?, ?)`,
    ).bind(
      randomId('originality'),
      bookId,
      JSON.stringify(originality),
      now(),
      admin.user_id,
    ).run();
    return json({ ok: true, action, originality });
  }

  if (action === 'seo') {
    const seo = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Metadata and SEO Agent. Create accurate, non-clickbait metadata based only on the book context. Return JSON only.',
      `Book context:\n${clip(context, 42000)}\n\nGenerate publication SEO metadata.`,
      SEO_SCHEMA,
      admin.user_id,
    );
    await env.BOOKS_DB.prepare(
      `UPDATE books
          SET slug = ?, seo_title = ?, seo_description = ?,
              seo_keywords = ?,
              description = COALESCE(NULLIF(?, ''), description),
              updated_at = ?
        WHERE id = ?`,
    ).bind(
      `${slugify(seo.slug || context.title)}-${bookId.slice(-6)}`,
      seo.meta_title,
      seo.meta_description,
      JSON.stringify(seo.keywords || []),
      seo.full_description || seo.short_description || '',
      now(),
      bookId,
    ).run();
    await env.BOOKS_DB.prepare(
      `INSERT INTO seo_metadata
        (book_id, slug, seo_title, seo_description, keywords_json,
         og_title, og_description, structured_data_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         slug = excluded.slug,
         seo_title = excluded.seo_title,
         seo_description = excluded.seo_description,
         keywords_json = excluded.keywords_json,
         og_title = excluded.og_title,
         og_description = excluded.og_description,
         structured_data_json = excluded.structured_data_json,
         updated_at = excluded.updated_at`,
    ).bind(
      bookId,
      seo.slug,
      seo.meta_title,
      seo.meta_description,
      JSON.stringify(seo.keywords || []),
      seo.og_title,
      seo.og_description,
      JSON.stringify({
        short_description: seo.short_description || '',
        social_text: seo.social_text || '',
        categories: seo.categories || [],
        tags: seo.tags || [],
      }),
      now(),
    ).run();
    return json({ ok: true, action, seo });
  }

  return json({ error: 'Unknown AI action.' }, 400);
}


function inspectBookCompletion(context) {
  const structure = context?.story_bible?.outline;
  const plannedChapters = Array.isArray(structure?.chapters)
    ? structure.chapters
    : Array.isArray(structure) ? structure : [];

  const currentChapters = (context?.chapters || [])
    .filter((item) => Number(item.is_current) === 1)
    .sort((a, b) => Number(a.chapter_number) - Number(b.chapter_number));

  const range = parseChapterSize(
    context?.book_metadata?.creation?.chapter_size
      || context?.chapter_size
      || context?.desired_size,
  );

  const byNumber = new Map(
    currentChapters.map((item) => [
      Number(item.chapter_number),
      item,
    ]),
  );

  const missingChapters = [];
  const invalidChapters = [];
  let wordCount = 0;

  for (const planned of plannedChapters) {
    const number = Number(planned?.number);
    const chapter = byNumber.get(number);

    if (!chapter || !String(chapter.content || '').trim()) {
      missingChapters.push(number);
      continue;
    }

    const words = countWords(chapter.content);
    wordCount += words;

    const minimumAcceptable = Math.max(
      120,
      Math.floor(range.min * 0.9),
    );
    const maximumAcceptable = Math.ceil(range.max * 1.05);

    if (
      words < minimumAcceptable
      || words > maximumAcceptable
    ) {
      invalidChapters.push(number);
    }
  }

  return {
    plannedCount: plannedChapters.length,
    writtenCount: currentChapters.length,
    wordCount,
    targetRange: `${range.min}-${range.max}`,
    missingChapters,
    invalidChapters,
    complete: Boolean(
      context?.story_bible?.canon_locked
      && plannedChapters.length
      && !missingChapters.length
      && !invalidChapters.length
    ),
  };
}

async function adminApi(request, env) {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'Admin access required.' }, 403);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/admin/overview' && method === 'GET') {
    const [books, published, drafts, review, users, orders, tools, posts] = await Promise.all([
      env.BOOKS_DB.prepare('SELECT COUNT(*) AS total FROM books').first(),
      env.BOOKS_DB.prepare("SELECT COUNT(*) AS total FROM books WHERE status = 'published'").first(),
      env.BOOKS_DB.prepare("SELECT COUNT(*) AS total FROM books WHERE status IN ('draft','research','planning','writing')").first(),
      env.BOOKS_DB.prepare("SELECT COUNT(*) AS total FROM books WHERE status = 'review'").first(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM users').first(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM orders').first(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM tools').first(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM blog_posts').first(),
    ]);
    const revenue = await env.DB.prepare(
      "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS total FROM orders WHERE status IN ('COMPLETED','CAPTURED','APPROVED')",
    ).first();
    const aiJobs = await env.BOOKS_DB.prepare(
      'SELECT COUNT(*) AS total FROM ai_jobs WHERE created_at >= ?',
    ).bind(now() - 86400).first();
    return json({
      books: {
        total: Number(books?.total || 0),
        published: Number(published?.total || 0),
        drafts: Number(drafts?.total || 0),
        review: Number(review?.total || 0),
      },
      platform: {
        users: Number(users?.total || 0),
        orders: Number(orders?.total || 0),
        tools: Number(tools?.total || 0),
        posts: Number(posts?.total || 0),
        revenue: Number(revenue?.total || 0),
      },
      ai: {
        configured: Boolean(env.AI),
        jobs_last_24h: Number(aiJobs?.total || 0),
        text_model: TEXT_MODEL,
        image_model: IMAGE_MODEL,
        vectorize: Boolean(env.BOOKS_VECTORIZE),
      },
    });
  }

  if (path === '/api/admin/books' && method === 'GET') {
    const result = await env.BOOKS_DB.prepare(
      `SELECT id, slug, title, subtitle, author, genre, subgenre,
              price_usd, currency, language, audience, age_rating,
              status, cover_url, pdf_available, epub_available,
              created_at, updated_at, published_at
         FROM books ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json({ items: result.results || [] });
  }

  if (path === '/api/admin/books' && method === 'POST') {
    const body = await bodyJson(request);
    const title = String(body?.title || '').trim();
    if (!title) return json({ error: 'Book title is required.' }, 400);
    const createdAt = now();
    const id = randomId('book');
    const slug = `${slugify(title)}-${id.slice(-6)}`;
    const validStatuses = [
      'draft', 'research', 'planning', 'writing',
      'review', 'published', 'archived',
    ];
    const status = validStatuses.includes(body?.status)
      ? body.status
      : 'draft';
    const price = Number(body?.price_usd || 0).toFixed(2);
    const seriesName = String(body?.series_name || '').trim();
    const seriesSize = Math.max(0, Math.floor(Number(body?.series_size || 0)));
    const chapterSize = String(body?.chapter_size || '').trim();
    const publishedAt = status === 'published' ? createdAt : null;

    await env.BOOKS_DB.prepare(
      `INSERT INTO books
        (id, slug, title, subtitle, author, description, language,
         genre, subgenre, audience, age_rating, style, desired_size,
         approx_chapter_count, premise, price_usd, currency, status,
         cover_url, preview_url, pdf_available, epub_available,
         seo_title, seo_description, seo_keywords, created_at,
         updated_at, published_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD',
               ?, NULL, NULL, 1, 1, NULL, NULL, NULL, ?, ?, ?, ?)`,
    ).bind(
      id,
      slug,
      title,
      String(body?.subtitle || '').trim() || null,
      String(body?.author || 'Nexauren').trim() || 'Nexauren',
      String(body?.description || '').trim() || null,
      String(body?.language || 'pt-PT').trim() || 'pt-PT',
      String(body?.genre || '').trim() || null,
      String(body?.subgenre || '').trim() || null,
      String(body?.audience || '').trim() || null,
      String(body?.age_rating || '').trim() || null,
      String(body?.style || '').trim() || null,
      String(body?.desired_size || '').trim() || null,
      Math.max(0, Math.floor(Number(body?.approx_chapter_count || 0))),
      String(body?.premise || '').trim() || null,
      price,
      status,
      createdAt,
      createdAt,
      publishedAt,
      admin.user_id,
    ).run();

    const productId = `prd_book_${id}`;
    await env.DB.prepare(
      `INSERT INTO products
        (id, type, external_id, title, description, price_usd,
         currency, credits, status, created_at, updated_at)
       VALUES (?, 'book', ?, ?, ?, ?, 'USD', 0, ?, ?, ?)`,
    ).bind(
      productId,
      id,
      title,
      String(body?.description || '').trim() || null,
      price,
      status === 'published' ? 'active' : 'draft',
      createdAt,
      createdAt,
    ).run();

    await env.BOOKS_DB.prepare(
      `INSERT INTO book_metadata
        (book_id, metadata_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      JSON.stringify({
        creation: {
          series_name: seriesName,
          series_size: seriesSize,
          chapter_size: chapterSize,
        },
        publication: {
          author: String(body?.author || 'Nexauren').trim() || 'Nexauren',
          language: String(body?.language || 'pt-PT').trim() || 'pt-PT',
          audience: String(body?.audience || '').trim(),
          age_rating: String(body?.age_rating || '').trim(),
          price_usd: price,
          currency: 'USD',
          pdf: true,
          epub: true,
        },
      }),
      createdAt,
    ).run();

    return json({ ok: true, id, slug }, 201);
  }

  const bookMatch = path.match(/^\/api\/admin\/books\/([^/]+)$/);
  if (bookMatch && method === 'GET') {
    const context = await getBookContext(env, bookMatch[1]);
    if (!context) return json({ error: 'Book not found.' }, 404);
    return json({ book: context });
  }

  if (bookMatch && ['PATCH', 'POST'].includes(method)) {
    const bookId = bookMatch[1];
    const book = await getBook(env, bookId);
    if (!book) return json({ error: 'Book not found.' }, 404);
    const body = await bodyJson(request);
    const allowedStatuses = [
      'draft', 'research', 'planning', 'writing',
      'review', 'approved', 'published', 'archived',
    ];
    const fields = [];
    const values = [];
    const editable = [
      'title', 'subtitle', 'author', 'description', 'language',
      'genre', 'subgenre', 'audience', 'age_rating', 'style',
      'desired_size', 'premise', 'cover_url', 'preview_url',
      'seo_title', 'seo_description', 'seo_keywords', 'price_usd',
    ];
    for (const field of editable) {
      if (body && Object.prototype.hasOwnProperty.call(body, field)) {
        fields.push(`${field} = ?`);
        values.push(field === 'price_usd'
          ? Number(body[field] || 0).toFixed(2)
          : body[field]);
      }
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'status')) {
      if (!allowedStatuses.includes(body.status)) {
        return json({ error: 'Invalid book status.' }, 400);
      }

      if (body.status === 'published') {
        const bible = await env.BOOKS_DB.prepare(
          `SELECT canon_locked
             FROM story_bibles
            WHERE book_id = ?
            LIMIT 1`,
        ).bind(bookId).first();

        const completionContext = await getBookContext(
          env,
          bookId,
        );
        const completion = inspectBookCompletion(
          completionContext || book,
        );

        if (!Number(bible?.canon_locked)) {
          return json({
            error: 'A Bíblia Oficial precisa estar aprovada antes da publicação.',
          }, 400);
        }

        if (!completion.plannedCount) {
          return json({
            error: 'Cria primeiro a estrutura completa do livro.',
          }, 400);
        }

        if (!completion.complete) {
          const missing = completion.missingChapters.length
            ? ` capítulos em falta: ${completion.missingChapters.join(', ')}.`
            : '';
          const invalid = completion.invalidChapters.length
            ? ` capítulos fora do tamanho definido: ${completion.invalidChapters.join(', ')}.`
            : '';

          return json({
            error: `O livro ainda não está pronto para publicação.${missing || invalid || ' Completa todos os capítulos e valida o manuscrito.'}`,
          }, 400);
        }
      }

      fields.push('status = ?');
      values.push(body.status === 'approved' ? 'review' : body.status);

      if (body.status === 'published') {
        fields.push('published_at = COALESCE(published_at, ?)');
        values.push(now());
      }
    }
    if (!fields.length) return json({ error: 'No changes supplied.' }, 400);
    fields.push('updated_at = ?');
    values.push(now(), bookId);

    await env.BOOKS_DB.prepare(
      `UPDATE books SET ${fields.join(', ')} WHERE id = ?`,
    ).bind(...values).run();

    if (body && Object.prototype.hasOwnProperty.call(body, 'status')) {
      const productStatus = body.status === 'published'
        ? 'active'
        : 'draft';

      await env.DB.prepare(
        `UPDATE products
            SET status = ?, updated_at = ?
          WHERE type = 'book' AND external_id = ?`,
      ).bind(productStatus, now(), bookId).run();
    }

    return json({
      ok: true,
      book: await getBook(env, bookId),
    });
  }

  if (path === '/api/admin/series' && method === 'GET') {
    return json({ items: [] });
  }

  if (path === '/api/admin/series' && method === 'POST') {
    return json({
      error: 'A gestão de séries está desativada nesta versão do Books Studio.',
    }, 501);
  }

  if (path === '/api/admin/canon' && method === 'GET') {
    const bookId = url.searchParams.get('book_id');
    if (!bookId) return json({ error: 'book_id is required.' }, 400);
    const result = await env.BOOKS_DB.prepare(
      `SELECT id, fact_key, fact_value, immutable, version,
              reason, created_at, updated_at
         FROM canonical_facts WHERE book_id = ? ORDER BY fact_key`,
    ).bind(bookId).all();
    const changes = await env.BOOKS_DB.prepare(
      `SELECT id, fact_id, old_value, new_value, reason,
              created_by, created_at
         FROM canon_changes WHERE book_id = ?
        ORDER BY created_at DESC LIMIT 100`,
    ).bind(bookId).all();
    return json({
      facts: result.results || [],
      changes: changes.results || [],
    });
  }

  if (path === '/api/admin/canon' && method === 'POST') {
    const body = await bodyJson(request);
    const bookId = String(body?.book_id || '').trim();
    const factKey = String(body?.fact_key || '').trim();
    const factValue = String(body?.fact_value || '').trim();
    const reason = String(body?.reason || 'Manual canon update').trim();
    if (!bookId || !factKey || !factValue) {
      return json({ error: 'book_id, fact_key and fact_value are required.' }, 400);
    }
    const existing = await env.BOOKS_DB.prepare(
      `SELECT * FROM canonical_facts
        WHERE book_id = ? AND fact_key = ? LIMIT 1`,
    ).bind(bookId, factKey).first();
    const version = Number(existing?.version || 0) + 1;
    if (existing) {
      await env.BOOKS_DB.prepare(
        `UPDATE canonical_facts
            SET fact_value = ?, immutable = ?, version = ?,
                reason = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(
        factValue,
        body?.immutable ? 1 : Number(existing.immutable || 0),
        version,
        reason,
        now(),
        existing.id,
      ).run();
      if (existing.fact_value !== factValue) {
        await env.BOOKS_DB.prepare(
          `INSERT INTO canon_changes
            (id, book_id, fact_id, old_value, new_value,
             reason, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          randomId('canonchange'),
          bookId,
          existing.id,
          existing.fact_value,
          factValue,
          reason,
          admin.user_id,
          now(),
        ).run();
      }
    } else {
      await env.BOOKS_DB.prepare(
        `INSERT INTO canonical_facts
          (id, book_id, fact_key, fact_value, immutable, version,
           reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(
        randomId('canon'),
        bookId,
        factKey,
        factValue,
        body?.immutable ? 1 : 0,
        reason,
        now(),
        now(),
      ).run();
    }
    return json({ ok: true });
  }

  if (path === '/api/admin/registry/check' && method === 'POST') {
    const body = await bodyJson(request);
    const bookId = String(body?.book_id || '').trim();
    const entityType = String(body?.entity_type || 'character').trim();
    const name = String(body?.canonical_name || '').trim();
    if (!bookId || !name) return json({ error: 'Book and name are required.' }, 400);
    return json({ ok: true, query: { entityType, name }, ...await semanticCandidates(
      env, bookId, entityType, name, body?.metadata || {},
    ) });
  }

  if (path === '/api/admin/registry' && method === 'POST') {
    const body = await bodyJson(request);
    const bookId = String(body?.book_id || '').trim();
    const entityType = String(body?.entity_type || 'character').trim();
    const name = String(body?.canonical_name || '').trim();
    if (!bookId || !name) return json({ error: 'Book and name are required.' }, 400);
    await env.BOOKS_DB.prepare(
      `INSERT INTO entity_registry
        (id, book_id, entity_type, canonical_name, aliases_json,
         metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      randomId('entity'),
      bookId,
      entityType,
      name,
      JSON.stringify(body?.aliases || []),
      JSON.stringify(body?.metadata || {}),
      now(),
      now(),
    ).run();
    return json({ ok: true });
  }

  if (path === '/api/admin/ai' && method === 'POST') {
    try {
      return await adminAI(request, env, admin);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || 'Workers AI request failed.' }, 500);
    }
  }

  if (path === '/api/admin/cover' && method === 'POST') {
    if (!env.AI) return json({ error: 'Workers AI binding is not configured.' }, 503);
    const body = await bodyJson(request);
    const bookId = String(body?.book_id || '').trim();
    const book = await getBook(env, bookId);
    if (!book) return json({ error: 'Book not found.' }, 404);
    const prompt = String(body?.prompt || '').trim()
      || `${book.genre || 'literary'} book cover, ${book.style || 'editorial'} aesthetic, ${book.premise || book.title}, title-safe composition, no readable text`;
    const result = await env.AI.run(IMAGE_MODEL, {
      prompt,
      seed: Math.floor(Math.random() * 1000000000),
    });
    if (!result?.image) return json({ error: 'Cover generation returned no image.' }, 502);
    const dataUri = `data:image/jpeg;base64,${result.image}`;
    const id = randomId('cover');
    await env.BOOKS_DB.prepare(
      `INSERT INTO covers
        (id, book_id, prompt, model, data_uri, is_selected,
         created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(id, bookId, prompt, IMAGE_MODEL, dataUri, now(), admin.user_id).run();
    return json({ ok: true, id, data_uri: dataUri });
  }

  if (path === '/api/admin/cover/select' && method === 'POST') {
    const body = await bodyJson(request);
    const coverId = String(body?.cover_id || '').trim();
    const cover = await env.BOOKS_DB.prepare(
      'SELECT id, book_id FROM covers WHERE id = ? LIMIT 1',
    ).bind(coverId).first();
    if (!cover) return json({ error: 'Cover not found.' }, 404);
    await env.BOOKS_DB.prepare(
      'UPDATE covers SET is_selected = 0 WHERE book_id = ?',
    ).bind(cover.book_id).run();
    await env.BOOKS_DB.prepare(
      'UPDATE covers SET is_selected = 1 WHERE id = ?',
    ).bind(coverId).run();
    await env.BOOKS_DB.prepare(
      'UPDATE books SET cover_url = ?, updated_at = ? WHERE id = ?',
    ).bind(
      `/api/books/${encodeURIComponent(cover.book_id)}/cover`,
      now(),
      cover.book_id,
    ).run();
    return json({ ok: true });
  }

  if (path === '/api/admin/covers' && method === 'GET') {
    const bookId = url.searchParams.get('book_id');
    if (!bookId) return json({ error: 'book_id is required.' }, 400);
    const result = await env.BOOKS_DB.prepare(
      `SELECT id, book_id, prompt, model, provider, is_selected AS selected, created_at
         FROM covers WHERE book_id = ?
        ORDER BY created_at DESC LIMIT 30`,
    ).bind(bookId).all();
    return json({ items: result.results || [] });
  }

  if (path === '/api/admin/files' && method === 'GET') {
    const bookId = url.searchParams.get('book_id');
    if (!bookId) return json({ error: 'book_id is required.' }, 400);

    const context = await getBookContext(env, bookId);
    if (!context) return json({ error: 'Book not found.' }, 404);

    const completion = inspectBookCompletion(context);

    return json({
      generated_on_demand: true,
      formats: ['pdf', 'epub'],
      chapters: completion.writtenCount,
      planned_chapters: completion.plannedCount,
      word_count: completion.wordCount,
      target_range: completion.targetRange,
      complete: completion.complete,
      can_generate_pdf: completion.complete,
      missing_chapters: completion.missingChapters,
      invalid_chapters: completion.invalidChapters,
      note: completion.complete
        ? 'O PDF está pronto para ser gerado a partir do manuscrito aprovado.'
        : 'Completa e valida todos os capítulos antes de gerar o PDF final.',
    });
  }

  if (
    path === '/api/admin/files/download'
    && method === 'GET'
  ) {
    const bookId = url.searchParams.get('book_id');
    const format = String(
      url.searchParams.get('format') || 'pdf',
    ).toLowerCase();

    if (!bookId) return json({ error: 'book_id is required.' }, 400);
    if (format !== 'pdf') {
      return json({
        error: 'Este botão gera actualmente apenas o PDF.',
      }, 400);
    }

    const context = await getBookContext(env, bookId);
    if (!context) return json({ error: 'Book not found.' }, 404);

    const completion = inspectBookCompletion(context);
    if (!completion.complete) {
      return json({
        error: 'O livro ainda não está completo. Escreve e valida todos os capítulos antes de gerar o PDF.',
      }, 409);
    }

    const chapters = context.chapters
      .filter((item) => Number(item.is_current) === 1)
      .sort((a, b) => Number(a.chapter_number) - Number(b.chapter_number));

    const structure = context.story_bible?.outline || null;
    const filename = `${slugify(context.title) || 'nexauren-book'}.pdf`;
    const bytes = buildPdf(
      context.title,
      context.author || 'Nexauren',
      chapters,
      structure,
      context.subtitle || '',
      context.language || 'pt-PT',
    );

    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'private, no-store',
      },
    });
  }

  if (path === '/api/admin/sales' && method === 'GET') {
    const bookId = url.searchParams.get('book_id');
    const productId = bookId ? `prd_book_${bookId}` : null;
    const query = productId
      ? env.DB.prepare(
          `SELECT COUNT(*) AS orders,
                  COALESCE(SUM(CAST(amount AS REAL)), 0) AS revenue
             FROM orders
            WHERE product_id = ?
              AND status IN ('COMPLETED','CAPTURED','APPROVED')`,
        ).bind(productId)
      : env.DB.prepare(
          `SELECT COUNT(*) AS orders,
                  COALESCE(SUM(CAST(amount AS REAL)), 0) AS revenue
             FROM orders
            WHERE status IN ('COMPLETED','CAPTURED','APPROVED')`,
        );
    const row = await query.first();
    return json({
      orders: Number(row?.orders || 0),
      revenue: Number(row?.revenue || 0),
      currency: 'USD',
    });
  }

  if (path === '/api/admin/settings' && method === 'GET') {
    return json({
      ai: {
        configured: Boolean(env.AI),
        text_model: TEXT_MODEL,
        image_model: IMAGE_MODEL,
      },
      semantic_search: {
        configured: Boolean(env.BOOKS_VECTORIZE),
        embedding_model: env.BOOKS_VECTORIZE ? EMBED_MODEL : null,
      },
      storage: {
        mode: 'on-demand',
        external_object_storage_required: false,
        formats: ['PDF', 'EPUB'],
      },
    });
  }

  if (path === '/api/admin/tools' && method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT id, slug, title, description, category, route, status,
              created_at, updated_at
         FROM tools ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json({ items: result.results || [] });
  }

  if (path === '/api/admin/tools' && method === 'POST') {
    const body = await bodyJson(request);
    const title = String(body?.title || '').trim();
    const route = String(body?.route || '').trim();
    if (!title || !route) return json({ error: 'Tool name and route are required.' }, 400);
    const createdAt = now();
    const id = randomId('tool');
    await env.DB.prepare(
      `INSERT INTO tools
        (id, slug, title, description, category, route, status,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    ).bind(
      id,
      slugify(title),
      title,
      String(body?.description || '').trim() || null,
      String(body?.category || 'general').trim() || 'general',
      route,
      createdAt,
      createdAt,
    ).run();
    return json({ ok: true, id }, 201);
  }

  if (path === '/api/admin/samples' && method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT id, type, title, description, price_usd, status,
              created_at, updated_at
         FROM products
        WHERE type IN ('sample', 'midi', 'preset')
        ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json({ items: result.results || [] });
  }

  if (path === '/api/admin/samples' && method === 'POST') {
    const body = await bodyJson(request);
    const title = String(body?.title || '').trim();
    const type = ['sample', 'midi', 'preset'].includes(body?.type)
      ? body.type : 'sample';
    if (!title) return json({ error: 'Product name is required.' }, 400);
    const createdAt = now();
    const id = randomId('prd');
    const price = Number(body?.price_usd || 0).toFixed(2);
    await env.DB.prepare(
      `INSERT INTO products
        (id, type, title, description, price_usd, currency, credits,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'USD', 0, 'draft', ?, ?)`,
    ).bind(
      id,
      type,
      title,
      String(body?.description || '').trim() || null,
      price,
      createdAt,
      createdAt,
    ).run();
    return json({ ok: true, id }, 201);
  }

  if (path === '/api/admin/blog' && method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT id, slug, title, excerpt, author_name, status,
              created_at, updated_at, published_at
         FROM blog_posts ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json({ items: result.results || [] });
  }

  if (path === '/api/admin/blog' && method === 'POST') {
    const body = await bodyJson(request);
    const title = String(body?.title || '').trim();
    if (!title) return json({ error: 'Post title is required.' }, 400);
    const createdAt = now();
    const id = randomId('post');
    const slug = `${slugify(title)}-${id.slice(-6)}`;
    await env.DB.prepare(
      `INSERT INTO blog_posts
        (id, slug, title, excerpt, content, cover_url, author_name,
         status, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(
      id,
      slug,
      title,
      String(body?.excerpt || '').trim() || null,
      String(body?.content || ''),
      String(body?.cover_url || '').trim() || null,
      String(body?.author_name || 'Nexauren').trim() || 'Nexauren',
      createdAt,
      createdAt,
      admin.user_id,
    ).run();
    return json({ ok: true, id, slug }, 201);
  }

  return json({ error: 'Admin API route not found.' }, 404);
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function winAnsiBytes(value) {
  const special = {
    '€': 0x80,
    '‚': 0x82,
    'ƒ': 0x83,
    '„': 0x84,
    '…': 0x85,
    '†': 0x86,
    '‡': 0x87,
    'ˆ': 0x88,
    '‰': 0x89,
    'Š': 0x8a,
    '‹': 0x8b,
    'Œ': 0x8c,
    'Ž': 0x8e,
    '‘': 0x91,
    '’': 0x92,
    '“': 0x93,
    '”': 0x94,
    '•': 0x95,
    '–': 0x96,
    '—': 0x97,
    '˜': 0x98,
    '™': 0x99,
    'š': 0x9a,
    '›': 0x9b,
    'œ': 0x9c,
    'ž': 0x9e,
    'Ÿ': 0x9f,
  };

  const output = [];
  for (const char of String(value ?? '')) {
    const code = char.codePointAt(0);
    if (code <= 0xff) {
      output.push(code);
    } else if (special[char] != null) {
      output.push(special[char]);
    } else {
      output.push(0x3f);
    }
  }
  return new Uint8Array(output);
}

function pdfLiteralBytes(value) {
  const source = winAnsiBytes(value);
  const output = [];

  for (const byte of source) {
    if (
      byte === 0x28
      || byte === 0x29
      || byte === 0x5c
    ) {
      output.push(0x5c);
    }

    output.push(byte);
  }

  return new Uint8Array(output);
}

function asciiBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

function wrapPdfText(value, maxChars) {
  const text = String(value ?? '')
    .replace(/\r/g, '')
    .trim();

  if (!text) return [''];

  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current
      ? `${current} ${word}`
      : word;

    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function buildPdf(
  title,
  author,
  chapters,
  structure = null,
  subtitle = '',
  language = 'pt-PT',
) {
  const pageWidth = 432;
  const pageHeight = 648;
  const marginX = 48;
  const topY = 575;
  const bottomY = 48;
  const leading = 14;
  const maxBodyLines = 36;
  const pages = [];

  const normalized = structure && typeof structure === 'object'
    ? structure
    : {};

  const frontMatter = Array.isArray(normalized.front_matter)
    ? normalized.front_matter.filter(
        (item) => item?.included !== false
          && String(item?.content || '').trim(),
      )
    : [];

  const backMatter = Array.isArray(normalized.back_matter)
    ? normalized.back_matter.filter(
        (item) => item?.included !== false
          && String(item?.content || '').trim(),
      )
    : [];

  const addPage = (kind = 'body') => {
    const page = { kind, lines: [] };
    pages.push(page);
    return page;
  };

  const addLines = (page, lines) => {
    for (const line of lines) {
      page.lines.push(line);
    }
  };

  const addParagraphsToPages = (paragraphs) => {
    let page = pages.at(-1) || addPage();

    for (const paragraph of paragraphs) {
      const lines = wrapPdfText(paragraph, 56);

      if (page.lines.length && page.lines.length + lines.length + 1 > maxBodyLines) {
        page = addPage();
      }

      page.lines.push('');
      page.lines.push(...lines);
    }

    return page;
  };

  const titlePage = addPage('title');
  addLines(titlePage, [
    '',
    '',
    title,
    subtitle,
    '',
    `Por ${author || 'Nexauren'}`,
    '',
    '',
    'NEXAURENBOOKS',
  ]);

  const copyrightPage = addPage('copyright');
  addLines(copyrightPage, [
    '',
    'Direitos de autor',
    '',
    `Copyright © ${new Date().getFullYear()} ${author || 'Nexauren'}.`,
    'Todos os direitos reservados.',
    '',
    'Esta edição digital foi preparada pela NexaurenBooks.',
    `Idioma: ${language || 'pt-PT'}`,
  ]);

  for (const item of frontMatter) {
    const type = String(item.type || '').toLowerCase();
    const heading = String(item.title || 'Secção inicial').trim();
    if (
      type.includes('contents')
      || type.includes('index')
      || heading.toLowerCase() === 'índice'
    ) {
      continue;
    }

    const page = addPage('front');
    page.lines.push('', heading, '');
    const paragraphs = String(item.content || '')
      .replace(/\r/g, '')
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    addParagraphsToPages(paragraphs);
  }

  const contentsPage = addPage('toc');
  addLines(contentsPage, ['', 'Índice', '']);
  for (const chapter of chapters) {
    const lines = wrapPdfText(
      `Capítulo ${chapter.chapter_number} · ${chapter.title || 'Sem título'}`,
      56,
    );
    if (contentsPage.lines.length + lines.length + 1 > maxBodyLines) {
      addPage('toc');
    }
    const target = pages.at(-1);
    target.lines.push(...lines, '');
  }

  for (const chapter of chapters) {
    let page = addPage('chapter');
    page.lines.push('', `Capítulo ${chapter.chapter_number}`, chapter.title || 'Sem título', '');

    const paragraphs = String(chapter.content || '')
      .replace(/\r/g, '')
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      const lines = wrapPdfText(paragraph, 56);

      if (page.lines.length + lines.length + 1 > maxBodyLines) {
        page = addPage('body');
      }

      page.lines.push(...lines, '');
    }
  }

  for (const item of backMatter) {
    const heading = String(item.title || 'Secção final').trim();
    const page = addPage('back');
    page.lines.push('', heading, '');
    const paragraphs = String(item.content || '')
      .replace(/\r/g, '')
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    addParagraphsToPages(paragraphs);
  }

  if (!chapters.length) {
    addPage('body').lines.push(
      '',
      'O manuscrito ainda não contém capítulos.',
    );
  }

  const objects = [
    null,
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  const pageIds = [];
  const contentIds = [];
  const pagesId = 2;
  const fontId = 3;

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    pageIds.push(objects.length + 1);
    contentIds.push(objects.length + 2);

    const commands = [];
    const addText = (textValue, fontSize, x, y) => {
      commands.push(
        asciiBytes(
          `BT /F1 ${fontSize} Tf 1 0 0 1 ${x} ${y} Tm (`,
        ),
        pdfLiteralBytes(textValue),
        asciiBytes(') Tj ET\\n'),
      );
    };

    let y = topY;

    for (let lineIndex = 0; lineIndex < page.lines.length; lineIndex += 1) {
      const line = page.lines[lineIndex];

      if (page.kind === 'title' && lineIndex === 2) {
        addText(line, 24, marginX, y);
        y -= 30;
        continue;
      }

      if (
        page.kind === 'title'
        && lineIndex === 5
      ) {
        addText(line, 12, marginX, y);
        y -= 24;
        continue;
      }

      const fontSize = page.kind === 'chapter'
        && lineIndex === 1 ? 16
        : page.kind === 'chapter'
          && lineIndex === 2 ? 11
          : 10.5;

      if (line) {
        addText(
          line,
          fontSize,
          marginX,
          y,
        );
      }

      y -= page.kind === 'chapter' && lineIndex <= 2
        ? 22
        : leading;

      if (y < bottomY + 16) break;
    }

    if (page.kind !== 'title') {
      addText(
        String(index),
        8.5,
        pageWidth / 2 - 4,
        bottomY - 14,
      );
    }

    const streamParts = commands;
    const streamLength = streamParts.reduce(
      (total, item) => total + item.length,
      0,
    );

    objects.push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds.at(-1)} 0 R >>`,
    );

    objects.push({
      streamParts,
      streamLength,
    });
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;

  const header = asciiBytes('%PDF-1.4\\n%NEXAUREN\\n');
  const chunks = [header];
  const offsets = [0];
  let position = header.length;

  for (let i = 0; i < objects.length; i += 1) {
    const number = i + 1;
    const object = objects[i];

    if (typeof object === 'string') {
      const body = asciiBytes(
        `${number} 0 obj\\n${object}\\nendobj\\n`,
      );
      offsets[number] = position;
      chunks.push(body);
      position += body.length;
      continue;
    }

    const prefix = asciiBytes(
      `${number} 0 obj\\n<< /Length ${object.streamLength} >>\\nstream\\n`,
    );
    const suffix = asciiBytes('endstream\\nendobj\\n');
    offsets[number] = position;
    chunks.push(prefix);

    for (const part of object.streamParts) chunks.push(part);

    chunks.push(suffix);
    position += prefix.length
      + object.streamLength
      + suffix.length;
  }

  const xrefOffset = position;
  chunks.push(
    asciiBytes(
      `xref\\n0 ${objects.length + 1}\\n`,
    ),
  );
  chunks.push(asciiBytes('0000000000 65535 f \\n'));

  for (let i = 1; i <= objects.length; i += 1) {
    chunks.push(
      asciiBytes(
        `${String(offsets[i]).padStart(10, '0')} 00000 n \\n`,
      ),
    );
  }

  chunks.push(
    asciiBytes(
      `trailer\\n<< /Size ${objects.length + 1} /Root 1 0 R >>\\nstartxref\\n${xrefOffset}\\n%%EOF`,
    ),
  );

  return concatBytes(chunks);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

function u32(value) {
  return new Uint8Array([
    value & 255,
    (value >>> 8) & 255,
    (value >>> 16) & 255,
    (value >>> 24) & 255,
  ]);
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function zipStore(files) {
  const encoder = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array
      ? file.data
      : encoder.encode(file.data);
    const crc = crc32(data);
    const localHeader = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(name.length), u16(0), name,
    ]);
    local.push(localHeader, data);
    const centralHeader = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
      u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name,
    ]);
    central.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const centralData = concatBytes(central);
  const localData = concatBytes(local);
  const end = concatBytes([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralData.length), u32(localData.length), u16(0),
  ]);
  return concatBytes([localData, centralData, end]);
}

function buildEpub(title, author, chapters, structure = null, language = 'pt-PT') {
  const files = [
    { name: 'mimetype', data: 'application/epub+zip' },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    },
  ];
  const manifest = [];
  const spine = [];
  const navItems = [];
  const normalized = structure && typeof structure === 'object'
    ? structure : {};
  const frontMatter = Array.isArray(normalized.front_matter)
    ? normalized.front_matter.filter((item) => item?.included !== false)
    : [];
  const backMatter = Array.isArray(normalized.back_matter)
    ? normalized.back_matter.filter((item) => item?.included !== false)
    : [];
  const addXhtml = (id, filename, heading, content, navTitle) => {
    manifest.push(`<item id="${id}" href="${filename}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navItems.push(`<li><a href="${filename}">${xmlEscape(navTitle || heading)}</a></li>`);
    const body = String(content || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${xmlEscape(line)}</p>`)
      .join('');
    files.push({
      name: `OEBPS/${filename}`,
      data: `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xmlEscape(heading)}</title></head><body><h1>${xmlEscape(heading)}</h1>${body}</body></html>`,
    });
  };

  addXhtml('titlepage', 'title-page.xhtml', title, author, title);

  frontMatter.forEach((item, index) => {
    const type = String(item.type || '').toLowerCase();
    const titleText = String(item.title || `Secção inicial ${index + 1}`);
    if (type.includes('contents') || type.includes('index') || titleText.toLowerCase() === 'índice') return;
    addXhtml(`front${index + 1}`, `front-${index + 1}.xhtml`, titleText, item.content || '', titleText);
  });

  addXhtml('contents', 'contents.xhtml', 'Índice', chapters
    .map((chapter) => `${chapter.chapter_number} · ${chapter.title || 'Sem título'}`)
    .join('\n'), 'Índice');

  chapters.forEach((chapter, index) => {
    const id = `chap${index + 1}`;
    const filename = `chapter-${index + 1}.xhtml`;
    const body = String(chapter.content || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${xmlEscape(line)}</p>`)
      .join('');
    manifest.push(`<item id="${id}" href="${filename}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navItems.push(`<li><a href="${filename}">Capítulo ${chapter.chapter_number}: ${xmlEscape(chapter.title || 'Sem título')}</a></li>`);
    files.push({
      name: `OEBPS/${filename}`,
      data: `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xmlEscape(chapter.title || `Capítulo ${chapter.chapter_number}`)}</title></head><body><h1>Capítulo ${xmlEscape(chapter.chapter_number)} · ${xmlEscape(chapter.title || 'Sem título')}</h1>${body}</body></html>`,
    });
  });

  backMatter.forEach((item, index) => {
    const titleText = String(item.title || `Secção final ${index + 1}`);
    addXhtml(`back${index + 1}`, `back-${index + 1}.xhtml`, titleText, item.content || '', titleText);
  });

  files.push({
    name: 'OEBPS/nav.xhtml',
    data: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body><nav epub:type="toc"><ol>${navItems.join('')}</ol></nav></body></html>`,
  });
  files.push({
    name: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">nexauren:${slugify(title)}-${slugify(author)}</dc:identifier><dc:title>${xmlEscape(title)}</dc:title><dc:creator>${xmlEscape(author)}</dc:creator><dc:language>${xmlEscape(language || 'pt-PT')}</dc:language></metadata><manifest>${manifest.join('')}<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine>${spine.join('')}</spine></package>`,
  });
  return zipStore(files);
}

async function getDownloadBook(env, slug) {
  return env.BOOKS_DB.prepare(
    `SELECT * FROM books WHERE slug = ? AND status = 'published' LIMIT 1`,
  ).bind(slug).first();
}

async function canDownload(env, request, book) {
  const user = await requireUser(env, request);
  if (Number(book.price_usd || 0) <= 0) return { allowed: true, user };
  if (!user) return { allowed: false, user: null };
  const purchase = await env.DB.prepare(
    `SELECT p.id FROM purchases p
       WHERE p.user_id = ? AND p.product_id = ?
         AND p.status = 'ACTIVE' LIMIT 1`,
  ).bind(user.user_id, `prd_book_${book.id}`).first();
  return { allowed: Boolean(purchase), user };
}

async function publicBooksApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/books' && request.method === 'GET') {
    const result = await env.BOOKS_DB.prepare(
      `SELECT id, slug, title, subtitle, author, description,
              language, genre, subgenre, audience, age_rating,
              price_usd, currency, cover_url, preview_url,
              published_at, 1 AS pdf_available, 1 AS epub_available
         FROM books WHERE status = 'published'
        ORDER BY published_at DESC, created_at DESC LIMIT 200`,
    ).all();
    const items = await Promise.all((result.results || []).map(async (book) => {
      const cover = await env.BOOKS_DB.prepare(
        `SELECT id FROM covers WHERE book_id = ?
           AND is_selected = 1 LIMIT 1`,
      ).bind(book.id).first();
      return {
        ...book,
        cover_url: cover
          ? `/api/books/${encodeURIComponent(book.id)}/cover`
          : book.cover_url,
      };
    }));
    return json({ books: items });
  }

  const coverIdMatch = path.match(/^\/api\/books\/([^/]+)\/cover$/);
  if (coverIdMatch && request.method === 'GET') {
    const book = await env.BOOKS_DB.prepare(
      `SELECT id FROM books
        WHERE id = ? AND status = 'published' LIMIT 1`,
    ).bind(coverIdMatch[1]).first();
    if (!book) return new Response('Not found', { status: 404 });
    const cover = await env.BOOKS_DB.prepare(
      `SELECT data_uri FROM covers
        WHERE book_id = ? AND is_selected = 1 LIMIT 1`,
    ).bind(book.id).first();
    if (!cover?.data_uri) return new Response('Not found', { status: 404 });
    const match = String(cover.data_uri).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return new Response('Invalid cover', { status: 500 });
    return new Response(base64ToBytes(match[2]), {
      status: 200,
      headers: {
        'content-type': match[1],
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const bookMatch = path.match(/^\/api\/books\/([^/]+)$/);
  if (bookMatch && request.method === 'GET') {
    const slug = decodeURIComponent(bookMatch[1]);
    const book = await getDownloadBook(env, slug);
    if (!book) return json({ error: 'Book not found.' }, 404);
    const product = await env.DB.prepare(
      `SELECT id, title, price_usd, currency, status
         FROM products
        WHERE type = 'book' AND external_id = ? LIMIT 1`,
    ).bind(book.id).first();
    const cover = await env.BOOKS_DB.prepare(
      `SELECT id FROM covers WHERE book_id = ?
         AND is_selected = 1 LIMIT 1`,
    ).bind(book.id).first();
    return json({
      book: {
        ...book,
        cover_url: cover
          ? `/api/books/${encodeURIComponent(book.id)}/cover`
          : book.cover_url,
        pdf_available: 1,
        epub_available: 1,
        product: product || null,
      },
    });
  }

  const downloadMatch = path.match(/^\/api\/books\/([^/]+)\/download$/);
  if (downloadMatch && request.method === 'GET') {
    const slug = decodeURIComponent(downloadMatch[1]);
    const format = String(url.searchParams.get('format') || 'pdf').toLowerCase();
    if (!['pdf', 'epub'].includes(format)) {
      return json({ error: 'Supported formats: pdf, epub.' }, 400);
    }
    const book = await getDownloadBook(env, slug);
    if (!book) return json({ error: 'Book not found.' }, 404);
    const access = await canDownload(env, request, book);
    if (!access.allowed) {
      return json({ error: 'Sign in and purchase this book before downloading.' }, 403);
    }
    const chapters = (await getBookChapters(env, book.id))
      .filter((item) => Number(item.is_current) === 1)
      .sort((a, b) => Number(a.chapter_number) - Number(b.chapter_number));
    const bookContext = await getBook(env, book.id);
    const structure = bookContext?.story_bible?.outline || null;
    const filename = `${slugify(book.title) || 'nexauren-book'}.${format}`;
    const bytes = format === 'pdf'
      ? buildPdf(
          book.title,
          book.author,
          chapters,
          structure,
          book.subtitle || '',
          book.language || 'pt-PT',
        )
      : buildEpub(
          book.title,
          book.author,
          chapters,
          structure,
          book.language || 'pt-PT',
        );
    await env.BOOKS_DB.prepare(
      `INSERT INTO download_logs
        (id, book_id, file_type, user_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      randomId('download'),
      book.id,
      format,
      access.user?.user_id || null,
      now(),
    ).run();
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': format === 'pdf'
          ? 'application/pdf' : 'application/epub+zip',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'private, no-store',
      },
    });
  }
  return json({ error: 'Books API route not found.' }, 404);
}

async function paypalApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/paypal/config' && request.method === 'GET') {
    return json({
      configured: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
      client_id: env.PAYPAL_CLIENT_ID || null,
      environment: env.PAYPAL_ENVIRONMENT || 'sandbox',
    });
  }
  return json({ error: 'PayPal is not configured for this action yet.' }, 503);
}

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  try {
    if (path.startsWith('/api/admin/')) return adminApi(request, env);
    if (path.startsWith('/api/books')) return publicBooksApi(request, env);
    if (path.startsWith('/api/paypal/')) return paypalApi(request, env);
    if (path === '/api/health' && method === 'GET') {
      return json({
        ok: true,
        service: 'nexauren',
        time: new Date().toISOString(),
        ai: Boolean(env.AI),
      });
    }
    if (path === '/api/auth/register' && method === 'POST') return authRegister(env, request);
    if (path === '/api/auth/login' && method === 'POST') return authLogin(env, request);
    if (path === '/api/auth/logout' && method === 'POST') return authLogout(env, request);
    if (path === '/api/auth/me' && method === 'GET') {
      const user = await requireUser(env, request);
      return json({
        user: user ? {
          id: user.user_id,
          email: user.email,
          name: user.name,
          role: user.role,
        } : null,
      });
    }
    if (path === '/api/account' && method === 'GET') {
      const user = await requireUser(env, request);
      if (!user) return json({ user: null });
      const credits = await env.DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
           FROM credit_ledger WHERE user_id = ?`,
      ).bind(user.user_id).first();
      const purchases = await env.DB.prepare(
        `SELECT p.id, p.product_id, p.status, p.created_at,
                pr.title, pr.type
           FROM purchases p JOIN products pr ON pr.id = p.product_id
          WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 100`,
      ).bind(user.user_id).all();
      return json({
        user: {
          id: user.user_id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        credits: Number(credits?.total || 0),
        purchases: purchases.results || [],
      });
    }
    return json({ error: 'API route not found.' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Unexpected server error.' }, 500);
  }
}

async function asset(request, env, path) {
  const response = await env.ASSETS.fetch(request);
  if (path.startsWith('/admin')) {
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store, no-cache, must-revalidate');
    headers.set('pragma', 'no-cache');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith('/api/')) return api(request, env);
    if (
      path === '/admin' ||
      path === '/admin/' ||
      (path.startsWith('/admin/') && !path.startsWith('/admin/login'))
    ) {
      const admin = await requireAdmin(env, request);
      if (!admin) {
        return new Response('Not found', {
          status: 404,
          headers: { 'cache-control': 'no-store' },
        });
      }
    }
    if (env.ASSETS) return asset(request, env, path);
    return new Response('Nexauren Worker is running.', { status: 200 });
  },
};
