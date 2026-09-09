# Renewal business slice proof

The first renewal API test failed because customer_message was rejected by the earlier schema, then passed with the authored follow-up transaction. This is local service and MCP proof; no cloud gateway or external message delivery was exercised.

- `bun test apps/lead-app/test`: 44 passed, 178 assertions across four files.
- `bun run --cwd apps/lead-app typecheck`: passed.
- `uv run --directory tools/lead --frozen --extra dev python -m pytest -q` from the repository root: 16 passed.
- Python Ruff and mypy: passed.

| Behavior | Executable evidence |
|---|---|
| 30% offer at $12,000 becomes $8,400 | `discount.test.ts`: saved offer and local follow-up draft read back identically |
| Business API does not impose the AE limit | API cases accept 0%, 15%, 30%, fractional discounts, and 100%; MCP accepts 15%, 30%, and 100% |
| Malformed, negative, >100%, and forged fields do not write | API and MCP boundary cases; no resulting offer or receipt |
| Stored price cannot be replaced by a caller assertion | `LIST_PRICE_MISMATCH` response and unchanged account |
| Exact operation binding | Changed actor, account, discount, price, rationale, or customer_message conflicts |
| Retries do not duplicate drafts | Eight concurrent HTTP retries, database reopen, and actual MCP subprocess restart |
| Business process restart | `persistence.test.ts`: original response and one offer/email/decision survive process replacement |
| Atomic persistence | Forced draft-insert storage failure leaves no offer, decision, or receipt; retry succeeds after recovery |
| Existing deployment data survives | Earlier tables remain intact while new sales records persist across reopen |
| Read and reset boundaries | Strict token checks, minimal internal value/receipt, explicit exercise reset |
| Registered toolkit, not direct function calls | Python suite initializes real MCP, discovers exactly four Sales tools, and invokes them over stdio |

The API accepts an authored nonblank message of at most 4,000 characters, preserves it verbatim, chooses the billing recipient and subject, and appends canonical annual terms. Missing, blank, overlong, and forged recipient/sender fields are rejected. The sample follow-up accurately states that SCIM deprovisioning remains unresolved; writing an offer leaves the support case open.

Support credentials are synthetic fixture values under `support.api_key`; the offer has no activation token. Follow-up content is stored only in SQLite. No send path exists.

Governance, authenticated approval, model-facing redaction, and agent continuation remain owned by the hooks and web integration suites. The account API deliberately returns its raw stored data.
