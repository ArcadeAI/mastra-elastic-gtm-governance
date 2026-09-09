# Sales toolkit

The exposed custom toolkit is **Sales**. Its directory and Python package remain `tools/lead` and `lead` for deployment compatibility.

| Arcade tool | Inputs | Behavior |
|---|---|---|
| `Sales.SearchAccounts` | `query?` | Find account summaries |
| `Sales.GetAccount` | `account_id` | Inspect current list price, billing contact, trial provisioning, and current offer |
| `Sales.CreateDiscountedOffer` | `account_id`, `discount_percent`, `list_price`, `rationale`, `operation_key` | Persist an offer and local activation-email draft together |
| `Sales.GetOffer` | `account_id` | Double-check the saved offer and activation draft |

Local MCP wire names use underscores, such as `Sales_CreateDiscountedOffer`. Discover the exact names exposed by the configured Arcade gateway before configuring the workshop.

Every tool requires `cg-idp` OAuth and the `LEAD_APP_PUBLIC_HOST` secret. The toolkit forwards the OAuth token unchanged to the account API, which derives the actor from `/oauth2/userinfo`. No tool accepts an actor or internal service credential. Host configuration accepts a full HTTP(S) URL or a bare hostname; bare local hosts use HTTP and other bare hosts use HTTPS.

`CreateDiscountedOffer` forwards the stable `operation_key` as `Idempotency-Key`. Identical actor/account/arguments return the original saved draft. Changed arguments conflict. `list_price` asserts the current yearly amount and cannot update it. For Northwind `ACC-2291`, $12,000 at 30% yields $8,400. The business API applies no approval policy; hooks own that decision.

Activation emails remain local drafts in SQLite. No email is sent. Raw responses contain only clearly synthetic `workshop_activation_FAKE_...` tokens, allowing gateway redaction to be demonstrated on the subsequent read.

```sh
uv sync --frozen --extra dev
uv run --frozen --extra dev python -m pytest -q
uv run server.py http
```

Tests run the actual registered MCP server over stdio, the real Bun business API, and a fresh SQLite store. Only external Arcade authorization and IdP userinfo are replaced by loopback HTTP fixtures. The wider workshop tests separately prove real demo IdP login and governance.

When deployment is authorized, run `arcade deploy` from this directory. `MCPApp(name="sales")` exposes the four Sales tools. No previous Lead tools are registered.
