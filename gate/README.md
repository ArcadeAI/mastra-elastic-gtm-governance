# gate/ — the contextual-access policies, and the service that enforces them

One command starts it:

    bun run gate

That prints every rule the service will enforce, then starts the app, which the
service is a module of (`gate/service/`, mounted at `/hooks/access`, `/hooks/pre` and
`/hooks/post`). Arcade calls those three URLs on every tool call through the gateway,
and what they answer is decided here, by code in this repo, against rows in a SQLite
file on your disk. There is no hosted policy store and nothing to sign up for.

| | |
|---|---|
| `policies/governance.json` | The rules, and the demo cast. Read once, when `governance.db` has no schema; after that the rows in the database are the policy. |
| `service/` | The webhook service: policy cache, the three handlers, the audit log, the event stream the panel watches, the approvals store. |
| `engine/` | `@cg/governance-core`: the policy compiler and evaluator, redaction, audit. Knows nothing about loans. |
| `schema/` | `@cg/policy-schema`: the zod types for rules, hook payloads and events, shared by the service, the tools' tests and the panel. |

## The three rules to read first

Every rule lives in `policies/governance.json`, keyed on `$TOOLKIT`, which `ARCADE_TOOLKIT`
fills in (`DealDesk`). Three of them carry the workshop, one per hook:

1. **`/hooks/access` — `access.analysts-cannot-see-approve`** and
   **`access.sdr-cannot-request-approval`.** An SDR does not see `ApproveDiscount` or
   `RequestApproval` in the tool list at all. A tool that is not offered cannot be called,
   and the model never has to be told not to. The second rule is why Bob's agent never
   reaches a Slack consent: an SDR has no discount decision to escalate.
2. **`/hooks/pre` — `pre.approve-within-clearance`.** An account executive with $50K of
   authority asking to approve $95K is refused before the call runs, and the refusal tells
   the model what to do instead: `DealDesk_RequestApproval`. That is act 2.
3. **`/hooks/post` — `post.redact-customer-identifiers`.** The bank account number and tax
   id come out of every deal record before the model reads it, for anyone under the
   chief revenue officer's clearance. The tool ran; the model still never saw them.

The rest are the same three ideas applied again: who may write the Elasticsearch index,
what an ES|QL query may return, and what an approver may decide. `bun run gate` lists them.

## Editing a rule live

`governance.db` is the policy once seeded. Edit a row and the cache picks it up within
`POLICY_POLL_MS`; a rule that no longer compiles takes the whole policy down and every
hook fails closed, loudly, which is the point (DESIGN.md → fail closed). `bun run reset`
puts the seed back. The panel at `/panel` shows every decision as it is made.
