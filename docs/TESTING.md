# Test the workshop

Record a fresh result for the at-risk renewal revision. Earlier workshop-test counts do not
certify this version. Use the local suite to check the implementation, then rehearse the account setup and real
connections separately. A passing build or four healthy services does not establish a
working Elastic search, live Slack delivery, or a completed approval loop.

## Local checks without real Slack

From the repository root, with Bun 1.3.14, Node 22, Python 3.11+ and `uv` installed:

```sh
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd apps/idp
uv sync --frozen --extra dev --directory tools/lead
bun run test:workshop
```

The workshop suite uses the real application services, SQLite/LibSQL, IdP OAuth, and Sales
MCP server. Model, Arcade, Elastic, and Slack collaborators run on loopback addresses. It
needs permission to bind local ports and creates temporary fixture data; it does not need
cloud credentials or send real Slack messages. There is one Python toolkit environment.

For a contributor's full check, use the commands exercised by CI:

```sh
bun run typecheck
bun run --cwd apps/idp typecheck
bun test
bun run --cwd apps/web build
bun run --cwd packages/policy-schema generate:check
bun run --cwd apps/idp generate:check
uv run --directory tools/lead --frozen --extra dev ruff check lead tests
uv run --directory tools/lead --frozen --extra dev python -m mypy
uv run --directory tools/lead --frozen --extra dev python -m pytest
```

Keep Node 22 active for the web build. CI also builds and boots each Docker image and
checks web's `/api/session` route, which loads more dependencies than `/health`.
[Local verification](LOCAL-VERIFICATION.md) records executed checks with their dates and
limits; rerun the commands above for your current revision. This page is a procedure, not
a new test result.

## Rehearse in the attendee's order

Use your own fork, accounts, gateway, fixture index, and supporting services. Follow
[Arrival](ARRIVAL.md) and [Operator setup](OPERATOR.md) for commands and configuration.
Record the source revision and the actual deployed revision before comparing results.
Commit Module 1's instruction edits before deployment. Use the hosted web origin for the
governed exercise and copy its actual service URLs/credentials into the private root
`.env` for operator commands, following Operator setup. A localhost browser session does
not transfer to the hosted OAuth callback.

| Step | Action | Expected observation |
|---|---|---|
| Mastra | Follow Module 1, run `bun run doctor --stage supplied`, then run the saved Northwind question in **Build your agent**. | A model response with evidence gaps. **Inspect available tools** is empty. |
| Elastic | Follow Module 2, run `bun run workshop seed --variant clean`, retrieve Northwind in Agent Builder, and check native MCP inventory. | Exactly eight seeded events; an answer supported by at least two source IDs; a usable MCP URL and separate read-only key. |
| First connection | In Module 3 register native Elastic MCP with Arcade, select observed tools, and run `bun run doctor --stage elastic`. Ask the same question in **Connect evidence**. | The same Mastra agent cites the Elastic records through the attendee's gateway. |
| Supporting services | Follow Operator setup's first-boot and OAuth steps. | Four healthy services, a configured web client, and a Dana login showing **Workshop Agent** at the IdP. |
| Hook mapping | Follow Operator setup: discovery → `hook-tools` → select actual Elastic names with empty argument lists → redeploy hooks → clean read → `hook-tools` again. | Observed toolkit/tool names and argument keys configure the hooks without guessing. Normal Sales roles remain staged. |
| Governance probe | Sign in as the separate verification identity, discover its Sales tools, then run `verify-governance` with the observed GetAccount name. | A fresh filtered read and matching authority denial, without a model run, approval request, or Slack send. |
| Activate | Run `bun run workshop activate`, attendee discovery, governed doctor, then governed seeding. | Normal roles see the intended tools; Sam cannot discover offer creation; the governed fixture loads only after activation. |
| Full exercise | Use the default governed discount offer as Dana, finish authorization, receive the self-DM, then authenticate as Riley and approve. | Dana's original run continues through Arcade, records one draft offer and verifies it with GetOffer, and returns a cited brief. |
| Hook lab | Follow capstone: init → fail the empty starter → add support-owner removal → test → apply → gateway verify as Dana. | Local fixture and gateway-read proof are reported separately; owner email is absent while renewal, issue and price remain. |

The governance probe uses a deliberately empty rationale as a second barrier against a
write if `/pre` is missing. It still requires actual
hook evidence to pass. Do not replace it with a valid offer action as a setup check. The probe
checks the account fixture output; verify the actual Elastic result shape and fail-closed hook
settings as separate live observations.

## Where messages and writes begin

| Action | External effect |
|---|---|
| `setup`, `discover`, `hook-tools`, `doctor`, health checks, tool inventory | Configuration and reads; no model run or Slack message. |
| Web role login or provider consent | Creates authentication state. Consent alone does not post a message. |
| `verify-governance` | Calls the gateway for a filtered read and a denied discount-offer probe; creates hook audit evidence. No approval request or Slack call. |
| `activate` | Changes policy state to enable normal attendee access. |
| `hook-lab init` / `test` | Writes the local starter file / tests the real local filter. No cloud call, model, offer or message. |
| `hook-lab apply` | Updates your hooks service's policy while preserving existing controls. No offer or message. |
| `hook-lab verify` | Executes GetAccount through your gateway as Dana. Read-only; no model or Slack call. |
| Supplied or Elastic **Run your agent** | Uses the configured model; Elastic mode also executes selected read tools. |
| Governed **Run your agent** | Can request approval and send a real self-DM immediately after Arcade denies the discount. This happens before **Approve exact action**. |
| **Retry Slack notification** after consent | Can deliver the saved request to the authorized self-DM. Check its existing delivery state first. |
| Riley's **Approve exact action** | Records the decision and starts continuation of Dana's original action through Arcade. A successful action saves a draft offer and follow-up email in the account fixture. |
| `seed` or `reset` | Changes fixture/service state. Reset removes extra documents from the dedicated index and clears exercise history. |
| `capstone --run-id ...` | Reads an existing run and evidence; starts no agent and sends no message. |

Use the workshop Slack workspace and authorize your own account. The solo flow resolves
the actual Slack user and opens that user's DM; it does not accept a channel chosen by
the model. The message names Dana and Riley, while Slack displays the real account that
authorized delivery. One person can play both demo roles. The link itself grants no
approval authority.

For a check that stops before Slack, finish the governance probe and inspect its report.
Do not click the governed Run or notification continuation controls. An ambiguous Slack
send must not be retried automatically; inspect the saved delivery state before recovery.

The offer has `status: "draft"`, and `follow_up_email` remains a local draft. Its required
`customer_message` should acknowledge declining usage and open SCIM deprovisioning delays,
without asserting an unverified cause or fix date. Riley reviews that text with the terms.
The API owns the recipient and appends canonical prices and the draft label. The model
must not receive `support.api_key`, its fake key string or the synthetic personal phone.
No customer email or signature request is sent.

Configure `ARCADE_GET_OFFER_TOOL_NAME` from discovery. Completion requires its successful
call after the write, matching the saved offer ID, account, discount, list price, net price,
draft status and exact nonblank follow-up recipient/subject/body. A missing, failed or mismatched read reports the saved offer and failed
verification, without claiming completion or creating another draft. Inspect the actual
tool call and returned terms. Local connected tests use a scripted model; record a separate
live-model run before claiming that behavior works in the demo. Check the actual customer
message for evidence and uncertainty; matching saved text alone does not establish its quality.

## Complete and record the live exercise

Use [Module 3](modules/03-arcade.md) for the first approval and
[Capstone](modules/04-capstone.md) for the negative cases. Save the run ID, requester,
assigned approver, source IDs, denial event, delivery acknowledgement, authenticated
decision, resumed action, and operation receipt. Confirm that Dana's self-approval fails,
Riley can approve the assigned action, and replay creates no second write.

```sh
bun run capstone --run-id '<existing-run-id>' --output .workshop/evidence
```

Missing or independently unverified cloud evidence stays incomplete. `--live` does not
turn service records into proof that every cloud boundary was tested. Keep a manual
rehearsal record alongside the collector, with no credentials or raw sensitive output:

```text
Revision / deployed revision:
Date, OS, onsite or remote:
Mastra: started / checkpoint / minutes / assistance:
Elastic: started / checkpoint / minutes / assistance:
Arcade: started / first cited answer / approved offer / minutes / assistance:
Capstone: source IDs / run ID / operation key / pass or remaining gap:
Fallback used and exercises watched rather than completed:
```

Each partner has 55 minutes including signup, with 20 minutes for capstone. Record email
verification, account provisioning, dependency installation, consent and human assistance
inside those times. Windows and fresh-account timing still need rehearsal. The organizer
must settle model-credit access, the Slack invite, and remote help before the event.

Preserve evidence before `bun run reset --variant clean`. Reset signs demo roles out and
preserves the two OAuth clients. Reverify and activate governance before another governed
fixture/exercise. A partial reset or a shared read-only Elastic fallback must remain marked
incomplete or degraded for the exercises it could not cover.
