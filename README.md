# Governed Lead Agent: Mastra × Elastic × Arcade

Every inbound lead means the same research, qualification, and handoff. Build an agent
with Mastra that finds account context in Elastic and takes action through Arcade. Then
give it boundaries: protect sensitive data, enforce approval limits, and bring in a human
when the agent needs permission to finish the job.

Built on Matteo's [mastra-contextual-governance](https://github.com/ArcadeAI/mastra-contextual-governance),
extended for a GTM workshop with Elastic account evidence and governed lead actions.

Follow **Northwind Robotics (`LD-2291`)** from research to a completed route. Its $95,000
value exceeds Dana's $50,000 authority. Arcade blocks the write, the agent requests Riley's
approval through Slack, and the original Mastra run continues with the exact approved
arguments. The result is one write and a brief citing the account evidence.

## Workshop sequence

Each attendee builds their own agent and expands the same gateway. Each partner gets
**55 minutes, including signup and setup**. Those are planned allocations; a fresh-account
timed rehearsal is still required.

| Section | Build | Handoff |
|---|---|---|
| [1. Mastra](docs/modules/01-mastra.md) | Sign up, create the project, run the supplied Northwind question. | Save the answer and evidence gaps. |
| [2. Elastic](docs/modules/02-elastic.md) | Sign up, seed clean account context, search natively. | Save source IDs, the MCP URL, and a read-only credential. |
| [3. Arcade](docs/modules/03-arcade.md) | Connect Elastic to Mastra, then add governed Lead tools and Slack approval. | Continue the original request after Riley approves. |
| [Capstone](docs/modules/04-capstone.md) | Inspect the full journey, change evidence and policy, challenge the controls. | Collect the run's evidence and record untested checks. |

The Elastic presenter handles Elastic setup. Connecting Elastic to Arcade happens in the
Arcade section. The [arrival checklist](docs/ARRIVAL.md) and
[delivery plan](docs/WORKSHOP-PLAN.md) cover logistics and remaining rehearsal work.

## Run the starter

Use Bun 1.3.14, Node 22 for the deployed web service, and Python 3.11+ with `uv` for the
toolkits. The local setup starts with a model credential only:

```sh
git clone https://github.com/ArcadeAI/mastra-elastic-gtm-governance.git
cd mastra-elastic-gtm-governance
bun install --frozen-lockfile
cp .env.example .env
# Set MODEL_ID and its provider key in .env.
bun run doctor --stage supplied
bun run dev:web
```

Open `http://localhost:3000`, select **Build your agent**, and ask:

> What evidence supports qualifying Northwind, and what is missing?

The supplied stage requires no Arcade, Elastic, hooks, or identity service. It uses a
sanitized practice lead. **Connect evidence** adds only the observed Elastic tools from
your Arcade gateway. **Act with approval** requires the configured services and a signed-in
demo identity. A missing required connection produces an error.

## Connect and govern

Follow [Module 3](docs/modules/03-arcade.md) for account setup and consent. Run
`bun run setup --stage elastic` or `bun run setup --stage governed` for the corresponding
guide and configuration checkpoints. Setup prints instructions; provisioning and consent
remain explicit attendee steps.

The [Render blueprint](render.yaml) defines the web, hooks, Lead, and IdP services with
persistent disks. Deploy the Python [Lead](tools/lead/README.md) and
[Approvals](tools/approvals/README.md) toolkits through Arcade separately.

Discover the gateway's actual names before configuring them:

```sh
bun run discover
# Choose exact Elastic names from that inventory, then save the selection:
bun run discover --elastic-tools '<exact-name>,<exact-name>' --output .workshop/discovery.json
bun run doctor --stage elastic
```

Copy the selected configuration into `.env` or service settings. Keep the same gateway
when adding Lead and Approvals. Configure and verify all three Arcade hooks before
activating the normal demo roles or seeding the governed Elastic fixture. The
[runtime contract](docs/RUNTIME-CONTRACT.md) documents the service boundaries.

One attendee can play both roles. Dana uses the attendee's Arcade account email and
authorizes their own Slack account in the workshop workspace. The notification goes to
that account's self-DM. Riley has a separate seeded OAuth identity and credentials; no
extra inbox or second person is required. The link carries no permission to approve.
Signing in as Riley preserves Dana's waiting run. **Approve exact action** commits the
decision through Arcade and resumes Dana's agent; **Resume Dana's agent** can retry the
continuation without creating a new task.

## Controls

- **Access:** Sam cannot discover or execute routing.
- **Authority:** hooks read Northwind's stored value, so a lowball model argument cannot
  bypass Dana's limit. Approval applies to the exact actor, action, and arguments.
- **Privacy and integrity:** post hooks remove the fixture's personal phone and injected
  instruction before tool results reach the model, including successful write results.
- **Durability:** native Mastra snapshots preserve the human wait. Lead's transactional
  operation receipt makes exact retries return the original result with one write.

The fixture filter demonstrates configured privacy and integrity rules. It does not claim
to detect arbitrary prompt injection.

## Repository layout

```text
apps/web         Next.js UI, OAuth sessions, Mastra stages and LibSQL snapshots
apps/hooks       Arcade access/pre/post hooks, policy, approvals, grants, safe audit
apps/lead-app    Plain Lead HTTP API, SQLite records and operation receipts
apps/idp         Better Auth OAuth fixture and stable workshop clients
tools/lead       Python MCP tools for Lead reads and writes
tools/approvals  Python MCP tools for Slack requests and authenticated decisions
elastic/        Account-context fixture and Elastic setup guide
scripts/        Setup, discovery, readiness, seed, reset, evidence collection
packages/governance-core  Policy evaluation, visibility and approver selection
packages/policy-schema    Validated policy and Arcade hook contracts
```

The Lead API knows authenticated identity and business records. Governance stays in
hooks. The agent reaches business tools through the attendee's Arcade gateway; direct
Elasticsearch credentials belong only to operator seed/reset tooling.

## Contributor checks and local services

```sh
bun install --frozen-lockfile --cwd apps/idp
bun run typecheck
bun test
bun run --cwd apps/web build
uv run --directory tools/lead --frozen --extra dev python -m pytest
uv run --directory tools/approvals --frozen --extra dev python -m pytest
```

For local governed development, configure the separate secrets and service URLs in
`.env.example`, then run each service in its own terminal:

```sh
bun run dev:hooks       # :8081
bun run dev:lead-app    # :8082
bun run dev:idp         # :8083
bun run dev:web         # :3000
```

Use the UI's real OAuth sign-in for governed requests. See [web setup](apps/web/README.md)
and the [IdP guide](apps/idp/README.md) for client registration and demo credentials.

## Verification status

The runtime, hooks, Python tools, staged UI, authenticated approvals, persisted
continuation, and operator commands are implemented. See
[local verification](docs/LOCAL-VERIFICATION.md) for observed checks and remaining gaps.
Local tests control the external model, Arcade, Slack, and Elastic boundaries. They send
no live Slack messages and do not certify cloud interoperability or workshop timing.

After completing a governed run, collect its existing evidence with:

```sh
bun run capstone --run-id '<run-id>' --output .workshop/evidence
```

This reads evidence without starting an agent or sending a message. Missing evidence is
reported as incomplete; a read-only Elastic fallback is degraded. Live registration,
model results, Slack delivery, and the full timed attendee walkthrough still need an
authorized rehearsal.

~ 🕷️ Anansi, Thierry's Agent
