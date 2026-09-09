# Sales system of record

This Bun service stores accounts, yearly offers, local renewal follow-up email drafts, and operation receipts. Arcade hooks enforce approval outside this service. The business API accepts any valid discount from 0 through 100 percent; it does not implement the AE or manager rules.

The existing directory, package, service ID, and environment names remain stable. Run `bun run --cwd apps/lead-app dev` with `LEADS_DB_PATH`, `IDP_PUBLIC_HOST`, `LEAD_INTERNAL_TOKEN`, and optional `PORT` (default 8082). Use a fresh database path for this revision, such as `./renewal.db` (the default). Earlier exercise databases are preserved separately and are not converted. Existing renewal records are not reseeded on restart.

## HTTP interface

Account routes require the caller's IdP bearer token. The API resolves its email through `/oauth2/userinfo`; request bodies cannot choose the actor.

| Route | Input or result |
|---|---|
| `GET /health` | `{status, service: "lead-app", accounts}`; no token required |
| `GET /accounts?q=` | Optional case-insensitive ID, company, or domain search; `{count, accounts}` |
| `GET /accounts/:id` | Account, list price, billing contact, active subscription and open support case, latest `offer` or null, and decisions |
| `GET /accounts/:id/offer` | Latest saved offer; 404 before one exists |
| `POST /accounts/:id/offers` | Strict `{discount_percent, list_price, rationale, customer_message}` |

The fixture matches the five accounts in the Elastic evidence. Northwind Robotics is `ACC-2291`, buying B2B identity and access software at a yearly list price of $12,000. A 30% discount produces an $8,400 yearly draft. Prices round to cents. The asserted `list_price` must equal the stored price; stale assertions return `409 LIST_PRICE_MISMATCH` without saving anything.

Creating an offer requires an `Idempotency-Key` of 1–128 ASCII letters, digits, dots, underscores, colons, or hyphens. One SQLite immediate transaction saves the offer, its follow-up email draft, decision history, and receipt. An exact actor/account/body retry returns the original result, even after later offers or restart. A changed request returns `409 OPERATION_CONFLICT`. Successful responses include `Idempotency-Replayed: true|false`.

Offers contain `account_id`, `offer_id`, `discount_percent`, `list_price`, `net_price`, `status: "draft"`, `follow_up_email`, and `decisions`. The follow-up email has only `to`, `subject`, and `body`. The API chooses the account billing recipient and a renewal subject; callers cannot set either or choose a sender. `customer_message` is required, nonblank, and at most 4,000 characters. It is preserved verbatim in the local draft and exact receipt binding, with a draft label and canonical annual list price, discount, and net price added by the API.

Northwind has an active subscription renewing October 31, 2026, and unresolved SCIM deprovisioning case `CS-1042`. Its account detail retains the support summary, a clearly synthetic `support.api_key` (`workshop_support_FAKE_northwind_003`), `support.internal_owner_email`, and billing contact phone so gateway output filtering can be demonstrated. Saving renewal terms does not change the support case or claim the issue is fixed.

**Email stays in SQLite.** There is no email transport, delivery endpoint, or send worker. Offer creation cannot send an email.

## Internal interface

These routes require `Authorization: Bearer LEAD_INTERNAL_TOKEN`; they remain closed if the token is unconfigured.

| Route | Result |
|---|---|
| `GET /internal/accounts/:id/value` | `{account_id, list_price}` |
| `GET /internal/operations/:key` | `{operation_key, actor, action: "discount", account_id, body, completed_at}`; 404 if absent |
| `POST /internal/reset` | Restore five accounts and clear sales drafts, decisions, receipts; `{accounts, offers: 0, follow_up_emails: 0, decisions: 0, operations: 0}` |

Reset leaves OAuth credentials and earlier workshop tables intact. Receipts include the exact authored customer message and commercial inputs; they do not copy support details.

## Embedding and verification

`createApp({dbPath, idpHost, internalToken?})` exports `fetch` and `close` without starting a server. Tests use real HTTP, SQLite, atomic rollback, concurrent retries, and a separate business-process restart. Run `bun test apps/lead-app/test` and `bun run --cwd apps/lead-app typecheck`. The Sales toolkit suite also exercises the registered MCP subprocess against this real API.
