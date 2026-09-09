# Governed Lead Agent — Mastra × Elastic × Arcade

A live workshop and forkable template showing how Arcade connects a Mastra agent to
Elastic evidence and governed GTM actions. One Northwind request carries the demonstration:
research, qualification, a blocked route, Slack escalation, authenticated human approval,
and continuation of the original action with an outreach brief ready for review.

The teaching goal is a smooth integration experience across a complete business workflow.
Each attendee keeps their own Mastra project and agent while its tools grow
through one Arcade gateway. The full approval loop remains part of the core exercise.

## Thesis

Mastra orchestrates the request, Elastic provides the account evidence, and Arcade connects
the tools and enforces authorization and policy. A human decides when the action needs
approval. Treat the LLM as an untrusted decision-maker: its controls live outside it.

Arcade supplies four identity-aware boundaries around each tool call:

| Layer | Question | Mechanism |
|---|---|---|
| Access | May this person discover the tool? | `/access` deny list |
| Credential | Can this person authenticate to the system? | per-tool OAuth or MCP authentication |
| Pre-execution | May this person make this exact call with these inputs? | `/pre` policy decision |
| Post-execution | What may reach the model from the result? | `/post` output rewrite |

Credential checks happen before `/pre`. A credential failure therefore produces no
pre-execution event. Workshop beats that need a visible audit record use access or
pre-execution policy, not an authentication failure.

## Lead Agent sequence

```text
Inbound form
   │
   ▼
Lead.search_leads / Lead.get_lead
   │
   ├── Elastic platform.core.search
   │      product activity, CRM history, intent, prior conversations
   │
   ▼
Structured qualification
   ├── follow_up / support / not_sales_related → Lead.classify_lead
   └── qualified → Lead.route_lead
                         │
                         ├── allowed within authority
                         └── blocked → Approvals.request_approval
                                            │
                                            ▼
                                  Slack request sent as Dana
                                            │
                                            ▼
                                  Riley opens approval page,
                                  authenticates, and approves
                                            │
                                            ▼
                                  Original agent request resumes
                                            │
                                            └── identical retry → one route write
```

The final workshop step produces an outreach-ready brief. The attendee explicitly requests
the action and its human approval flow; Slack delivery uses the requester's authorization
through Arcade. Sending prospect outreach remains human-controlled.

The approval link identifies a request; it conveys no authority. Verify Riley's signed-in
identity on the approval page and govern the decision. Persist the original agent request,
pending action and arguments, and approval ID server-side. Resume after the decision, even
when the first HTTP request has ended, using the same agent and gateway. Denial or expiry
leaves the action unexecuted. Bind the grant to the exact action and enforce idempotency in
the lead API so duplicate decisions or retries cannot produce a second write. This
continuation path is a required implementation item, not behavior the current route offers.

## The four acts

| Act | Beat | Control |
|---|---|---|
| 1 | Sam, a demand-generation analyst, cannot see `route_lead` | access |
| 2 | Dana attempts to route a $95K opportunity but has $50K authority; Riley approves and the exact call is retried | pre |
| 3 | `get_lead` returns a personal phone number; it is removed before the model receives it | post |
| 4 | the form submission contains an instruction to the model; the instruction is stripped as untrusted data | post |

The hook writes the remediation instruction for act 2. The system prompt does not coach the
agent around a denial.

## Participant ownership

### Teaching sequence

The workshop runs **Mastra → Elastic → Arcade → capstone**. Each partner gets **55 minutes**
including signup and setup, with the same order for in-room and remote attendees.

1. Mastra owns account/project setup and the first agent response. This starter must run
   without Arcade or Elastic credentials and use sanitized Northwind sample input, with no business-tool
   access or claims of retrieved evidence. The supplied stage provides this starter. Save the question, answer, and missing evidence for comparison.
2. Elastic owns account/project setup, fixture loading, native retrieval, and preparation of
   its MCP endpoint and read-only credential. It hands those to the attendee for the next
   section; Elastic does not configure Arcade. Save source IDs answering the same question.
3. Arcade owns signup and the connection. First register Elastic MCP, curate an Elastic-only
   gateway, connect the same Mastra agent, and compare its cited evidence with Module 2.
   Use the clean fixture for this first read-only answer. Then use guided setup for the
   supporting services, persona OAuth, and Slack. Configure and verify fail-closed hooks
   before making Lead/Approvals available to the agent; expand the same gateway and complete
   the full approval and continuation loop. The setup guide and staged agent paths are
   implemented; live attendee signup and consent remain explicit steps.
4. The capstone proves one correlated journey through research, denial, Slack, human decision,
   resumed action, and the final business write, then exercises changes to evidence and policy.

Each attendee’s agent definition must support supplied-input, Elastic-only, and full-workflow
stages with explicit capability handling. Keep policy checks and application authorization
in Arcade. A broken connection must fail visibly rather than silently changing to a stage
without tools. Measure the connection changes, elapsed time, and attendee assistance needed
before claiming the workshop demonstrates ease of integration.

All business-tool access from the integrated agent follows the one-gateway architecture.
Exploring data directly in Kibana during the Elastic section does not give the Mastra agent
a direct Elasticsearch connection. See [the module guides](docs/modules/01-mastra.md).

### Deployments and credentials

Every attendee owns the normal integration path:

- their own Mastra account/project;
- their own Elastic deployment and data;
- their own Arcade project and gateway;
- their own Elastic MCP credential;
- their own deployed copy of the workshop toolkits.

Gateways and action systems remain per-attendee. If Elastic signup or provisioning fails,
the delivery plan permits a shared read-only Elastic endpoint over synthetic fixtures as a
degraded mode. A presenter demonstrates the fixture mutation for that path; it does not
count as evidence that the attendee can mutate their own Elastic data.

## Why Elastic's native MCP

Elastic Agent Builder already exposes the supported MCP endpoint:

```text
{KIBANA_URL}/api/agent_builder/mcp
```

The endpoint includes platform search tools and any Agent Builder tools the participant is
authorized to use. The workshop uses native `platform.core.search` for account context.
Search permissions are limited to `gtm-account-context`.

We do not deploy the custom Elasticsearch toolkit developed separately. It is unnecessary
for this scenario because the agent only needs Elastic retrieval; GTM writes happen in the
lead system. If a later exercise needs low-level document or index CRUD that Agent Builder
does not expose, that toolkit can be evaluated as an extension rather than made a default.

## One gateway

Each participant registers Elastic Agent Builder as a Remote MCP server in Arcade and
creates one gateway for the first read-only connection. After controls are active and
verified, they add the hosted Lead and Approvals toolkits to that gateway and refresh tool
discovery. The Mastra connection remains:

```text
https://api.arcade.dev/mcp/{ARCADE_GATEWAY_ID}
```

This is federation, not data sharing. The participant's gateway contains only their server
connections and credentials.

Arcade hooks apply to hosted toolkits and Remote MCP tools. That gives one policy and audit
boundary even though Elastic owns the search server and the workshop owns the action server.

## Components

```text
apps/web
  Next.js UI and Mastra agent route.

apps/hooks
  Arcade /access, /pre, and /post endpoints.
  Owns governance.db and exposes a scoped, safe audit feed for polling.

apps/lead-app
  Plain HTTP lead system backed by leads.db.
  Knows identity from the bearer token, but knows nothing about authority or policy.

apps/idp
  Better Auth OAuth 2.1 fixture for workshop personas.
  A production fork replaces it with the company's IdP.

tools/lead
  Python arcade-mcp toolkit. Stateless client of lead-app.
  It is a CRM stand-in, not an Elasticsearch integration.

tools/approvals
  Python arcade-mcp toolkit for deterministic human escalation, Slack delivery, and decision.

elastic/
  Fixture data and participant-owned Elastic setup.

packages/governance-core
  Domain-agnostic policy evaluation, visibility, and approver routing.
  Durable grant orchestration and output filtering live in apps/hooks.

packages/policy-schema
  Domain-agnostic schemas and generated Arcade hook contracts.
```

The separation between `apps/lead-app` and `apps/hooks` is load-bearing. A policy check in
the lead API would let the demo claim governance without proving that the control is outside
the system being acted on.

## Tool surface

**Lead** (`tools/lead`, deployed with `arcade deploy`)

- `search_leads(status?, min_estimated_acv?, max_estimated_acv?)`
- `get_lead(lead_id)`
- `route_lead(lead_id, estimated_acv, owner_email, rationale)`
- `classify_lead(lead_id, disposition, rationale)`

`classify_lead` accepts `follow_up`, `support`, or `not_sales_related`. Routing a lead marks
it qualified and records its owner and estimated ACV. Both are system-of-record writes, not
recommendations or drafts.

**Elastic Agent Builder** (native Remote MCP server)

- `platform.core.search` for natural-language retrieval over product and account context;
- other tools remain available only when the participant includes and authorizes them.

**Approvals** (`tools/approvals`, deployed with `arcade deploy`)

- `request_approval(action, resource_id, amount, justification)`
- `decide(request_id, decision, note?)`

## Identity

The workshop follows Mateo's solo persona-switcher design. One attendee can play Dana,
Sam, Riley, and Morgan using the seeded demo credentials. A second human and additional
email inboxes are not workshop prerequisites. Dana's request and Riley's decision still
use different authenticated identities; selecting or submitting a persona name alone
does not authorize an approval.

Slack delivery has an explicit demo mapping to the attendee's own real account. That
mapping changes where the notification is delivered, never the requester, assigned
approver, grant, or business actor. The message names the demo requester and approver;
Slack displays the real account that authorized the send. Rehearse receiving the request,
failing to approve as Dana, authenticating as Riley, and resuming Dana's original run.
This simulates different business roles controlled by one attendee. Production forks
replace the demo switcher and credentials with their actual user authentication.

For the live solo path, seed Dana with the attendee's Arcade account email. Stock Slack
uses Arcade's project-member verifier. The custom demo OAuth provider uses an authenticated
application verifier for the remaining seeded identities; it confirms the signed-in
identity with Arcade rather than trusting a query parameter. This keeps one attendee
account compatible with separate demo roles. See
[Arcade's verifier contract](https://docs.arcade.dev/en/build/user-facing-agents/secure-auth-production).

The call chain preserves one identity:

```text
persona selected in web
  → Mastra MCPClient as Arcade user
    → Arcade access/auth/pre checks
      → Lead tool receives that user's OAuth token
        → lead-app resolves token through idp /oauth2/userinfo
          → route/classification history records the same email
    → Arcade post check
```

The actor is never a tool input. A caller-provided actor would be forgeable.

## Cast

| Persona | GTM role | Routing authority | Workshop purpose |
|---|---|---:|---|
| Dana Okafor | Inbound SDR | $50,000 | protagonist |
| Sam Reyes | Demand Generation Analyst | $0 | cannot discover `route_lead` |
| Riley Chen | Sales Manager | $250,000 | minimum-sufficient approver for $95K |
| Morgan Ellis | VP Revenue | $5,000,000 | deliberately not bothered |

The numeric clearance is deliberately domain-agnostic in `packages/`: here it means the
maximum estimated ACV a person may route without additional approval.

## Headline fixture

`LD-2291` is an inbound request from Northwind Robotics with a $95K estimated ACV.

The lead API holds:

- the contact and form submission;
- a personal phone number for the privacy act;
- a form message containing an injected instruction for the integrity act.

Elastic holds:

- trial workspace activity;
- high-intent documentation visits;
- enterprise security questions;
- a prior ACV estimate and segment.

The agent must cite that evidence in its qualification instead of inventing a score.

The initial Elastic fixture is clean synthetic data. After the post filters are active and
verified, an exercise variant adds a synthetic phone and injected instruction to one
existing event while retaining eight stable IDs. The early Elastic-only gateway never
includes the sensitive Lead tools. Reset selects the clean fixture for a fresh workshop
and the governed variant for control checks, removing extra capstone events in both cases.
The shared read-only fallback stays clean; its users watch Elastic mutations on the
presenter's separate deployment and record the resulting coverage limits.

## Authentication

For workshop speed, Elastic MCP uses a one-day API key created during the Elastic section, restricted to
`gtm-account-context`, plus the Agent Builder read privileges documented by Elastic.
Serverless participants may use OAuth 2.1 instead.

The direct `ELASTICSEARCH_URL` and setup key are for fixture loading and the later re-seed/reset
exercises. Keep that separately scoped write credential available through capstone, then
revoke it. It is not available to the Mastra agent or stored as the gateway's MCP credential.
Runtime access is through Elastic's MCP URL in Arcade, using the separate read-only key.

The Lead toolkit uses the demo OAuth provider so the business API can record the same person
Arcade governed. Production forks should use their actual CRM authorization.

## Governance event contract

```text
{
  id,
  ts,
  execution_id,
  hook: "access" | "pre" | "post",
  user_id,
  tool,
  decision: "allow" | "deny" | "modify",
  reason,
  rule_id,
  before?,
  after?
}
```

## Known constraints

1. Toolkit and tool names used in policy must be observed from the participant's gateway;
   a rule keyed on a misspelled normalized name matches nothing.
2. Authentication failures occur before contextual hooks and do not appear in the hook audit.
3. Elastic Stack must be 9.3 or later; Serverless Agent Builder MCP is generally available.
4. The checked-in lead system is a workshop fixture, not a CRM replacement.
5. The per-attendee agent teaching stages, guided launcher, full hook service, approval tools,
   persisted agent continuation, and final UI still need implementation. The live Elastic
   integration and setup timings are unverified; see the delivery plan's readiness gates.
