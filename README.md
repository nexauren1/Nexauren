# Nexauren

Clean foundation for the Nexauren platform.

## Current architecture

Nexauren is one platform with separate public experiences:

- **Books** — publishing, catalogue, sales and digital delivery.
- **Music / Samples** — future commerce experience.
- **Tools** — future utilities and AI tools.
- **Blog** — future editorial content.
- **Account** — one shared identity across Nexauren.
- **Admin Studio** — private control center at `/admin`.

The public experiences keep their own navigation and content. Admin is never linked from the public interface.

## Cloudflare Worker

`worker.js` is the server layer for authentication, sessions, admin authorization, Books APIs and PayPal Checkout.

`wrangler.json` binds two separate D1 databases:

```text
DB
└── nexauren-db
    ├── users / sessions
    ├── products / orders / purchases
    ├── credits / subscriptions
    ├── tools
    └── blog_posts

BOOKS_DB
└── nexauren-books
    ├── books
    ├── story_bibles
    ├── research_notes
    ├── canonical_facts
    ├── chapter_versions
    ├── book_files
    ├── entity_registry
    ├── continuity_checks
    ├── qa_runs
    └── publication_versions
```

`BOOKS_DB` contains Books editorial data only. Account, commerce and shared platform records stay in `DB`.

## Frontend layout

```text
frontend/
├── index.html
├── admin/
│   ├── index.html
│   ├── admin.css
│   ├── admin.js
│   └── login/
│       ├── index.html
│       └── login.js
├── books/
│   ├── index.html
│   ├── books.css
│   ├── books.js
│   ├── store/index.html
│   ├── store/store.js
│   ├── categories/index.html
│   ├── book/index.html
│   ├── book/book.js
│   └── library/index.html
├── music/
├── tools/
├── account/
│   ├── index.html
│   ├── account.css
│   ├── account.js
│   └── credits/
│       ├── index.html
│       └── credits.js
└── legal/
```

## Authentication

Registration and login create a server-side session stored in `nexauren-db`. The browser receives only an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie.

Admin access is role-based. A normal account cannot open `/admin`; the Worker checks `role = 'admin'` before serving the private workspace or any `/api/admin/*` endpoint.

No admin email, password or secret is stored in frontend code.

## PayPal

Checkout uses PayPal REST Orders v2 from the Worker. The browser receives only the public client ID; the client secret stays in Cloudflare Worker secrets.

The repository includes a `prd_credit_100` sandbox-ready product for an end-to-end `$1.00 USD` checkout test. Book purchases use the same server-side product/order flow after a published Books record has an active commerce record.

Recurring subscription plans are represented in the schema but are intentionally not activated until PayPal plan IDs are configured.

## Setup

1. Bind the two existing D1 databases using `wrangler.json`.
2. Apply `migrations/global/0001_core.sql` to `nexauren-db`.
3. Apply `migrations/books/0001_books.sql` to `nexauren-books`.
4. Add the Cloudflare secrets `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Set `PAYPAL_ENV` to `sandbox` for testing.
5. Deploy the Worker with `npx wrangler deploy` or the connected Cloudflare deployment pipeline.
6. Create your normal Nexauren account at `/account/`, then promote that account to admin in `nexauren-db` with:

```sql
UPDATE users
SET role = 'admin'
WHERE lower(email) = lower('YOUR_ADMIN_EMAIL');
```

Then open `/admin` directly. There is no public Admin link.

## Storage

No storage provider is assumed yet. Books metadata and file records are ready in D1, while actual PDF/EPUB file storage can be connected later without moving the Books database structure.

## Design principles

- light, warm surfaces instead of black-first branding;
- strong contrast and visible focus states;
- responsive mobile layouts;
- separate Books, Music and Tools public experiences;
- no fake live catalogue products;
- private administration enforced by the Worker, not by hiding frontend links.

## Deployment sync

The authentication API routes in `worker.js` are deployed as part of the same Cloudflare Worker defined by `wrangler.json`. This marker exists to trigger a fresh Cloudflare Git deployment when the repository and Worker deployment need to be resynchronized.
