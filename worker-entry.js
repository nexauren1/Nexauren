import worker from './worker.js';

const SESSION_COOKIE = '__Host-nexauren_session';
const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

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

function randomId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${[...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  const cookies = {};

  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function requireAdmin(env, request) {
  if (!env.DB) return null;

  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.expires_at,
            u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
      LIMIT 1`,
  ).bind(tokenHash).first();

  if (!session || session.role !== 'admin') return null;

  if (Number(session.expires_at) <= now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(tokenHash)
      .run();
    return null;
  }

  return session;
}

async function bodyJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function clip(value, max = 30000) {
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value ?? {});
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n…[recortado]`;
}

const BOOK_STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    front_matter: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['key', 'title', 'included', 'purpose', 'content'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          included: { type: 'boolean' },
          purpose: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
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
        additionalProperties: true,
        required: ['key', 'title', 'included', 'purpose', 'content'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          included: { type: 'boolean' },
          purpose: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
  },
  required: ['front_matter', 'chapters', 'back_matter'],
};

async function generateBookStructure(request, env, admin) {
  if (!env.BOOKS_DB || !env.AI) {
    return json({
      error: !env.BOOKS_DB
        ? 'A base de dados de livros não está configurada.'
        : 'Workers AI não está configurado neste Worker.',
    }, 503);
  }

  const body = await bodyJson(request);
  const bookId = String(body?.book_id || '').trim();
  if (!bookId) return json({ error: 'Selecciona um livro primeiro.' }, 400);

  const book = await env.BOOKS_DB.prepare(
    `SELECT id, title, subtitle, author, language, genre, subgenre,
            audience, age_rating, style, desired_size,
            approx_chapter_count, premise
       FROM books WHERE id = ? LIMIT 1`,
  ).bind(bookId).first();
  if (!book) return json({ error: 'Livro não encontrado.' }, 404);

  const bible = await env.BOOKS_DB.prepare(
    `SELECT identity_json, story_json, characters_json, relations_json,
            world_json, timeline_json, style_json, continuity_json,
            continuation_json
       FROM story_bibles WHERE book_id = ? LIMIT 1`,
  ).bind(bookId).first();

  const prompt = [
    `Título: ${book.title}`,
    `Subtítulo: ${book.subtitle || ''}`,
    `Autor: ${book.author || ''}`,
    `Idioma do manuscrito: ${book.language || 'pt-PT'}`,
    `Género: ${book.genre || ''}`,
    `Subgénero: ${book.subgenre || ''}`,
    `Público: ${book.audience || ''}`,
    `Classificação etária: ${book.age_rating || ''}`,
    `Estilo: ${book.style || ''}`,
    `Tamanho desejado: ${book.desired_size || ''}`,
    `Capítulos aproximados: ${book.approx_chapter_count || 12}`,
    `Ideia: ${book.premise || ''}`,
    `Story Bible: ${clip(bible || {}, 30000)}`,
  ].join('\n');

  const jobId = randomId('job');
  const started = now();

  await env.BOOKS_DB.prepare(
    `INSERT INTO ai_jobs
      (id, book_id, job_type, action, status, model,
       input_json, created_at, started_at, created_by)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
  ).bind(
    jobId,
    bookId,
    'structure',
    'structure',
    TEXT_MODEL,
    JSON.stringify({ prompt }),
    started,
    started,
    admin.user_id,
  ).run();

  try {
    const result = await env.AI.run(TEXT_MODEL, {
      messages: [
        {
          role: 'system',
          content: [
            'És o arquitecto editorial da NexaurenBooks.',
            'Cria a estrutura completa de um livro antes da prosa.',
            'Inclui apenas os elementos iniciais que fizerem sentido para a obra.',
            'Considera: folha de rosto, dedicatória, epígrafe, apresentação, prefácio, introdução e índice.',
            'Define também capítulos numerados com títulos claros e objectivos concretos.',
            'Pode incluir epílogo, conclusão, agradecimentos, nota do autor ou outros elementos finais quando forem apropriados.',
            'Nunca inventes factos biográficos do autor.',
            'Se faltar informação para uma peça opcional, marca-a como incluída = false em vez de inventar.',
            'O índice deve corresponder exactamente aos capítulos numerados.',
            'Mantém a estrutura coerente com a Story Bible.',
            'Usa o idioma do manuscrito. Quando for português de Portugal, escreve em português europeu e evita brasileirismos.',
            'Devolve apenas JSON de acordo com o esquema.',
          ].join(' '),
        },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: BOOK_STRUCTURE_SCHEMA,
      },
    });

    let structure = result?.response ?? result;
    if (typeof structure === 'string') structure = JSON.parse(structure);

    const chapters = Array.isArray(structure?.chapters)
      ? structure.chapters
      : [];
    const storedStructure = [
      {
        type: 'book_structure',
        number: 0,
        title: 'Estrutura editorial',
        front_matter: structure?.front_matter || [],
        back_matter: structure?.back_matter || [],
      },
      ...chapters,
    ];

    await env.BOOKS_DB.prepare(
      `UPDATE story_bibles
          SET chapters_json = ?,
              version = version + 1,
              updated_at = ?
        WHERE book_id = ?`,
    ).bind(
      JSON.stringify(storedStructure),
      now(),
      bookId,
    ).run();

    await env.BOOKS_DB.prepare(
      `INSERT INTO ai_generations
        (id, job_id, book_id, role, action, model,
         input_json, output_json, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      randomId('gen'),
      jobId,
      bookId,
      'editorial-architect',
      'structure',
      TEXT_MODEL,
      JSON.stringify({ prompt }),
      JSON.stringify(structure),
      now(),
      admin.user_id,
    ).run();

    await env.BOOKS_DB.prepare(
      `UPDATE ai_jobs
          SET status = 'completed', completed_at = ?, error = NULL,
              result_json = ?
        WHERE id = ?`,
    ).bind(now(), JSON.stringify(structure), jobId).run();

    return json({
      ok: true,
      action: 'structure',
      structure,
    });
  } catch (error) {
    await env.BOOKS_DB.prepare(
      `UPDATE ai_jobs
          SET status = 'failed', completed_at = ?, error = ?
        WHERE id = ?`,
    ).bind(now(), String(error?.message || error), jobId).run();

    throw error;
  }
}

async function strengthenChapterRequest(request, env) {
  const body = await bodyJson(request);
  if (!body || body.action !== 'chapter') return null;

  const language = String(body.language || '').trim();
  const languageRule = language.startsWith('pt')
    ? 'Escreve em português de Portugal, com vocabulário e sintaxe de Portugal, evitando brasileirismos.'
    : 'Escreve no idioma definido no projecto e respeita a variante linguística pedida.';

  const editorialRule = [
    'O campo title deve ser um título literário claro para este capítulo.',
    'O campo content deve conter apenas a prosa do capítulo, sem repetir o título no início.',
    'O capítulo deve ter começo, desenvolvimento e conclusão local coerentes com o outline.',
    'Não confundas elementos pré-textuais como dedicatória, apresentação, prefácio ou índice com capítulos de narrativa.',
    'Nunca alteres canon bloqueado.',
    languageRule,
  ].join(' ');

  const current = String(body.instructions || '').trim();
  const nextBody = {
    ...body,
    instructions: [current, editorialRule].filter(Boolean).join('\n\n'),
  };

  return new Request(request, {
    body: JSON.stringify(nextBody),
  });
}

async function previewCover(request, env) {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'Admin access required.' }, 403);
  if (!env.BOOKS_DB) return json({ error: 'Books database binding is not configured.' }, 503);

  const url = new URL(request.url);
  const coverId = String(url.searchParams.get('cover_id') || '').trim();
  if (!coverId) return json({ error: 'cover_id is required.' }, 400);

  const cover = await env.BOOKS_DB.prepare(
    `SELECT id, book_id, data_uri
       FROM covers WHERE id = ? LIMIT 1`,
  ).bind(coverId).first();

  if (!cover) return json({ error: 'Cover not found.' }, 404);
  if (!cover.data_uri) return json({ error: 'Cover data is unavailable.' }, 404);

  return json({
    ok: true,
    id: cover.id,
    book_id: cover.book_id,
    data_uri: cover.data_uri,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (
        url.pathname === '/api/admin/covers/preview'
        && request.method === 'GET'
      ) {
        return await previewCover(request, env);
      }

      if (
        url.pathname === '/api/admin/ai'
        && request.method === 'POST'
      ) {
        const body = await bodyJson(request.clone());

        if (body?.action === 'structure') {
          const admin = await requireAdmin(env, request);
          if (!admin) return json({ error: 'Admin access required.' }, 403);
          return await generateBookStructure(request, env, admin);
        }

        if (body?.action === 'chapter') {
          const strengthened = await strengthenChapterRequest(request.clone(), env);
          if (strengthened) {
            return await worker.fetch(strengthened, env, ctx);
          }
        }
      }

      return await worker.fetch(request, env, ctx);
    } catch (error) {
      console.error('Nexauren request failure:', error);

      if (url.pathname.startsWith('/api/admin/')) {
        let admin = null;

        try {
          admin = await requireAdmin(env, request);
        } catch (authError) {
          console.error(
            'Admin error-context check failed:',
            authError,
          );
        }

        if (admin) {
          return json({
            error: error?.message || 'Admin request failed.',
          }, 500);
        }
      }

      return json({ error: 'Internal server error.' }, 500);
    }
  },
};
