# Discount business slice proof

The first discount API test failed against the earlier endpoint surface, then passed with the new offer transaction. This is local service and MCP proof; no cloud gateway or external message delivery was exercised.

- `bun test apps/lead-app/test`: 37 passed, 138 assertions across four files.
- `bun run --cwd apps/lead-app typecheck`: passed.
- `uv run --directory tools/lead --frozen --extra dev python -m pytest -q` from the repository root: 13 passed.
- Python Ruff and mypy: passed.

| Behavior | Executable evidence |
|---|---|
| 30% offer at $12,000 becomes $8,400 | `discount.test.ts`: saved offer and local email draft read back identically |
| Business API does not impose the AE limit | API cases accept 0%, 15%, 30%, fractional discounts, and 100%; MCP accepts 15%, 30%, and 100% |
| Malformed, negative, >100%, and forged fields do not write | API and MCP boundary cases; no resulting offer or receipt |
| Stored price cannot be replaced by a caller assertion | `LIST_PRICE_MISMATCH` response and unchanged account |
| Exact operation binding | Changed actor, account, discount, price, or rationale conflicts |
| Retries do not duplicate drafts | Eight concurrent HTTP retries, database reopen, and actual MCP subprocess restart |
| Business process restart | `persistence.test.ts`: original response and one offer/email/decision survive process replacement |
| Atomic persistence | Forced draft-insert storage failure leaves no offer, decision, or receipt; retry succeeds after recovery |
| Existing deployment data survives | Earlier tables remain intact while new sales records persist across reopen |
| Read and reset boundaries | Strict token checks, minimal internal value/receipt, explicit exercise reset |
| Registered toolkit, not direct function calls | Python suite initializes real MCP, discovers exactly four Sales tools, and invokes them over stdio |

The initial trial token and each offer token start with `workshop_activation_FAKE_`. Activation email content is stored only in SQLite. No send path exists.

Governance, authenticated approval, model-facing redaction, and agent continuation remain owned by the hooks and web integration suites. The account API deliberately returns its raw stored data.
