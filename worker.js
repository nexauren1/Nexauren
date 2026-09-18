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
  const [chapters, facts, research] = await Promise.all([
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
  ]);
  return {
    ...book,
    chapters,
    canonical_facts: facts.results || [],
    research_notes: research.results || [],
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
          'number', 'title', 'objective', 'characters',
          'location', 'conflict', 'result',
        ],
        properties: {
          number: { type: 'integer' },
          title: { type: 'string' },
          objective: { type: 'string' },
          characters: { type: 'array', items: { type: 'string' } },
          location: { type: 'string' },
          conflict: { type: 'string' },
          result: { type: 'string' },
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
    const aiRequest = (systemPrompt, userPrompt) => env.AI.run(
      TEXT_MODEL,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: schema,
        },
        max_tokens: 8192,
        temperature: 0.1,
      },
    );

    let result = await aiRequest(system, user);
    let response;

    try {
      response = parseAIJsonResponse(result);
    } catch (firstError) {
      const retrySystem = [
        system,
        '',
        'IMPORTANT: A resposta anterior não pôde ser lida.',
        'Gere novamente desde o início.',
        'Devolva APENAS um JSON válido e completo.',
        'Não uses markdown, comentários ou texto fora do JSON.',
        'Mantém os textos curtos para garantir que todo o JSON termina corretamente.',
        'Não uses aspas duplas dentro de valores de texto sem as escapar.',
      ].join('\\n');

      const retryUser = [
        user,
        '',
        'RETRY: responde novamente com JSON completo, compacto e válido.',
      ].join('\\n');

      result = await aiRequest(retrySystem, retryUser);
      try {
        response = parseAIJsonResponse(result);
      } catch {
        throw firstError;
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
    ).bind(now(), String(error?.message || error), jobId).run();

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

async function saveStoryBible(env, bookId, bible) {
  await env.BOOKS_DB.prepare(
    `INSERT INTO story_bibles
      (book_id, identity_json, world_json, characters_json,
       relations_json, story_json, timeline_json, chapters_json,
       style_json, continuity_json, continuation_json,
       canon_locked, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
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

async function saveChapter(env, bookId, chapterNumber, chapter, adminId, instructions) {
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
    const research = context.research_notes
      .slice(0, 3)
      .map((item) => clip(item.note, 10000))
      .join('\n---\n');
    const bible = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Story Architect, Character Designer and World Builder. Build a structured Story Bible from the author idea and research draft. Research is advisory, not canon. Use stable IDs such as char_kael_01 and loc_porto_01. Keep every field explicit enough for later continuity checks. Never invent a citation. Return only JSON matching the schema.',
      `${base}\n\nResearch draft (not canon):\n${clip(research, 24000)}\n\nCreate the Story Bible now.`,
      STORY_BIBLE_SCHEMA,
      admin.user_id,
    );
    await saveStoryBible(env, bookId, bible);
    await env.BOOKS_DB.prepare(
      `UPDATE books SET status = 'planning', updated_at = ? WHERE id = ?`,
    ).bind(now(), bookId).run();
    return json({ ok: true, action, bible });
  }

  if (action === 'structure' || action === 'outline') {
    const structure = await runAIJson(
      env,
      action,
      bookId,
      'You are the NexaurenBooks Editorial Structure Planner. Build a complete practical book structure from the Story Bible using European Portuguese. Always return these opening elements as included=true for a normal book: title page, copyright page, dedication, presentation, preface and introduction. Also return an epigraph entry as included=true when the story benefits from one. Return a contents/index entry with included=true, but its content must be empty because the system creates it from the chapter list. Then return every planned chapter with a stable number, a specific title, an objective, characters, location, conflict and result. Finally return useful closing elements such as acknowledgements or an author note when appropriate. The structure must be coherent and ready for PDF and EPUB. Never contradict locked canon. Return only JSON matching the schema.',
      `Book:\n${clip(base, 14000)}\n\nStory Bible:\n${clip(context.story_bible, 30000)}\n\nRequested approximate chapter count: ${context.approx_chapter_count || 0}. Create the editorial structure now.`,
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
    const chapter = await runAIJson(
      env,
      action,
      bookId,
      `You are the NexaurenBooks Writer. Write exactly one chapter in ${language}. The chapter title is fixed by the approved structure and must not be changed. The Story Bible, locked canonical facts and current Story State are authoritative. Follow the approved chapter plan. Do not change names, ages, relationships, world rules, chronology or knowledge states. Do not add a different chapter number. Return only JSON matching the schema. The content field must contain the chapter prose only; do not repeat the title inside content.`,
      `Language: ${language}\n\nFixed chapter number: ${chapterNumber}\nFixed chapter title: ${requestedTitle}\n\nStory Bible:\n${clip(context.story_bible, 26000)}\n\nCanonical facts:\n${clip(context.canonical_facts, 12000)}\n\nStory State:\n${clip(context.story_state || {}, 12000)}\n\nRelevant previous chapters:\n${clip(previous, 18000)}\n\nApproved chapter plan:\n${clip(requestedOutline, 9000)}\n\nExisting current version (regeneration target):\n${clip(currentChapter || {}, 10000)}\n\nAdmin instructions:\n${instructions}\n\nGenerate chapter ${chapterNumber} now.`,
      CHAPTER_SCHEMA,
      admin.user_id,
    );
    chapter.title = requestedTitle;
    chapter.summary = String(chapter.summary || '').trim();
    const saved = await saveChapter(
      env,
      bookId,
      chapterNumber,
      chapter,
      admin.user_id,
      instructions,
    );
    return json({ ok: true, action, chapter, version: saved.version });
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
      `INSERT OR IGNORE INTO story_bibles
        (book_id, identity_json, world_json, characters_json,
         relations_json, story_json, timeline_json, chapters_json,
         style_json, continuity_json, continuation_json,
         canon_locked, version, updated_at)
       VALUES (?, ?, '{}', '[]', '[]', '{}', '[]', '[]',
               '{}', '{}', '{}', 0, 1, ?)`,
    ).bind(
      id,
      JSON.stringify({
        title,
        subtitle: body?.subtitle || '',
        language: body?.language || 'en',
        country_context: body?.country_context || '',
        genre: body?.genre || '',
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
    return json({ ok: true, book: await getBook(env, bookId) });
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
    const chapters = await getBookChapters(env, bookId);
    return json({
      generated_on_demand: true,
      formats: ['pdf', 'epub'],
      chapters: chapters.filter((item) => Number(item.is_current) === 1).length,
      note: 'Files are generated from the approved text when requested; no external object storage is required.',
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

function textEscapePdf(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(value, max = 88) {
  const words = String(value || '').replace(/\r/g, '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildPdf(title, author, chapters, structure = null) {
  const pages = [];
  let pageLines = [title, `Por ${author}`, ''];
  const normalized = structure && typeof structure === 'object'
    ? structure : {};
  const frontMatter = Array.isArray(normalized.front_matter)
    ? normalized.front_matter.filter((item) => item?.included !== false)
    : [];
  const backMatter = Array.isArray(normalized.back_matter)
    ? normalized.back_matter.filter((item) => item?.included !== false)
    : [];
  const flush = () => {
    if (pageLines.length) pages.push([...pageLines]);
    pageLines = [];
  };
  const addSection = (heading, content = '') => {
    for (const line of ['', heading, '', ...wrapText(content, 92), '']) {
      if (pageLines.length >= 47) flush();
      pageLines.push(line);
    }
  };

  for (const item of frontMatter) {
    const type = String(item.type || '').toLowerCase();
    const titleText = String(item.title || 'Secção inicial');
    if (type.includes('contents') || type.includes('index') || titleText.toLowerCase() === 'índice') continue;
    addSection(titleText, item.content || '');
  }

  if (chapters.length) {
    addSection('Índice', chapters
      .map((chapter) => `${chapter.chapter_number} · ${chapter.title || 'Sem título'}`)
      .join('\n'));
  }

  for (const chapter of chapters) {
    const heading = `Capítulo ${chapter.chapter_number}: ${chapter.title || ''}`.trim();
    const headingLines = wrapText(heading, 54);
    const bodyLines = String(chapter.content || '')
      .replace(/\r/g, '')
      .split(/\n+/)
      .flatMap((line) => {
        const text = line.trim();
        return text ? wrapText(text, 92) : [''];
      });
    for (const line of ['', ...headingLines, '', ...bodyLines, '']) {
      if (pageLines.length >= 47) flush();
      pageLines.push(line);
    }
  }

  for (const item of backMatter) {
    addSection(item.title || 'Secção final', item.content || '');
  }

  flush();
  if (!pages.length) pages.push([title, `Por ${author}`, '', 'O livro está pronto para receber conteúdo.']);

  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pageIds = [];
  const contentIds = [];
  const pagesId = 2;
  const fontId = 3;

  for (const lines of pages) {
    pageIds.push(objects.length + 1);
    contentIds.push(objects.length + 2);
    const commands = ['BT', '/F1 18 Tf', '54 770 Td'];
    commands.push(`(${textEscapePdf(lines[0] || title)}) Tj`);
    commands.push('/F1 11 Tf', '0 -24 Td');
    for (let i = 1; i < lines.length; i += 1) {
      commands.push(`(${textEscapePdf(lines[i])}) Tj`, '0 -14 Td');
    }
    commands.push('ET');
    const stream = commands.join('\n');
    objects.push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds.at(-1)} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  objects[0] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;

  const header = '%PDF-1.4\n%NEXAUREN\n';
  const chunks = [header];
  const offsets = [0];
  let position = header.length;
  for (let i = 0; i < objects.length; i += 1) {
    const number = i + 1;
    const body = `${number} 0 obj\n${objects[i]}\nendobj\n`;
    offsets[number] = position;
    chunks.push(body);
    position += body.length;
  }
  const xrefOffset = position;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i += 1) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );
  return new TextEncoder().encode(chunks.join(''));
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
      ? buildPdf(book.title, book.author, chapters, structure)
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
