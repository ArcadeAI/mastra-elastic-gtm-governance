# Module 3 — Arcade: connect, approve, and act

**Owner:** Arcade presenter. **Budget:** 55 minutes, including signup and setup.

**Guide status:** the staged runtime, hooks, approvals, UI, and persistent continuation
are implemented. Setup provides ordered instructions and checks; account provisioning and
consent remain attendee steps. Live interoperability and timing still need rehearsal.

Your Mastra agent already runs, and your Elastic project already has evidence. In this
section, connect them through Arcade, then give that same agent governed actions. Follow
one Northwind request from cited research through a Slack approval to a completed route.

## What you bring from the previous sections

- Your Mastra project and starter agent.
- Your populated Elastic project, Kibana MCP URL, and separate read-only MCP credential.

## Connect your existing agent and data — 15 minutes

1. Sign up for Arcade and create your project.
2. Store your read-only Elastic MCP key as an Arcade secret. Register the Remote MCP server
   with the Kibana MCP URL and custom `Authorization` header referencing that secret.
   The write/setup key stays out of this connection.
3. Observe the server's actual tool names and create a gateway containing the selected
   Elastic search and ES|QL tools. Connect the same Mastra project and same agent definition
   to that gateway using `ARCADE_GATEWAY_ID` and `ARCADE_API_KEY`.
4. Ask the saved question: “What evidence supports qualifying Northwind, and what is
   missing?” Ask for source IDs and compare at least two citations with the events saved
   in Module 2. Inspect the tool trace: Mastra called the gateway, which retrieved the
   evidence from your Elastic project.

This first checkpoint uses the clean eight-event synthetic Elastic fixture committed in
the repository. It asks for evidence, not an authoritative lead qualification before the
Lead tools are available. Do not introduce the adversarial Elastic variant yet.

All Elastic-to-Arcade configuration happens here with the Arcade presenter.

## Prepare governed actions — 15 minutes

1. Follow the supplied guided setup to provision the workshop services and toolkits in
   your accounts. Load the supplied demo identities, join the workshop Slack workspace,
   and authorize your own Slack account for the exercise. You play both Dana and Riley;
   their distinct demo credentials are supplied, with no extra inbox or partner required.
   Complete the Lead authorization for each demo identity when prompted.
   Run `bun run setup --stage governed` for the ordered configuration guide. Provision
   the four services from `render.yaml`, register the IdP, and deploy the two Python
   toolkits using their linked guides. Run `bun run doctor --stage governed` to inspect
   configured prerequisites and actual tool discovery; missing consent remains visible.
2. Configure the governance hooks and rules on the gateway, activate the extension, and
   select fail-closed behavior for every hook. The staged service hides Lead/Approvals from
   workshop roles. Use the setup verification identity to observe a known denial and
   filtered output through the real gateway. Cover Lead reads, successful route/classification results, and Elastic
   results. A healthy `/health` endpoint alone does not prove governance.
3. Lead records already contain the synthetic personal phone and injected form instruction.
   Once the post filters are verified, load the prepared adversarial Elastic variant into
   one existing event, keeping the same eight IDs.
4. Once verification passes, enable the workshop persona rules for Lead and Approvals on
   the **same gateway** and rediscover its tools in the **same Mastra agent**. The agent
   gains actions through the existing connection. Per-application credentials and policy
   remain with Arcade and the governed services.

Attendees complete signup, account authorization, and their deployment during this section.
The supplied setup guides the wiring so the teaching focuses on what each
connection enables.

## Complete the human approval loop — 20 minutes

1. As Dana, ask the agent to research Northwind and route the $95K lead to the proposed
   owner, obtaining approval if required. The agent combines Lead's authoritative record
   with cited Elastic evidence and proposes the action.
2. Arcade blocks the route because Dana's authority is $50K. Inspect the decision and the
   original action arguments; no business write has occurred.
3. The agent calls `request_approval` for Riley. Arcade supplies the Slack authorization
   you connected for Dana; the demo delivery mapping sends the notification to your own
   Slack account. It contains the proposed action with filtered display arguments, the
   named requester and approver, and an approval-page link.
4. Open the link as Dana and observe that you cannot approve. Switch to Riley and
   authenticate with the supplied demo credentials, then review the exact action.
   Receiving the Slack message grants no permission. The authenticated demo identity and
   the server's policy determine who can decide, even when one attendee plays both roles.
5. Select **Approve exact action** while signed in as Riley. The UI commits the decision
   through Arcade and resumes Dana's existing run. If needed, select **Resume Dana’s agent**
   to continue the same request. Show one route write and the final cited brief.

The native Mastra snapshot preserves the conversation through the human wait. Hooks
binds its run, denial, approval, and exact action; Lead stores the write receipt. The
pending run survives a web-service restart. Duplicate resume requests return the completed
result or a visible in-progress state. A lost active worker needs the operator recovery
procedure in the [runtime contract](../RUNTIME-CONTRACT.md).

## Inspect the controls — 5 minutes

Switch to Sam and confirm the routing tool disappears from discovery and a direct call is
denied. Inspect the model-facing outputs for both Elastic and Lead, including the successful
write response: neither the personal phone nor the injected instruction may reach the model.
Attempt the lowball ACV and changed-owner cases. Lead's server-side record remains the
authority, and the approval cannot authorize different arguments.

The four segments total **55 minutes**, including signup and setup. They are rehearsal
targets, not measured completion times.

## Checkpoint and handoff

Show one trace spanning Mastra's research, Elastic evidence, Arcade's denial, the Slack DM,
Riley's authenticated decision, the resumed action, and its single business write. The same
Mastra agent and gateway connect the entire workflow.

Continue to [the capstone](04-capstone.md).

## Builder notes

- **First checkpoint:** set `ARCADE_ELASTIC_TOOL_NAMES` from `bun run discover`, select
  **Connect evidence**, and inspect the cited response. This stage permits only those
  Elastic tools and requires no Lead, IdP, or hooks service.
- **Guided deployment:** provision public web, hooks, lead-app, and IdP services using the
  [Render blueprint](../../render.yaml). Set persona emails before the IdP's first seed;
  use actual public service URLs. Register the deployed IdP's OAuth client using the
  [IdP guide](../../apps/idp/README.md). Deploy the [Lead toolkit](../../tools/lead/README.md)
  and completed [Approvals toolkit](../../tools/approvals/README.md) separately, then obtain
  authorizations. Automating these steps does not remove the deployment requirements.
- **Identity and Slack:** preserve distinct seeded demo identities for Dana, Sam, Riley,
  and Morgan. Configure the attendee's real Slack delivery destination separately from
  those identities. Set Dana's identity email to the attendee's Arcade account email before
  seeding: the stock Slack provider requires Arcade project-member verification. Configure
  the authenticated custom user verifier for the demo OAuth provider so Riley and the other
  supplied roles do not require additional Arcade accounts. The requester authorizes Slack with `chat:write`, `im:write`,
  `users:read`, and `users:read.email`. Only the assigned, authenticated demo identity can
  decide; a delivery destination cannot change that assignment. The
  [Slack spike](../spikes/03-slack-scopes.md) proves a delegated self-DM. Rehearse the full
  solo path: Dana requests, the attendee receives, Riley authenticates and approves, and
  Dana's original run resumes. Persona switching is demo scaffolding, not proof that two
  different physical people participated.
  See [Arcade's verifier rules](https://docs.arcade.dev/en/build/user-facing-agents/secure-auth-production).
- **Activation order:** keep sensitive tools out of the agent's gateway catalog until
  access, execution, and output hooks are active and verified. Stage the tools on the same
  gateway under a deny-by-default access rule for workshop personas; a separate setup
  verification identity probes them without passing results to the model. Document and
  test that identity and the transition to the normal persona rules. Unsupported sensitive
  output shapes must fail closed without returning raw output. Introduce the adversarial
  Elastic variant only after this gate, and retain the separate setup key for the capstone.
- **Approval and resume:** use the real OAuth role buttons and exact-action controls in
  the UI. The panel displays pending state, filtered action details, and safe audit events.
  Save the run ID for `bun run capstone --run-id '<run-id>'` after completion.
- **Operator commands:** `bun run setup --stage governed`, `bun run discover`, and
  `bun run doctor --stage governed` guide wiring and check observed names. Use
  `bun run workshop seed --variant governed` only after the governance activation checks.
  The [operator guide](../OPERATOR.md) covers policy edits, reset, and evidence collection.

Reference: [Arcade Remote MCP servers](https://docs.arcade.dev/en/operate/governance/remote-mcp-servers).
