const SESSION_COOKIE = '__Host-nexauren_session';
const SESSION_DAYS = 14;
const PASSWORD_ITERATIONS = 30000;

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
       FROM users
      WHERE email = ?
      LIMIT 1`,
  ).bind(email).first();

  if (!user) return json({ error: 'Invalid email or password.' }, 401);

  const candidate = await hashPassword(password, user.password_salt);
  if (candidate.hash !== user.password_hash) {
    return json({ error: 'Invalid email or password.' }, 401);
  }

  const session = await createSession(env, user.id);
  return json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
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

  return json(
    { ok: true },
    200,
    { 'Set-Cookie': sessionCookie('', 0) },
  );
}

async function adminApi(request, env) {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'Admin access required.' }, 403);

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/admin/overview' && method === 'GET') {
    const [books, published, drafts, review, users, orders, tools, posts] =
      await Promise.all([
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
    });
  }

  if (path === '/api/admin/books' && method === 'GET') {
    const result = await env.BOOKS_DB.prepare(
      `SELECT id, slug, title, author, genre, price_usd, status,
              created_at, updated_at
         FROM books
        ORDER BY created_at DESC
        LIMIT 100`,
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
    const status = ['draft', 'published'].includes(body?.status)
      ? body.status
      : 'draft';
    const price = Number(body?.price_usd || 0).toFixed(2);

    await env.BOOKS_DB.prepare(
      `INSERT INTO books
        (id, slug, title, author, genre, description, price_usd,
         language, status, created_at, updated_at, published_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      slug,
      title,
      String(body?.author || 'Nexauren').trim() || 'Nexauren',
      String(body?.genre || '').trim() || null,
      String(body?.description || '').trim() || null,
      price,
      String(body?.language || 'en').trim() || 'en',
      status,
      createdAt,
      createdAt,
      status === 'published' ? createdAt : null,
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

    return json({ ok: true, id, slug }, 201);
  }

  if (path === '/api/admin/tools' && method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT id, slug, title, description, category, route, status,
              created_at, updated_at
         FROM tools
        ORDER BY created_at DESC
        LIMIT 100`,
    ).all();
    return json({ items: result.results || [] });
  }

  if (path === '/api/admin/tools' && method === 'POST') {
    const body = await bodyJson(request);
    const title = String(body?.title || '').trim();
    const route = String(body?.route || '').trim();
    if (!title || !route) {
      return json({ error: 'Tool name and route are required.' }, 400);
    }

    const createdAt = now();
    const id = randomId('tool');
    const slug = slugify(title);
    await env.DB.prepare(
      `INSERT INTO tools
        (id, slug, title, description, category, route, status,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    ).bind(
      id,
      slug,
      title,
      String(body?.description || '').trim() || null,
      String(body?.category || 'general').trim() || 'general',
      route,
      createdAt,
      createdAt,
    ).run();
    return json({ ok: true, id, slug }, 201);
  }

  if (path === '/api/admin/samples' && method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT id, type, title, description, price_usd, status,
              created_at, updated_at
         FROM products
        WHERE type IN ('sample', 'midi', 'preset')
        ORDER BY created_at DESC
        LIMIT 100`,
    ).all();
    return json({ items: result.results || [] });
  }

  if (path === '/api/admin/samples' && method === 'POST') {
    const body = await bodyJson(request);
    const title = String(body?.title || '').trim();
    const type = ['sample', 'midi', 'preset'].includes(body?.type)
      ? body.type
      : 'sample';
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
         FROM blog_posts
        ORDER BY created_at DESC
        LIMIT 100`,
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

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    if (path.startsWith('/api/admin/')) {
      return adminApi(request, env);
    }

    if (path === '/api/health' && method === 'GET') {
      return json({
        ok: true,
        service: 'nexauren',
        time: new Date().toISOString(),
      });
    }

    if (path === '/api/auth/register' && method === 'POST') {
      return authRegister(env, request);
    }

    if (path === '/api/auth/login' && method === 'POST') {
      return authLogin(env, request);
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      return authLogout(env, request);
    }

    if (path === '/api/auth/me' && method === 'GET') {
      const user = await requireUser(env, request);
      return json({
        user: user
          ? {
              id: user.user_id,
              email: user.email,
              name: user.name,
              role: user.role,
            }
          : null,
      });
    }

    if (path === '/api/account' && method === 'GET') {
      const user = await requireUser(env, request);
      if (!user) return json({ user: null });

      return json({
        user: {
          id: user.user_id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        credits: 0,
        purchases: [],
      });
    }

    return json({ error: 'API route not found.' }, 404);
  } catch (error) {
    console.error(error);
    return json({
      error: error?.message || 'Unexpected server error.',
    }, 500);
  }
}

async function asset(request, env, path) {
  const response = await env.ASSETS.fetch(request);

  if (path.startsWith('/admin')) {
    const headers = new Headers(response.headers);
    headers.set(
      'cache-control',
      'no-store, no-cache, must-revalidate',
    );
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

    if (path.startsWith('/api/')) {
      return api(request, env);
    }

    if (env.ASSETS) {
      return asset(request, env, path);
    }

    return new Response('Nexauren Worker is running.', { status: 200 });
  },
};
