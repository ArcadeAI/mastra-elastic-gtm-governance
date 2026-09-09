# Governed discount offers: Mastra × Elastic × Arcade

Your AE needs to renew Northwind's identity and access software. The buyer asks for 30%
off a $12,000 annual list price. Build a Mastra agent that investigates the request in
Elastic, prepares the offer through Arcade, and brings in a manager when the requested
discount exceeds the AE's permission.

Dana can offer up to 15% without manager review. Arcade blocks the 30% action, and the app requests Riley's
approval in your Slack self-DM. Riley can approve up to 40%. After Riley approves, Dana's
original action resumes with the exact saved terms: $12,000 list, 30% discount, $8,400 net.
The agent reads the saved offer back and checks those terms. Arcade removes the synthetic
activation token from the model-facing account and activation-email draft.

**The offer and activation email are drafts stored in the workshop account system.**
This exercise sends a Slack self-DM; it sends no customer email and creates no external
signature envelope or real customer account.

Built on [Arcade's contextual governance workshop](https://github.com/ArcadeAI/mastra-contextual-governance),
with native Elastic evidence and one attendee-owned gateway.

## Follow the workshop

Each attendee keeps their own agent and gateway throughout. Each partner has **55 minutes,
including signup and setup**, for onsite and remote attendees. Capstone adds 20 minutes.
These are teaching allocations; the discount path still needs a timed fresh-account run.

| Section | What you build | Checkpoint |
|---|---|---|
| [1. Mastra](docs/modules/01-mastra.md) | Sign up and run the supplied Northwind question locally. | A recommendation with explicit evidence gaps. |
| [2. Elastic](docs/modules/02-elastic.md) | Sign up, seed renewal context, and investigate it natively. | Cited evidence, MCP URL and read-only key. |
| [3. Arcade](docs/modules/03-arcade.md) | Connect Elastic, add Sales tools and verify discount controls. | Riley approves; Dana's exact offer is saved once and read back. |
| [Capstone](docs/modules/04-capstone.md) | Inspect terms, redaction, identity and replay. | One draft offer, safe draft email and correlated evidence. |

[Arrival](docs/ARRIVAL.md) covers prerequisites. [Operator setup](docs/OPERATOR.md) gives the
portable deployment and consent sequence. [Testing](docs/TESTING.md) distinguishes local
checks, the no-Slack verification probe and the authorized self-DM exercise.

## Run the first stage

Use Bun 1.3.14 and Node 22. Python 3.11+ and `uv` enter in the Arcade section for the one
custom **Sales** toolkit, located in `tools/lead`.

```sh
git clone https://github.com/ArcadeAI/mastra-elastic-gtm-governance.git
cd mastra-elastic-gtm-governance
bun install --frozen-lockfile
test -f .env || cp .env.example .env
# Set MODEL_ID and its provider key in .env.
bun run doctor --stage supplied
bun run dev:web
```

Open `http://localhost:3000`, select **Build your agent**, and ask:

> What evidence supports Northwind's requested 30% renewal discount, and what still needs checking?

This uses supplied input and a model credential. Save the response for comparison with
Elastic. The instructions are in `apps/web/lib/lead-agent.ts`; this repository does not
automatically upload local runs to Mastra Cloud.

## Add evidence, then the offer action

Elastic's section prepares the [native Agent Builder MCP endpoint](elastic/README.md).
Arcade's section connects it to the same agent:

```sh
bun run setup --stage elastic
bun run discover
bun run discover --elastic-tools '<exact-name>,<exact-name>' --output .workshop/discovery.json
bun run doctor --stage elastic
```

Copy selected names from the returned inventory into the web configuration. **Connect
evidence** should cite at least two Northwind records and distinguish buyer claims from
verified facts. A stated budget or competitor quote is evidence to assess, not permission
to discount.

For **Act with approval**, follow Operator setup. Commit your instruction edits, deploy
the four supporting services, and open the hosted web URL. Deploy **Sales** once from
`tools/lead`, containing `SearchAccounts`, `GetAccount`, `CreateDiscountedOffer`, and
`GetOffer`. Set `ARCADE_DISCOUNT_TOOL_NAME` and `ARCADE_GET_OFFER_TOOL_NAME` to the observed
write and read-back tool names, and `ARCADE_SALES_TOOLKIT=Sales`. These are two selected
tools from one toolkit. Native Elastic remains a Remote MCP connection.

Web and hooks own approval requests, delegated Slack delivery and authenticated decisions.
The resumed business action and the agent's offer read-back both pass through Arcade.
One attendee plays Dana and Riley with distinct seeded OAuth identities. Dana uses your
real Arcade account email; Riley needs no additional inbox or second person.

**Governed Run can send the approval self-DM before you select Approve.** Consent alone,
setup, discovery, `hook-tools`, readiness and evidence collection do not post messages.
The safe verification probe calls no model and creates no approval request.

## Controls and ownership

- **Access:** Sam cannot discover or execute the discount-creation tool.
- **Narrow permission:** Dana's 15% ceiling applies to the action's `discount_percent`.
- **Exact approval:** the grant binds Dana, the tool and every saved argument.
- **Price integrity:** `list_price` asserts the account's stored $12,000 value; it cannot overwrite it.
- **Output filtering:** synthetic activation tokens and seeded instructions are removed before the model sees account or offer results. Legitimate prices remain visible.
- **Read-back:** completion requires a successful `GetOffer` after creation that matches the saved offer ID, account, percentage, prices and draft status.
- **Replay:** the same operation returns its saved result without a second offer write.

| Directory | Responsibility |
|---|---|
| `apps/web` | Workshop UI, OAuth sessions, Mastra agent, host approvals and snapshots |
| `apps/hooks` | Access/pre/post policy, approvals, exact grants, delivery claims and audit |
| `apps/lead-app` | Account records, draft offers and operation receipts |
| `apps/idp` | Demo OAuth identities and stable clients |
| `tools/lead` | The single Sales toolkit deployment |
| `elastic` | Renewal evidence and native MCP setup |
| `scripts` | Setup, discovery, hook inventory, verification, activation, reset and evidence |

[Design](DESIGN.md) and [runtime contracts](docs/RUNTIME-CONTRACT.md) describe the boundaries.
If read-back is missing or mismatched, the app reports that the offer was saved but
verification failed. Controlled-model tests remain separate from a live-model rehearsal.
[Verification record](docs/LOCAL-VERIFICATION.md) dates the executed checks and their
limits. Historical routing results do not establish that this discount path has passed.

~ 🕷️ Anansi, Thierry's Agent
