# Lead slice verification

Implemented the selected Lead HTTP contract and Python header forwarding. This is local
service proof, not a live Arcade/Elastic/Slack integration result or the full workshop gate.

## Checks

- `bun test apps/lead-app`: 55 passed, 0 failed, 147 assertions across five files.
- `bun run --cwd apps/lead-app typecheck`: passed.
- `uv run --directory tools/lead --frozen --extra dev python -m pytest -q`: 20 passed.
- `tools/lead/.venv/bin/python -m ruff check tools/lead/lead tools/lead/tests`: passed.
- `tools/lead/.venv/bin/python -m mypy --config-file tools/lead/pyproject.toml tools/lead/lead`: passed.
- `git diff --check`: passed.

Tests require local HTTP listeners. The uv environment contains pytest as a Python module;
its standalone `pytest` executable is absent, so invoke `python -m pytest`.

## Behavior proof

| Ticket rule portion | Executable evidence |
|---|---|
| ATT1.R3: model amount cannot overwrite stored ACV | `operations.test.ts`: asserted ACV cannot replace stored ACV or record a failed write; Python lowball case |
| ATT1.R4: exact original result after restart | `operations.test.ts`: approved operation replay survives a separate lead process restart |
| ATT1.R4: response is original, not a later read | Route replay test first classifies the lead, reopens its database, and still receives the saved route response |
| ATT1.R4: complete operation binding | One key binds actor, action, resource, and complete body; changed owner/rationale/amount/actor/resource/action all conflict |
| ATT1.R4: one concurrent write | Eight concurrent classification deliveries return the same result with one decision |
| ATT1.R4: receipt and decision commit atomically | `db.test.ts`: a failing receipt-insert trigger rolls back the lead update and decision; retry succeeds after the storage fault is removed |
| OPS1.R2: preserve existing data on startup | `schema-upgrade.test.ts`: legacy rows/history survive upgrade and accept receipted writes |
| OPS1.R2: reset known state | Internal reset restores nine leads and six historical decisions, clears receipts, and resets the exercised lead |
| Internal boundaries | Missing, wrong, and unconfigured internal credentials are denied; value/receipt endpoints expose only their declared fields |
| Python-to-HTTP forwarding | Both decorated write tools call the real local Lead API with stable operation keys and preserve replay/conflict semantics |

The real HTTP service factory is `createApp({dbPath, idpHost, internalToken?})` from
`src/index.ts`, returning `fetch` and `close`. Tests use actual Bun servers and SQLite;
only the external IdP userinfo boundary is substituted in this slice.

The wider hooks tests still own grant/access rejection, and the wider agent tests own
model-facing filtering and approval continuation. Direct decorated Python tool calls do
not alone establish live MCP registration or actual Arcade authorization.

## TDD and intentional baseline changes

The initial new HTTP suite failed because `createApp` was absent. Python tests then showed
nine failures for the missing operation-key argument, old metadata, and dependent writes,
with eleven unaffected tests still passing. Implementation made both suites pass.

Existing write tests now supply distinct operation keys and authenticated actors. Their
previous mutable-estimate assertions deliberately changed to assertions against stored
ACV. Distinct operations still create separate attributed history entries; retries of one
operation do not. Tool metadata now declares both writes idempotent, matching their
required key semantics. Existing raw-response, authentication, and domain-boundary checks
remain present and passing.

No external posts, deployments, commits, or live cloud tests were performed by this slice.
