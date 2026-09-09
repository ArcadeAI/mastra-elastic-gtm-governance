# Lead system of record

This Bun service owns lead records, decision history, and durable operation receipts.
It identifies callers through the demo IdP and applies domain writes. Arcade's hooks
control access and approval outside this service.

Run `bun run --cwd apps/lead-app dev`. Configure `LEADS_DB_PATH`, `IDP_PUBLIC_HOST`,
`LEAD_INTERNAL_TOKEN`, and optionally `PORT` (default 8082). Database startup preserves
existing records and adds the operation table to older databases.

## HTTP interface

Public `/leads` routes require the caller's IdP OAuth bearer. The service resolves the
actor through `/oauth2/userinfo`; bodies cannot provide an actor.

| Route | Input or result |
|---|---|
| `GET /health` | Service name and lead count; no bearer required |
| `GET /leads` | Optional status, minimum ACV, and maximum ACV query filters |
| `GET /leads/:id` | Complete lead record and ordered decision history |
| `POST /leads/:id/route` | `{estimated_acv, owner_email, rationale}` |
| `POST /leads/:id/classify` | `{disposition, rationale}` |

Both writes require `Idempotency-Key`: 1–128 ASCII letters, digits, dots, underscores,
colons, or hyphens. `route` checks that the supplied estimate equals the stored value;
a mismatch returns `409` with code `ACV_MISMATCH` and changes nothing.

A SQLite immediate transaction commits the decision and response snapshot together.
The key binds actor, action, lead, and complete validated body. An exact retry returns
that original snapshot, even after later changes or process restart. A changed request
returns `409` with code `OPERATION_CONFLICT`. Missing or malformed keys return `400`.
Successful responses retain the complete Lead record shape and include `Idempotency-Key`
and `Idempotency-Replayed: true|false` headers.

Distinct operations retain separate history entries. Reads and successful writes include
the original phone and form content; the gateway post-hook handles model-facing filtering.

## Internal interface

These routes require `Authorization: Bearer LEAD_INTERNAL_TOKEN`. They remain inaccessible
when the service has no internal token configured. The token belongs to internal callers
and operator tooling, not to the model's tool configuration.

| Route | Result |
|---|---|
| `GET /internal/leads/:id/value` | Only `{lead_id, estimated_acv}` |
| `GET /internal/operations/:key` | `{operation_key, actor, action, lead_id, body, completed_at}`; 404 if absent |
| `POST /internal/reset` | Restore the checked-in fixture and clear receipts atomically; `{leads, decisions, operations}` |

Receipt actions are `route` or `classify`. The receipt never includes the saved raw result.
Reset preserves historical fixture decisions: the current baseline restores nine leads,
six historical decisions, and zero operations. It changes no OAuth clients or credentials.

## Embedding and verification

`createApp({dbPath, idpHost, internalToken?})` is exported from `src/index.ts`; imports do
not start a server. Use `Bun.serve({port: 0, fetch: app.fetch})` for an ephemeral real HTTP
service and call `app.close()` after stopping its server.

Run `bun test apps/lead-app` and `bun run --cwd apps/lead-app typecheck`. The tests exercise
real HTTP, SQLite rollback, concurrent delivery, separate-process restart, legacy schema
upgrades, exact receipts, internal authentication, and fixture reset. The toolkit's separate
Python suite exercises the actual toolkit-to-service HTTP boundary.
