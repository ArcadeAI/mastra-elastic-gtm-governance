# How the template works

The internals behind the [Quickstart](../README.md#quickstart-): the four control points Arcade gives every tool call, the two places Arcade establishes who you are, and where each part lives in the repo.

## How the controls work

Arcade gives every tool call four control points, each keyed on the signed-in person. The model sits inside all of them:

| # | Layer | Keyed on | Mechanism |
|---|---|---|---|
| 1 | Whether you can see the tool | identity | `/hooks/access` → `deny` list |
| 2 | Whether you hold the credential to call it at all | identity | per-tool auth requirement, OAuth scopes |
| 3 | Whether you have the authority for *this* call | identity + policy | `/hooks/pre` → `CHECK_FAILED` |
| 4 | What comes back | policy | `/hooks/post` → `override.output` |

Layers 1, 3 and 4 are HTTP endpoints this app serves under `/hooks`, and Arcade calls them. Layer 2 is Arcade's own.

**Layer 2 is invisible to the control plane, and that constrains what you can stage.** Arcade evaluates auth requirements before `/hooks/pre`, so a refusal there fires no hook, writes no audit row and shows nothing on the panel. If something you expected to see is missing, check the OAuth registration before you suspect the control plane.

**Two spellings of one tool name, and they are not interchangeable.** MCP advertises `Deals_GetDeal`, which is what the model can call. Hook payloads, audit rows and policy rules use `Deals.GetDeal`. Key rules the dot way, and write the underscore spelling in any text addressed to the model, such as a denial's remediation sentence. A rule keyed on `get_deal` matches nothing, and a rule that matches nothing is indistinguishable from a rule that permits.

Two claims are enforced by tests rather than asserted:

- **The business system does not know it is governed.** `app-test/loans/knows-nothing-about-governance.test.ts` fails if governance vocabulary (`policy`, `role`, `limit`, `redact`, `authority`, `approver`, `permission`) appears in `lib/loans/`, or if it imports a `@cg/*` package. The pull to add "just one guard" there is real, and that test is the thing that says no.
- **`packages/governance-core` depends on no app.** `packages/governance-core/test/no-app-dependencies.test.ts` fails if it declares a dependency on an app package or imports from one.

A control that silently does nothing is worse than no control. Every identifier in the policy is measured off a real deployment rather than derived, and every `/hooks/post` pattern is proved to fire against a corpus.

## Two OAuth hops, two mechanisms

Conflating them cost a day. The full diagram is in [`DESIGN.md`](../DESIGN.md#identity-and-oauth).

| | hop | mechanism |
|---|---|---|
| **1** | MCP client → gateway | the gateway's **User Source**, whose issuer is the app's own sign-in |
| **2** | tool → the loan API | the `app-identity` auth provider, plus a **custom user verifier** route in the app, `/api/arcade/verify` |
| **2** | `Approvals_RequestApproval` → Slack | Arcade's stock Slack provider, which goes through **Arcade's own verifier**: the requester must be a member of the Arcade project |

Neither mechanism moves the other. Arcade's default verifier demands an Arcade account that is a project member. For the deal tools your users need none, because the custom verifier binds the grant to the signed-in person; without it, a user verified against the wrong account binds the grant to the wrong user and the tool re-challenges forever. The custom verifier covers custom providers only. Arcade sends its built-in providers, Slack among them, through its own verifier, so anyone who requests an approval must be invited to the Arcade project under their email. `bun run setup-arcade` sets the custom verifier and reads it back through the admin API, which is the check to trust rather than a dashboard label.

**Email is the join key.** Arcade's `user_id`, the OAuth subject and the actor the loan module records are the same string, lowercase. If they diverge, `governance.db` and `loans.db` describe different people and the audit trail is fiction. The loan module takes the actor from the token, never from a request parameter, because an actor passed as an argument is an actor the model can forge.

## Project layout

One TypeScript app at the repo root (Next.js plus `src/mastra`, running on Bun) and two Python toolkits:

```
src/mastra/index.ts        The Mastra entry. Registers the loan-operations agent, the same one the chat runs.
lib/agent/                 The agent: instructions, the governed toolset, Studio's own gateway authorization
                           and thread memory (memory.db).
lib/control-plane/         /hooks/access, /hooks/pre, /hooks/post: the policy engine, audit log and event
                           stream. Owns governance.db. The policy fixture is fixtures/governance.json.
lib/loans/                 The bank's system of record, a plain HTTP API under /bank. Owns loans.db.
                           No MCP, no Arcade, no governance.
lib/identity/              Sign-in, sessions and the custom verifier. lib/identity/provider/ is the app's
                           own OAuth 2.1 provider (Better Auth). Owns idp.db.
app/                       The pages: the bank at /, the loan board at /loans, the panel at /panel,
                           approval pages at /approvals/<id>, readiness at /health.

tools/loan                 Python arcade-mcp: SearchDeals, GetDeal, ApproveDiscount, DenyDiscount.
                           A stateless client of /bank, via APP_PUBLIC_HOST.     → arcade deploy
tools/approvals            Python arcade-mcp: RequestApproval, Decide.         → arcade deploy

packages/governance-core   Hook framework, policy engine, audit, event bus. No loan references.
packages/policy-schema     Shared zod types for policy, events and hook payloads.
```

`lib/loans/` is not an MCP server on purpose. Banks have APIs, not MCP servers, and keeping the tool layer in `tools/loan` means pointing a thin toolkit at an API you already have. The toolkits are Python because `arcade-mcp`, the tool-authoring framework, is Python-only. Nothing else in the repo is Python.

The toolkits have their own READMEs: [`tools/loan`](../tools/loan/README.md) and [`tools/approvals`](../tools/approvals/README.md).
