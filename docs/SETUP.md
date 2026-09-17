# Nexauren — Setup

## 1. Cloudflare D1

The repository already contains the two requested database IDs in `wrangler.json`.

Global database:

```text
nexauren-db
ID: fb3b3106-59a9-4b96-b28a-9559e0ed344d
binding: DB
```

Books database:

```text
nexauren-books
ID: 887e6775-e3ad-43a6-b315-8193f7c6c346
binding: BOOKS_DB
```

Apply these SQL files to the matching databases:

```text
migrations/global/0001_core.sql
migrations/books/0001_books.sql
```

Using Wrangler:

```bash
npx wrangler d1 migrations apply nexauren-db --remote
npx wrangler d1 migrations apply nexauren-books --remote
```

Using the Cloudflare D1 Console, paste the complete contents of the corresponding migration into the correct database and execute it.

## 2. PayPal Sandbox

Create or use a PayPal Developer sandbox app and keep the client secret on the Worker only.

Set these Worker secrets:

```bash
npx wrangler secret put PAYPAL_CLIENT_ID
npx wrangler secret put PAYPAL_CLIENT_SECRET
npx wrangler secret put PAYPAL_ENV
```

For the first test, set:

```text
PAYPAL_ENV=sandbox
```

The Worker automatically uses the sandbox REST API when this value is anything other than `live`.

## 3. Create your admin account

Open:

```text
https://nexaurenstory.com/account/
```

Create your normal Nexauren account first.

Then, in the `nexauren-db` D1 Console, run:

```sql
UPDATE users
SET role = 'admin'
WHERE lower(email) = lower('YOUR_ADMIN_EMAIL');
```

After that, open:

```text
https://nexaurenstory.com/admin
```

The Worker checks the session and `role = 'admin'` before serving the Admin Studio. The Admin route is not linked in the public navigation.

## 4. Test checkout

The global migration creates a test product:

```text
ID: prd_credit_100
Product: 100 Nexauren Credits
Price: 1.00 USD
```

Sign in and open:

```text
https://nexaurenstory.com/account/credits/
```

The PayPal button loads only after the Worker confirms PayPal credentials are configured.

The checkout sequence is:

```text
Browser
  ↓
Worker creates PayPal Order
  ↓
PayPal Sandbox
  ↓
Buyer approves
  ↓
Worker captures Order
  ↓
Worker verifies status + amount + currency
  ↓
D1 order marked COMPLETED
  ↓
Credits added to credit_ledger
```

## 5. Books flow

Create a book project in Admin Studio > Books.

A book is stored in `nexauren-books`, while its commerce record is stored in `nexauren-db` as a `products` row of type `book`.

Only books with `status = 'published'` appear in the public Books Store.

Public product pages use:

```text
/books/book/?slug=<book-slug>
```

The purchase API verifies the server-side product price. The browser never supplies the final payment amount.

## 6. Storage

No PDF/EPUB storage provider is assumed yet. `book_files` is prepared for future storage, but the repository does not invent a storage integration.

When a storage provider is selected, connect it to the Worker download authorization flow without moving the Books editorial tables.

## 7. Deployment

The Worker uses Cloudflare Static Assets with `frontend/` as the asset directory.

```text
wrangler.json
worker.js
frontend/
```

Deploy with:

```bash
npm install
npx wrangler deploy
```

Or use the existing Cloudflare Git deployment pipeline connected to this repository.

## 8. Important production hardening

Before accepting real payments, add login rate limiting, account email verification/recovery, PayPal webhook handling for reconciliation, and the final storage integration. The current Sandbox flow is designed for integration testing and records completed orders server-side.
