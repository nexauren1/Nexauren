import worker from './worker.js';

const SESSION_COOKIE = '__Host-nexauren_session';

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

async function previewCover(request, env) {
  const admin = await requireAdmin(env, request);
  if (!admin) {
    return json({ error: 'Admin access required.' }, 403);
  }

  if (!env.BOOKS_DB) {
    return json({ error: 'Books database binding is not configured.' }, 503);
  }

  const url = new URL(request.url);
  const coverId = String(url.searchParams.get('cover_id') || '').trim();

  if (!coverId) {
    return json({ error: 'cover_id is required.' }, 400);
  }

  const cover = await env.BOOKS_DB.prepare(
    `SELECT id, book_id, data_uri
       FROM covers
      WHERE id = ?
      LIMIT 1`,
  ).bind(coverId).first();

  if (!cover) {
    return json({ error: 'Cover not found.' }, 404);
  }

  if (!cover.data_uri) {
    return json({ error: 'Cover data is unavailable.' }, 404);
  }

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
