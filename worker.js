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
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToHex(tokenBytes);
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

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    if (path === '/api/health' && method === 'GET') {
      return json({ ok: true, service: 'nexauren', time: new Date().toISOString() });
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
          ? { id: user.user_id, email: user.email, name: user.name, role: user.role }
          : null,
      });
    }
    if (path === '/api/account' && method === 'GET') {
      const user = await requireUser(env, request);
      if (!user) return json({ user: null }, 200);
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
    return json({ error: error?.message || 'Unexpected server error.' }, 500);
  }
}

async function asset(request, env, path) {
  const url = new URL(request.url);

  if (path === '/' || path === '') {
    url.pathname = '/index.html';
  } else if (path === '/admin' || path === '/admin/') {
    url.pathname = '/admin/index.html';
  } else if (
    path === '/admin/login' ||
    path === '/admin/login/' ||
    path === '/admin/login/index.html'
  ) {
    url.pathname = '/admin/login/index.html';
  } else if (path === '/account' || path === '/account/') {
    url.pathname = '/account/index.html';
  }

  return env.ASSETS.fetch(new Request(url.toString(), request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      return api(request, env);
    }

    const isAdminLogin =
      path === '/admin/login' ||
      path === '/admin/login/' ||
      path === '/admin/login/index.html';

    if (path === '/admin' || path === '/admin/') {
      const admin = await requireAdmin(env, request);
      if (!admin) {
        return asset(request, env, '/admin/login/index.html');
      }
    } else if (path.startsWith('/admin/') && !isAdminLogin) {
      const admin = await requireAdmin(env, request);
      if (!admin) {
        return asset(request, env, '/admin/login/index.html');
      }
    }

    if (env.ASSETS) {
      return asset(request, env, path);
    }

    return new Response('Nexauren Worker is running.', { status: 200 });
  },
};
