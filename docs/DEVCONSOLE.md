# NaviJSON Developer Console & API Keys (Stage 3)

A developer console for issuing, listing, revoking, and metering NaviJSON API
keys. Keys and usage counters are stored in **Cloudflare D1** via **Drizzle ORM**.

- Console UI: **`/console`**
- API: **`/api/keys`**, **`/api/keys/[id]`**, **`/api/validate`**

> **Billing is a stub.** Stripe integration is intentionally out of scope for
> this stage. The console shows a disabled "Billing (Stripe) — coming soon"
> card, and usage is metered so it can later map to paid plans. See
> [Billing stub](#billing-stub).

---

## Data model

`db/schema.ts` defines the `api_keys` table (`apiKeys` export):

| Column          | Type              | Notes                                                        |
| --------------- | ----------------- | ------------------------------------------------------------ |
| `id`            | text (PK)         | UUID (`crypto.randomUUID()`).                                |
| `name`          | text              | Human-friendly label. Default `""`.                          |
| `key_prefix`    | text              | Non-secret display prefix, first 12 chars (e.g. `njk_live_1a2`). |
| `key_hash`      | text              | **SHA-256 hex** of the full raw key. The raw key is never stored. |
| `created_at`    | integer           | Epoch milliseconds.                                          |
| `revoked`       | integer (bool)    | `0` = active, `1` = revoked. Default `0`.                    |
| `request_count` | integer           | Incremented on each successful `/api/validate`. Default `0`. |
| `last_used_at`  | integer (nullable)| Epoch milliseconds of last successful validation.           |

### Key lifecycle

1. **Create** — a raw key `njk_live_` + 40 hex chars is generated with
   `crypto.getRandomValues`. Only its **SHA-256 hex digest** is persisted. The
   raw key is returned **exactly once** in the create response.
2. **Display once** — the console shows the raw key in a copyable callout
   ("copy it now, you won't see it again"). It can never be retrieved again.
3. **Validate / meter** — consumers call `/api/validate` with the key. The
   endpoint hashes the key, looks up the hash, and on success increments
   `request_count` and stamps `last_used_at`.
4. **Revoke** — `DELETE /api/keys/[id]` sets `revoked = 1`. Revoked keys fail
   validation with `401`.

---

## Endpoints

All handlers obtain the D1 binding through `getDb()` (`db/index.ts`), exactly
like `examples/d1/app/api/notes/route.ts`.

> **Resilience:** if the D1 binding is missing (this repo ships with
> `d1: null` in `.openai/hosting.json`) or the migration hasn't been applied,
> every handler returns a clean **`503`**:
> `{ "error": "D1 not configured", "hint": "bind DB in wrangler config" }`
> instead of throwing. The app builds and renders without D1.

> **Auth:** For this MVP the console endpoints are **open** (no user auth) —
> see the `TODO(auth)` comments in the route files. Do not ship publicly
> without adding real per-user authorization.

### `GET /api/keys` — list keys

Returns metadata only (never the hash or raw key).

```bash
curl -s http://localhost:3000/api/keys
```

```json
{
  "keys": [
    {
      "id": "b1f2…",
      "name": "Production server",
      "keyPrefix": "njk_live_1a2",
      "createdAt": 1752566400000,
      "revoked": 0,
      "requestCount": 42,
      "lastUsedAt": 1752570000000
    }
  ]
}
```

### `POST /api/keys` — create a key

Body: `{ "name": "..." }`. Returns the **raw key once**.

```bash
curl -s -X POST http://localhost:3000/api/keys \
  -H 'content-type: application/json' \
  -d '{"name":"Production server"}'
```

```json
{
  "id": "b1f2…",
  "name": "Production server",
  "key": "njk_live_9f3c…40hex",
  "keyPrefix": "njk_live_9f3"
}
```

`400` if `name` is missing.

### `DELETE /api/keys/[id]` — revoke a key

```bash
curl -s -X DELETE http://localhost:3000/api/keys/b1f2...
```

```json
{ "id": "b1f2…", "revoked": true }
```

`404` if no key with that id exists.

### `GET` / `POST /api/validate` — validate + meter

Supply the key via `Authorization: Bearer <key>` **or** `?key=<key>`.

```bash
# Bearer header
curl -s http://localhost:3000/api/validate \
  -H 'Authorization: Bearer njk_live_9f3c…'

# or query param
curl -s 'http://localhost:3000/api/validate?key=njk_live_9f3c…'
```

Success (`200`) — increments `request_count`, updates `last_used_at`:

```json
{ "valid": true, "keyPrefix": "njk_live_9f3", "requestCount": 43 }
```

Failure — missing, unknown, or revoked key (`401`):

```json
{ "valid": false, "error": "invalid or revoked API key" }
```

This is the endpoint the NaviJSON SDK / API consumers call on each request.

---

## Migrations

The schema change was captured with drizzle-kit:

```bash
npm run db:generate    # drizzle-kit generate → drizzle/*.sql
```

This produced `drizzle/0000_round_johnny_storm.sql` (`CREATE TABLE api_keys …`)
plus the snapshot under `drizzle/meta/`.

Apply it to a real D1 database with Wrangler:

```bash
wrangler d1 migrations apply <DB_NAME>
# or apply a single file:
wrangler d1 execute <DB_NAME> --file drizzle/0000_round_johnny_storm.sql
```

---

## Binding D1

The repo ships **without** a D1 database (`.openai/hosting.json` has
`"d1": null`), so the console renders a "Connect a D1 database" notice and the
API returns `503` until a binding is provided.

To enable it:

1. **Create a database:**

   ```bash
   wrangler d1 create navijson
   ```

2. **Bind it as `DB`** in your Wrangler/Cloudflare config (the Worker `Env`
   already expects `DB: D1Database` — see `worker/index.ts`). For control-plane
   hosting, set the `d1` field in `.openai/hosting.json` to `"DB"` (or let the
   platform inject the real binding). `getDb()` reads `env.DB`.

3. **Apply the migration** (see [Migrations](#migrations)).

Once `DB` is bound and migrated, `/console` and all endpoints work.

---

## Billing stub

Stripe is **not** integrated in this stage. The console's Billing section is a
visible stub:

- A "Billing (Stripe) — coming soon" card with **disabled** controls
  (`Manage billing`, `Upgrade`).
- No Stripe SDK, keys, webhooks, or checkout are wired up.

Usage is already metered via `request_count` / `/api/validate`, so a future
stage can map metered usage to paid plans. Search the code for `TODO` /
"stub" markers when implementing billing.
