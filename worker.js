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
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
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
     VALUES (?, ?, ?, ?, ?)`
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
      LIMIT 1`
  ).bind(tokenHash).first();

  if (!session) return null;
  if (Number(session.expires_at) <= now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
    return null;
  }

  await env.DB.prepare(
    'UPDATE sessions SET last_seen_at = ? WHERE id = ?'
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

function paypalBase(env) {
  return env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function paypalToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal is not configured.');
  }

  const credentials = btoa(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`,
  );
  const response = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error('PayPal authentication failed.');
  }

  const data = await response.json();
  return data.access_token;
}

async function paypalRequest(env, path, options = {}) {
  const token = await paypalToken(env);
  const response = await fetch(`${paypalBase(env)}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.message || data?.name || 'PayPal request failed.';
    throw new Error(message);
  }
  return data;
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
    'SELECT id FROM users WHERE email = ? LIMIT 1'
  ).bind(email).first();
  if (existing) return json({ error: 'An account with this email already exists.' }, 409);

  const id = randomId('usr');
  const passwordData = await hashPassword(password);
  const createdAt = now();

  await env.DB.prepare(
    `INSERT INTO users
      (id, email, password_hash, password_salt, name, role, created_at)
     VALUES (?, ?, ?, ?, ?, 'user', ?)`
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
    {
      user: { id, email, name: name || null, role: 'user' },
    },
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
      LIMIT 1`
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
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
  }

  return json(
    { ok: true },
    200,
    { 'Set-Cookie': sessionCookie('', 0) },
  );
}

async function catalogBooks(env) {
  const rows = await env.BOOKS_DB.prepare(
    `SELECT id, slug, title, subtitle, author, description,
            language, genre, age_rating, cover_url, price_usd,
            currency, status, published_at, updated_at
       FROM books
      WHERE status = 'published'
      ORDER BY published_at DESC, created_at DESC`
  ).all();
  return rows.results || [];
}

async function publicBook(env, slug) {
  const book = await env.BOOKS_DB.prepare(
    `SELECT id, slug, title, subtitle, author, description,
            language, genre, subgenre, audience, age_rating, style,
            desired_size, approx_chapter_count, premise, price_usd,
            currency, cover_url, preview_url, pdf_available,
            epub_available, status, seo_title, seo_description,
            seo_keywords, published_at, updated_at
       FROM books
      WHERE slug = ? AND status = 'published'
      LIMIT 1`
  ).bind(slug).first();
  if (!book) return null;

  const product = await env.DB.prepare(
    `SELECT id, title, description, price_usd, currency, credits
       FROM products
      WHERE type = 'book' AND external_id = ? AND status = 'active'
      LIMIT 1`
  ).bind(book.id).first();

  return { ...book, product: product || null };
}

async function createBook(env, body, adminId) {
  const title = String(body?.title || '').trim();
  const slug = String(body?.slug || title)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  if (!title || !slug) return json({ error: 'Title is required.' }, 400);

  const existing = await env.BOOKS_DB.prepare(
    'SELECT id FROM books WHERE slug = ? LIMIT 1'
  ).bind(slug).first();
  if (existing) return json({ error: 'That book slug already exists.' }, 409);

  const id = randomId('book');
  const createdAt = now();
  const price = Number(body?.price_usd || 0).toFixed(2);
  const currency = 'USD';
  const status = body?.status === 'published' ? 'published' : 'draft';

  await env.BOOKS_DB.prepare(
    `INSERT INTO books
      (id, slug, title, subtitle, author, description, language,
       genre, subgenre, audience, age_rating, style, desired_size,
       approx_chapter_count, premise, price_usd, currency, status,
       cover_url, preview_url, pdf_available, epub_available,
       seo_title, seo_description, seo_keywords, created_at, updated_at,
       published_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    slug,
    title,
    body?.subtitle || null,
    body?.author || 'Nexauren',
    body?.description || null,
    body?.language || 'en',
    body?.genre || null,
    body?.subgenre || null,
    body?.audience || null,
    body?.age_rating || null,
    body?.style || null,
    body?.desired_size || null,
    Number(body?.approx_chapter_count || 0),
    body?.premise || null,
    price,
    currency,
    status,
    body?.cover_url || null,
    body?.preview_url || null,
    body?.seo_title || title,
    body?.seo_description || body?.description || null,
    body?.seo_keywords || null,
    createdAt,
    createdAt,
    status === 'published' ? createdAt : null,
    adminId,
  ).run();

  await env.BOOKS_DB.prepare(
    `INSERT INTO story_bibles
      (book_id, identity_json, world_json, characters_json,
       relations_json, story_json, timeline_json, chapters_json,
       style_json, continuity_json, continuation_json, version, updated_at)
     VALUES (?, '{}', '{}', '[]', '{}', '{}', '[]', '[]', '{}',
             '{}', '{}', 1, ?)`
  ).bind(id, createdAt).run();

  await env.DB.prepare(
    `INSERT INTO products
      (id, type, external_id, title, description, price_usd,
       currency, credits, status, created_at, updated_at)
     VALUES (?, 'book', ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).bind(
    randomId('prd'),
    id,
    title,
    body?.description || null,
    price,
    currency,
    status === 'published' ? 'active' : 'draft',
    createdAt,
    createdAt,
  ).run();

  return json({ ok: true, id, slug }, 201);
}

async function adminOverview(env) {
  const books = await env.BOOKS_DB.prepare(
    `SELECT
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts,
      SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      COUNT(*) AS total
     FROM books`
  ).first();

  const users = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first();
  const orders = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN CAST(amount AS REAL) ELSE 0 END), 0) AS revenue
       FROM orders`
  ).first();
  const tools = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM tools WHERE status != \'archived\''
  ).first();
  const samples = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM products
      WHERE type IN ('sample', 'midi', 'preset') AND status != 'archived'`
  ).first();
  const posts = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM blog_posts WHERE status != \'archived\''
  ).first();

  return json({
    books: {
      total: Number(books?.total || 0),
      drafts: Number(books?.drafts || 0),
      review: Number(books?.review || 0),
      published: Number(books?.published || 0),
    },
    platform: {
      users: Number(users?.total || 0),
      orders: Number(orders?.total || 0),
      revenue: Number(orders?.revenue || 0),
      tools: Number(tools?.total || 0),
      samples: Number(samples?.total || 0),
      posts: Number(posts?.total || 0),
    },
  });
}

async function adminList(env, kind) {
  if (kind === 'books') {
    const rows = await env.BOOKS_DB.prepare(
      `SELECT id, slug, title, author, genre, price_usd,
              currency, status, updated_at
         FROM books ORDER BY updated_at DESC LIMIT 100`
    ).all();
    return json({ items: rows.results || [] });
  }

  if (kind === 'tools') {
    const rows = await env.DB.prepare(
      `SELECT id, slug, title, category, status, updated_at
         FROM tools ORDER BY updated_at DESC LIMIT 100`
    ).all();
    return json({ items: rows.results || [] });
  }

  if (kind === 'samples') {
    const rows = await env.DB.prepare(
      `SELECT id, title, description, price_usd, currency, credits,
              status, type, external_id, updated_at
         FROM products
        WHERE type IN ('sample', 'midi', 'preset')
        ORDER BY updated_at DESC LIMIT 100`
    ).all();
    return json({ items: rows.results || [] });
  }

  if (kind === 'blog') {
    const rows = await env.DB.prepare(
      `SELECT id, slug, title, status, published_at, updated_at
         FROM blog_posts ORDER BY updated_at DESC LIMIT 100`
    ).all();
    return json({ items: rows.results || [] });
  }

  return json({ error: 'Unknown admin section.' }, 404);
}

async function adminCreate(env, request, kind, adminId) {
  const body = await bodyJson(request);
  const createdAt = now();

  if (kind === 'books') return createBook(env, body, adminId);

  if (kind === 'tools') {
    const title = String(body?.title || '').trim();
    const slug = String(body?.slug || title)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 100);
    if (!title || !slug) return json({ error: 'Title is required.' }, 400);
    await env.DB.prepare(
      `INSERT INTO tools
        (id, slug, title, description, category, route, status,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    ).bind(
      randomId('tool'), slug, title, body?.description || null,
      body?.category || 'general', body?.route || `/tools/${slug}/`,
      createdAt, createdAt,
    ).run();
    return json({ ok: true }, 201);
  }

  if (kind === 'samples') {
    const title = String(body?.title || '').trim();
    const type = ['sample', 'midi', 'preset'].includes(body?.type)
      ? body.type : 'sample';
    const price = Number(body?.price_usd || 0).toFixed(2);
    if (!title) return json({ error: 'Title is required.' }, 400);
    await env.DB.prepare(
      `INSERT INTO products
        (id, type, external_id, title, description, price_usd,
         currency, credits, status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'USD', 0, 'draft', ?, ?)`
    ).bind(
      randomId('prd'), type, title, body?.description || null,
      price, createdAt, createdAt,
    ).run();
    return json({ ok: true }, 201);
  }

  if (kind === 'blog') {
    const title = String(body?.title || '').trim();
    const slug = String(body?.slug || title)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 100);
    if (!title || !slug) return json({ error: 'Title is required.' }, 400);
    await env.DB.prepare(
      `INSERT INTO blog_posts
        (id, slug, title, excerpt, content, cover_url, author_name,
         status, seo_title, seo_description, created_at, updated_at,
         published_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, NULL, ?)`
    ).bind(
      randomId('post'), slug, title, body?.excerpt || null,
      body?.content || '', body?.cover_url || null,
      body?.author_name || 'Nexauren', body?.seo_title || title,
      body?.seo_description || body?.excerpt || null,
      createdAt, createdAt, adminId,
    ).run();
    return json({ ok: true }, 201);
  }

  return json({ error: 'Unknown admin section.' }, 404);
}

async function createPaypalOrder(env, request) {
  const user = await requireUser(env, request);
  if (!user) return json({ error: 'Authentication required.' }, 401);

  const body = await bodyJson(request);
  const productId = String(body?.product_id || '').trim();
  if (!productId) return json({ error: 'product_id is required.' }, 400);

  const product = await env.DB.prepare(
    `SELECT id, type, external_id, title, description,
            price_usd, currency, credits
       FROM products
      WHERE id = ? AND status = 'active'
      LIMIT 1`
  ).bind(productId).first();
  if (!product) return json({ error: 'Product is unavailable.' }, 404);

  const amount = Number(product.price_usd);
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ error: 'Product has an invalid price.' }, 409);
  }

  const order = await paypalRequest(env, '/v2/checkout/orders', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: product.id,
          custom_id: `${user.user_id}:${product.id}`,
          description: product.title,
          amount: {
            currency_code: product.currency || 'USD',
            value: amount.toFixed(2),
          },
        },
      ],
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    }),
  });

  const createdAt = now();
  await env.DB.prepare(
    `INSERT INTO orders
      (id, user_id, product_id, paypal_order_id, amount, currency,
       status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'CREATED', ?)`
  ).bind(
    randomId('ord'), user.user_id, product.id, order.id,
    amount.toFixed(2), product.currency || 'USD', createdAt,
  ).run();

  return json({ id: order.id });
}

async function capturePaypalOrder(env, request) {
  const user = await requireUser(env, request);
  if (!user) return json({ error: 'Authentication required.' }, 401);

  const body = await bodyJson(request);
  const paypalOrderId = String(body?.order_id || '').trim();
  if (!paypalOrderId) return json({ error: 'order_id is required.' }, 400);

  const orderRow = await env.DB.prepare(
    `SELECT o.*, p.type, p.external_id, p.title, p.credits
       FROM orders o
       JOIN products p ON p.id = o.product_id
      WHERE o.paypal_order_id = ? AND o.user_id = ?
      LIMIT 1`
  ).bind(paypalOrderId, user.user_id).first();

  if (!orderRow) return json({ error: 'Order not found.' }, 404);
  if (orderRow.status === 'COMPLETED') {
    return json({ ok: true, already_completed: true });
  }

  const capture = await paypalRequest(
    env,
    `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    { method: 'POST', headers: { Prefer: 'return=representation' }, body: '{}' },
  );

  const captureStatus = capture?.status;
  const payment = capture?.purchase_units?.[0]?.payments?.captures?.[0];
  const capturedValue = payment?.amount?.value;
  const capturedCurrency = payment?.amount?.currency_code;

  if (captureStatus !== 'COMPLETED' || !payment || payment.status !== 'COMPLETED') {
    return json({ error: 'PayPal did not complete the payment.' }, 402);
  }

  if (
    String(capturedValue) !== String(Number(orderRow.amount).toFixed(2)) ||
    capturedCurrency !== orderRow.currency
  ) {
    return json({ error: 'Payment amount verification failed.' }, 409);
  }

  const completedAt = now();
  await env.DB.prepare(
    `UPDATE orders
        SET status = 'COMPLETED', paypal_capture_id = ?, captured_at = ?
      WHERE id = ?`
  ).bind(payment.id, completedAt, orderRow.id).run();

  if (['sample', 'midi', 'preset', 'book'].includes(orderRow.type)) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO purchases
        (id, user_id, product_id, order_id, status, created_at)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?)`
    ).bind(
      randomId('pur'), user.user_id, orderRow.product_id,
      orderRow.id, completedAt,
    ).run();
  }

  if (orderRow.type === 'credit_pack' && Number(orderRow.credits) > 0) {
    await env.DB.prepare(
      `INSERT INTO credit_ledger
        (id, user_id, amount, kind, source, source_id, expires_at, created_at)
       VALUES (?, ?, ?, 'purchase', ?, ?, NULL, ?)`
    ).bind(
      randomId('cr'), user.user_id, Number(orderRow.credits),
      orderRow.type, orderRow.product_id, completedAt,
    ).run();
  }

  return json({ ok: true, status: 'COMPLETED' });
}

async function accountSummary(env, request) {
  const user = await requireUser(env, request);
  if (!user) return json({ user: null }, 200);

  const credits = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS balance
       FROM credit_ledger
      WHERE user_id = ?`
  ).bind(user.user_id).first();
  const purchases = await env.DB.prepare(
    `SELECT p.id, p.title, p.type, pu.created_at
       FROM purchases pu
       JOIN products p ON p.id = pu.product_id
      WHERE pu.user_id = ?
      ORDER BY pu.created_at DESC`
  ).bind(user.user_id).all();

  return json({
    user: {
      id: user.user_id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    credits: Number(credits?.balance || 0),
    purchases: purchases.results || [],
  });
}

function adminRedirect(request, path) {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = '';
  return Response.redirect(url.toString(), 302);
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
      return accountSummary(env, request);
    }

    if (path === '/api/books' && method === 'GET') {
      return json({ books: await catalogBooks(env) });
    }

    if (path.startsWith('/api/books/') && method === 'GET') {
      const slug = decodeURIComponent(path.slice('/api/books/'.length));
      const book = await publicBook(env, slug);
      if (!book) return json({ error: 'Book not found.' }, 404);
      return json({ book });
    }

    if (path === '/api/paypal/config' && method === 'GET') {
      return json({
        configured: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
        environment: env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
        client_id: env.PAYPAL_CLIENT_ID || null,
      });
    }
    if (path === '/api/paypal/create-order' && method === 'POST') {
      return createPaypalOrder(env, request);
    }
    if (path === '/api/paypal/capture-order' && method === 'POST') {
      return capturePaypalOrder(env, request);
    }

    if (path.startsWith('/api/admin/')) {
      const admin = await requireAdmin(env, request);
      if (!admin) return json({ error: 'Admin authorization required.' }, 403);

      if (path === '/api/admin/overview' && method === 'GET') {
        return adminOverview(env);
      }

      const match = path.match(/^\/api\/admin\/(books|tools|samples|blog)$/);
      if (match && method === 'GET') return adminList(env, match[1]);
      if (match && method === 'POST') return adminCreate(env, request, match[1], admin.user_id);
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
  } else if (path === '/admin/login' || path === '/admin/login/') {
    url.pathname = '/admin/login/index.html';
  } else if (path === '/account' || path === '/account/') {
    url.pathname = '/account/index.html';
  }
  return env.ASSETS.fetch(new Request(url.toString(), request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return api(request, env);
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      const admin = await requireAdmin(env, request);
      if (!admin) return adminRedirect(request, '/admin/login/');
    } else if (url.pathname.startsWith('/admin/')) {
      const isLogin = url.pathname === '/admin/login' || url.pathname === '/admin/login/';
      if (!isLogin) {
        const admin = await requireAdmin(env, request);
        if (!admin) return adminRedirect(request, '/admin/login/');
      }
    }

    if (env.ASSETS) return asset(request, env, url.pathname);
    return new Response('Nexauren Worker is running.', { status: 200 });
  },
};
