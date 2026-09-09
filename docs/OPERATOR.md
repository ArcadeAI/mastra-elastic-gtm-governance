# Workshop operator guide

Run commands from the repository root. Bun loads the root `.env`; hosted services read
these values from their configured environment. Use the dedicated workshop index and the
attendee's own services. Local automated tests supply loopback collaborators; these
operator commands act on the endpoints you configure.

## Setup and discovery

```sh
bun run setup --stage supplied
bun run setup --stage elastic
bun run setup --stage governed
bun run doctor --stage supplied
bun run doctor --stage elastic
bun run doctor --stage governed
```

Setup prints ordered configuration and consent instructions. Readiness checks required
settings and, for connected stages, actual gateway tool discovery. It never executes an
agent. `--live` retains unexercised boundaries as incomplete.

```sh
bun run discover
bun run discover --elastic-tools '<observed-name>,<observed-name>' --output .workshop/discovery.json
```

The first call prints the inventory and requests a selection. Copy exact names from the
inventory into `ARCADE_ELASTIC_TOOL_NAMES` and the four action-tool settings. The hook
namespace is separate: configure `ARCADE_ELASTIC_HOOK_TOOLS` from observed hook payloads
with each toolkit, tool, and argument name. No normalization or guessed names is applied.

## Deploy services with Render

The root `render.yaml` defines four Docker services, each with a persistent `/data` disk
and one instance. Automatic deploys are off. The blueprint supplies service-secret
references and public hostnames; manually supplied cloud credentials remain required.
It has not been deployed or container-tested in this local session.

Restrict access to the deployed workshop URL before distributing it. The supplied and
Elastic stages run before IdP setup, so their agent endpoints accept unauthenticated
requests and use the configured model credentials. Include access controls and attendee
model-credit arrangements in the deployment rehearsal.

1. Create the services from the blueprint and enter the required values. Set Dana's email
   to the attendee's Arcade project-member email before IdP seeding. Keep the other demo
   identities separate. Set the workshop Slack team if restricting delivery to that team.
2. Configure the web callback URI in IdP. Retrieve its separate stable web OAuth client
   credentials using the [IdP guide](../apps/idp/README.md) and store them in web settings.
3. Register the IdP's Arcade OAuth client and authenticated custom verifier. Deploy
   [Lead](../tools/lead/README.md) and [Approvals](../tools/approvals/README.md) separately
   through Arcade and set their service secrets. Copy `APPROVALS_SERVICE_TOKEN` generated
   on hooks into the Approvals toolkit's matching secret.
4. Register Elastic's Remote MCP server with its read-only key, then add the action
   toolkits to the same gateway under the staged policy. Set observed names in web/hooks.
5. Configure Arcade's access, pre, and post hooks to the public hooks URL using
   the `ARCADE_HOOK_SECRET` generated on hooks. These external Arcade settings are not
   created by the blueprint. Select fail-closed behavior and enable the extension. Use the
   separate verification identity for a known denied write and a filtered read through
   the gateway before activating attendee tools.

The hooks activation flags record a denial and changed filtered output from the configured
verification subject. They are a staging guard; they do not prove all cloud hook settings.
Inspect real gateway results and fail-closed settings during rehearsal.

## Inspect, edit, and activate policy

The browser's policy view is read-only. Operators edit the complete policy document through
hooks using `WORKSHOP_OPERATOR_TOKEN`. Use `HOOKS_PUBLIC_HOST` as a host without a scheme for the shared service setting.
For these curl examples, set `WORKSHOP_HOOKS_URL` to the complete URL, such as
`http://localhost:8081` locally or `https://your-hooks-host` on Render. The examples assume
the URL and operator token are already exported in your terminal:

```sh
curl --fail --silent --show-error "$WORKSHOP_HOOKS_URL/operator/policy" \
  -H "Authorization: Bearer $WORKSHOP_OPERATOR_TOKEN" > /tmp/workshop-policy.json
```

Edit the intended subject's `clearance` in `/tmp/workshop-policy.json`, retaining
its current `version` and the other policy fields. Submit the complete document:

```sh
curl --fail --silent --show-error -X PUT "$WORKSHOP_HOOKS_URL/operator/policy" \
  -H "Authorization: Bearer $WORKSHOP_OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @/tmp/workshop-policy.json
```

Validation and compilation complete before an atomic swap. A stale version returns 409;
reload before editing. An invalid policy leaves the current version in force. After the
verification probes described above:

```sh
curl --fail --silent --show-error -X POST "$WORKSHOP_HOOKS_URL/operator/activate" \
  -H "Authorization: Bearer $WORKSHOP_OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' --data '{}'
```

## Fixture and baseline

```sh
bun run workshop seed --variant clean
bun run workshop seed --variant governed
```

The governed variant requires activation and both verification flags. Both commands read
back all eight documents and check exact IDs and content. Seed replaces fixture IDs; it
rejects a baseline containing extra documents instead of calling it verified.

```sh
bun run reset --variant clean
```

Reset clears exercise state in hooks, native Mastra storage, Lead, IdP, and the dedicated
Elastic index. It removes extra Elastic events, restores nine lead records and six
historical decisions, clears operation receipts, and preserves both OAuth clients. Sign
in again afterward. It refuses executing workers, stops on an owner failure, and reports
which earlier owners already reset. A partial reset is not a clean baseline. To repeat
the governed exercise, verify/activate hooks again and seed the governed variant.

## Evidence and recovery

```sh
bun run capstone --run-id '<existing-run-id>' --output .workshop/evidence
```

The collector reads the existing run, safe audit, and operation receipt. It starts no
agent, requests no approval, and sends no Slack message. `--live` asks for live evidence;
missing or unexercised boundaries keep the result incomplete. A shared read-only Elastic
fallback is degraded. Keep manual access, policy, lowball, and changed-action probes with
the run evidence; one completed run does not prove every negative case.

A waiting snapshot can resume after a normal web restart. For an expired active resume
lease, stop the old worker first. Then POST to `/operator/runs/<run-id>/recover` with the
operator bearer and `{ "worker_stopped": true, "lease_id": "<current-expired-lease>" }`.
This explicit recovery invalidates the old lease. It does not authorize overlapping
workers. If the snapshot is missing, inspect the receipt and report the gap; never create
a new prompt as a substitute for the original run.

If Slack delivery succeeds but the snapshot acknowledgement fails, the run can remain
`awaiting_snapshot`. It cannot resume from that state. After the assigned approver denies
the request or the request expires, close the exercise before resetting. A successful
Slack delivery alone does not prove that the agent saved a resumable wait.
