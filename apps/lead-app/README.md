# Sales system of record

This Bun service stores accounts, yearly offers, local activation-email drafts, and operation receipts. Arcade hooks enforce approval outside this service. The business API accepts any valid discount from 0 through 100 percent; it does not implement the AE or manager rules.

The existing directory, package, service ID, and environment names remain stable. Run `bun run --cwd apps/lead-app dev` with `LEADS_DB_PATH`, `IDP_PUBLIC_HOST`, `LEAD_INTERNAL_TOKEN`, and optional `PORT` (default 8082). Startup creates the sales tables without deleting earlier workshop tables or reseeding existing sales records.

## HTTP interface

Account routes require the caller's IdP bearer token. The API resolves its email through `/oauth2/userinfo`; request bodies cannot choose the actor.

| Route | Input or result |
|---|---|
| `GET /health` | `{status, service: "lead-app", accounts}`; no token required |
| `GET /accounts?q=` | Optional case-insensitive ID, company, or domain search; `{count, accounts}` |
| `GET /accounts/:id` | Account, list price, billing contact, trial provisioning, latest `offer` or null, and decisions |
| `GET /accounts/:id/offer` | Latest saved offer; 404 before one exists |
| `POST /accounts/:id/offers` | Strict `{discount_percent, list_price, rationale}` |

The fixture matches the five accounts in the Elastic evidence. Northwind Robotics is `ACC-2291`, buying B2B identity and access software at a yearly list price of $12,000. A 30% discount produces an $8,400 yearly draft. Prices round to cents. The asserted `list_price` must equal the stored price; stale assertions return `409 LIST_PRICE_MISMATCH` without saving anything.

Creating an offer requires an `Idempotency-Key` of 1–128 ASCII letters, digits, dots, underscores, colons, or hyphens. One SQLite immediate transaction saves the offer, its activation-email draft, decision history, and receipt. An exact actor/account/body retry returns the original result, even after later offers or restart. A changed request returns `409 OPERATION_CONFLICT`. Successful responses include `Idempotency-Replayed: true|false`.

Offers contain `account_id`, `offer_id`, `discount_percent`, `list_price`, `net_price`, `status: "draft"`, `activation_email`, and `decisions`. The email has `to`, `subject`, `body`, and a synthetic `activation_token`. All tokens start with `workshop_activation_FAKE_`; the initial trial token allows setup filtering to be checked before an offer exists. Reads return raw stored values so Arcade can demonstrate downstream redaction.

**Email stays in SQLite.** There is no email transport, delivery endpoint, or send worker. Offer creation cannot send an email or activate a real service.

## Internal interface

These routes require `Authorization: Bearer LEAD_INTERNAL_TOKEN`; they remain closed if the token is unconfigured.

| Route | Result |
|---|---|
| `GET /internal/accounts/:id/value` | `{account_id, list_price}` |
| `GET /internal/operations/:key` | `{operation_key, actor, action: "discount", account_id, body, completed_at}`; 404 if absent |
| `POST /internal/reset` | Restore five accounts and clear sales drafts, decisions, receipts; `{accounts, offers: 0, activation_emails: 0, decisions: 0, operations: 0}` |

Reset leaves OAuth credentials and earlier workshop tables intact. Receipts omit raw activation data.

## Embedding and verification

`createApp({dbPath, idpHost, internalToken?})` exports `fetch` and `close` without starting a server. Tests use real HTTP, SQLite, atomic rollback, concurrent retries, and a separate business-process restart. Run `bun test apps/lead-app/test` and `bun run --cwd apps/lead-app typecheck`. The Sales toolkit suite also exercises the registered MCP subprocess against this real API.
