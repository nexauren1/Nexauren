const QUARTERLY_PRODUCT = {
  localId: 'prd_music_premium_quarterly',
  paypalId: 'MUSICPLAYER-QUARTERLY',
  name: 'Music Player Premium Quarterly',
  description: 'Premium access to Music Player for USD 5 every 3 months.',
  price: '5.00',
};

const QUARTERLY_PLAN = {
  localId: 'prd_music_premium_quarterly_plan',
  name: 'Music Player Premium Quarterly',
  description: 'Music Player Premium subscription billed every 3 months.',
  price: '5.00',
};

const LIFETIME_PRODUCT = {
  localId: 'prd_music_premium_lifetime',
  paypalId: 'MUSICPLAYER-LIFETIME',
  name: 'Music Player Premium Lifetime',
  description: 'Lifetime premium access to Music Player for a one-time USD 30 payment.',
  price: '30.00',
};

function paypalBaseUrl(env) {
  return String(env.PAYPAL_ENVIRONMENT || 'sandbox').trim().toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function requestId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function parsePayPalResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function paypalRequest(env, accessToken, path, options = {}) {
  const response = await fetch(`${paypalBaseUrl(env)}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  const body = await parsePayPalResponse(response);

  if (!response.ok) {
    const detail = Array.isArray(body?.details)
      ? body.details
        .map((item) => item?.description || item?.issue)
        .filter(Boolean)
        .join('; ')
      : '';

    throw new Error(
      `PayPal API ${response.status}: ${body?.message || body?.name || detail || body?.raw || 'request failed'}${detail ? ` — ${detail}` : ''}`,
    );
  }

  return body;
}

async function getPayPalAccessToken(env) {
  const clientId = String(env.PAYPAL_CLIENT_ID || '').trim();
  const clientSecret = String(env.PAYPAL_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required.');
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(
    `${paypalBaseUrl(env)}/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    },
  );

  const body = await parsePayPalResponse(response);

  if (!response.ok || !body?.access_token) {
    throw new Error(
      `PayPal OAuth ${response.status}: ${body?.error_description || body?.error || body?.message || 'could not obtain access token'}`,
    );
  }

  return body.access_token;
}

async function getProduct(env, accessToken, productId) {
  const response = await fetch(
    `${paypalBaseUrl(env)}/v1/catalogs/products/${encodeURIComponent(productId)}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.status === 404) return null;

  const body = await parsePayPalResponse(response);
  if (!response.ok) {
    throw new Error(
      `PayPal product lookup ${response.status}: ${body?.message || body?.name || body?.raw || 'request failed'}`,
    );
  }

  return body;
}

async function ensureProduct(env, accessToken, definition) {
  const existing = await getProduct(
    env,
    accessToken,
    definition.paypalId,
  );

  if (existing) return { ...existing, created: false };

  const created = await paypalRequest(
    env,
    accessToken,
    '/v1/catalogs/products',
    {
      method: 'POST',
      headers: {
        'PayPal-Request-Id': requestId('music-product'),
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        id: definition.paypalId,
        name: definition.name,
        description: definition.description,
        type: 'DIGITAL',
      }),
    },
  );

  return { ...created, created: true };
}

async function listPlansForProduct(env, accessToken, productId) {
  const params = new URLSearchParams({
    product_id: productId,
    page_size: '20',
    page: '1',
    total_required: 'true',
  });

  return paypalRequest(
    env,
    accessToken,
    `/v1/billing/plans?${params.toString()}`,
    { method: 'GET' },
  );
}

function isMatchingQuarterlyPlan(plan, productId) {
  const cycle = Array.isArray(plan?.billing_cycles)
    ? plan.billing_cycles.find((item) => item?.tenure_type === 'REGULAR')
    : null;
  const price = cycle?.pricing_scheme?.fixed_price;

  return (
    plan?.product_id === productId
    && plan?.name === QUARTERLY_PLAN.name
    && cycle?.frequency?.interval_unit === 'MONTH'
    && Number(cycle?.frequency?.interval_count) === 3
    && String(price?.currency_code || '').toUpperCase() === 'USD'
    && Number(price?.value) === Number(QUARTERLY_PLAN.price)
    && Number(cycle?.total_cycles || 0) === 0
  );
}

async function activatePlan(env, accessToken, planId) {
  const body = await paypalRequest(
    env,
    accessToken,
    `/v1/billing/plans/${encodeURIComponent(planId)}/activate`,
    { method: 'POST' },
  );

  return body?.id ? body : { id: planId, status: 'ACTIVE' };
}

async function ensureQuarterlyPlan(env, accessToken, productId) {
  const result = await listPlansForProduct(
    env,
    accessToken,
    productId,
  );

  const plans = Array.isArray(result?.plans)
    ? result.plans
    : [];

  let plan = plans.find((item) => isMatchingQuarterlyPlan(item, productId));

  if (!plan) {
    plan = await paypalRequest(
      env,
      accessToken,
      '/v1/billing/plans',
      {
        method: 'POST',
        headers: {
          'PayPal-Request-Id': requestId('music-plan'),
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          product_id: productId,
          name: QUARTERLY_PLAN.name,
          description: QUARTERLY_PLAN.description,
          billing_cycles: [
            {
              frequency: {
                interval_unit: 'MONTH',
                interval_count: 3,
              },
              tenure_type: 'REGULAR',
              sequence: 1,
              total_cycles: 0,
              pricing_scheme: {
                fixed_price: {
                  value: QUARTERLY_PLAN.price,
                  currency_code: 'USD',
                },
              },
            },
          ],
          payment_preferences: {
            auto_bill_outstanding: true,
            payment_failure_threshold: 1,
          },
        }),
      },
    );
  }

  if (plan?.status !== 'ACTIVE') {
    plan = {
      ...plan,
      ...(await activatePlan(env, accessToken, plan.id)),
    };
  }

  return plan;
}

async function upsertLocalProduct(env, definition, externalId, status = 'active') {
  if (!env.DB || !externalId) return;

  const timestamp = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO products
      (id, type, external_id, title, description, price_usd, currency,
       credits, status, created_at, updated_at)
     VALUES (?, 'plan', ?, ?, ?, ?, 'USD', 0, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       external_id = excluded.external_id,
       title = excluded.title,
       description = excluded.description,
       price_usd = excluded.price_usd,
       currency = excluded.currency,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).bind(
    definition.localId,
    externalId,
    definition.name,
    definition.description,
    definition.price,
    status,
    timestamp,
    timestamp,
  ).run();
}

async function readLocalCatalog(env) {
  if (!env.DB) return null;

  const rows = await env.DB.prepare(
    `SELECT id, external_id, status
       FROM products
      WHERE id IN (?, ?, ?)`,
  ).bind(
    QUARTERLY_PRODUCT.localId,
    QUARTERLY_PLAN.localId,
    LIFETIME_PRODUCT.localId,
  ).all();

  const byId = new Map(
    (rows.results || []).map((row) => [row.id, row]),
  );

  const quarterlyProduct = byId.get(QUARTERLY_PRODUCT.localId);
  const quarterlyPlan = byId.get(QUARTERLY_PLAN.localId);
  const lifetimeProduct = byId.get(LIFETIME_PRODUCT.localId);

  if (
    quarterlyProduct?.external_id
    && quarterlyPlan?.external_id
    && lifetimeProduct?.external_id
  ) {
    return {
      source: 'database',
      quarterly_product_id: quarterlyProduct.external_id,
      quarterly_plan_id: quarterlyPlan.external_id,
      lifetime_product_id: lifetimeProduct.external_id,
    };
  }

  return null;
}

export async function provisionMusicPlayerPayPal(env) {
  const cached = await readLocalCatalog(env);
  if (cached) {
    return {
      ok: true,
      configured: true,
      environment: String(env.PAYPAL_ENVIRONMENT || 'sandbox').trim().toLowerCase(),
      source: cached.source,
      ...cached,
    };
  }

  const accessToken = await getPayPalAccessToken(env);

  const quarterlyProduct = await ensureProduct(
    env,
    accessToken,
    QUARTERLY_PRODUCT,
  );

  const lifetimeProduct = await ensureProduct(
    env,
    accessToken,
    LIFETIME_PRODUCT,
  );

  const quarterlyPlan = await ensureQuarterlyPlan(
    env,
    accessToken,
    quarterlyProduct.id,
  );

  await upsertLocalProduct(
    env,
    QUARTERLY_PRODUCT,
    quarterlyProduct.id,
  );
  await upsertLocalProduct(
    env,
    QUARTERLY_PLAN,
    quarterlyPlan.id,
  );
  await upsertLocalProduct(
    env,
    LIFETIME_PRODUCT,
    lifetimeProduct.id,
  );

  return {
    ok: true,
    configured: true,
    environment: String(env.PAYPAL_ENVIRONMENT || 'sandbox').trim().toLowerCase(),
    source: 'paypal',
    created: {
      quarterly_product: Boolean(quarterlyProduct.created),
      quarterly_plan: Boolean(quarterlyPlan.created),
      lifetime_product: Boolean(lifetimeProduct.created),
    },
    quarterly_product_id: quarterlyProduct.id,
    quarterly_plan_id: quarterlyPlan.id,
    lifetime_product_id: lifetimeProduct.id,
  };
}
