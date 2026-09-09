# Workshop operator setup

Run commands from the repository root. Bun loads the root `.env`; hosted services read
these values from their configured environment. Use the dedicated workshop index and the
attendee's own services. Local automated tests supply loopback collaborators; these
operator commands act on the endpoints you configure.

## Stage commands and discovery

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
inventory into `ARCADE_ELASTIC_TOOL_NAMES`, `ARCADE_DISCOUNT_TOOL_NAME`, and
`ARCADE_GET_OFFER_TOOL_NAME` as those tools become available. The hook
namespace is separate: configure `ARCADE_ELASTIC_HOOK_TOOLS` from observed hook payloads
with each toolkit, tool, and argument name. No normalization or guessed names is applied.

## Deploy your supporting services

Complete this during the Arcade section after the clean Elastic connection works. Deploy
only **Sales** as a custom Arcade toolkit. The approval workflow runs in web and hooks.
The existing `tools/lead` and `apps/lead-app` paths and Render service names stay in place;
the deployed business toolkit is named Sales. The four supporting services below use Render compute and persistent disks, which have
separate billing. Review your Render workspace's displayed costs before creating them.

Fork this repository into your GitHub account. If you cloned the upstream earlier, point
your local checkout to the fork before pushing workshop changes:

```sh
git remote set-url origin 'https://github.com/YOUR_GITHUB_HANDLE/mastra-elastic-gtm-governance.git'
```

Substitute your GitHub handle for `YOUR_GITHUB_HANDLE`. If you edited the agent instructions
in Module 1, commit that change before deploying so the hosted app runs your same agent:

```sh
git add apps/web/lib/lead-agent.ts
git commit -m 'Customize workshop agent instructions'
```

Skip that commit when you made no changes, then push your branch:

```sh
git push -u origin HEAD
```

Use that fork and branch for all four services. [render.yaml](../render.yaml) is the
configuration reference. Follow the manual first-boot sequence below to obtain actual
hostnames and the persistent web OAuth client before completing the integration.
Render's [Blueprint flow](https://render.com/docs/infrastructure-as-code) is another way
to apply the configuration once those first-boot values have been resolved.

### 1. Prepare the service configuration

Copy `.env.example` to `.env` once. Set `PERSONA_DANA_EMAIL` to your actual Arcade account
email before starting IdP. Keep Riley, Sam, Morgan, and the verification identity at their
separate supplied addresses. Use `WORKSHOP_SOLO_SLACK=true`; set `WORKSHOP_SLACK_TEAM_ID`
if delivery should be restricted to the workshop workspace.

Generate a different random value for each of `ARCADE_HOOK_SECRET`, `LEAD_INTERNAL_TOKEN`,
`APPROVALS_SERVICE_TOKEN`, `WEB_SERVICE_TOKEN`, `WORKSHOP_OPERATOR_TOKEN`,
`BETTER_AUTH_SECRET`, and `WEB_SESSION_SECRET`, and keep them privately. Obtain provider
API keys from their providers and OAuth client credentials from IdP. Generate one local
service secret at a time with:

```sh
openssl rand -hex 32
```

The same named secret must match at each service that uses it. The manual steps use the
values you just generated. If Render generated values for an existing Blueprint deployment,
copy those existing named values into your private operator configuration instead of
creating a second set. Keep the operator token and internal service tokens out of agent tools. `BETTER_AUTH_SECRET` and the IdP disk must
survive redeploys so stored OAuth credentials remain usable.

### 2. Create services in a known order

In Render, select **New → Web Service**, connect your fork, choose Docker, and use these
settings. Build context is the repository root (`.`) for every service. Use the plan and
region declared in `render.yaml`, one instance, a 1 GB disk mounted at `/data`, `/health`
as the health-check path, and automatic deployments off.

| Create order | Dockerfile | Disk | Runtime storage setting |
|---|---|---|---|
| 1. `cg-web` | `apps/web/Dockerfile` | `agent-snapshots` | `MASTRA_DB_URL=file:/data/mastra-renewal.db` |
| 2. `cg-idp` | `apps/idp/Dockerfile` | `identity` | `IDP_DB_PATH=/data/idp.db` |
| 3. `cg-lead-app` | `apps/lead-app/Dockerfile` | `leads` | `LEADS_DB_PATH=/data/renewal.db` |
| 4. `cg-hooks` | `apps/hooks/Dockerfile` | `governance` | `GOVERNANCE_DB_PATH=/data/governance-renewal.db` |

Set `PORT=8080` on each service. Copy its other settings from `render.yaml` into the
service's Environment page. For manual creation, resolve every `fromService` entry into
the actual value from its named owner; the YAML entry itself is not an environment value.
Use the full Render URL for origin/callback settings and its hostname for host settings.

Start web with its storage, session/operator secrets, and model configuration. Leave
unavailable service references and OAuth values unset for this first boot; fill them after
the owners exist. Its health route can boot before OAuth and gateway wiring is complete. Copy the actual public URL
from Render into `WEB_PUBLIC_ORIGIN`; do not assume the name determines the hostname.
When creating IdP, set `WORKSHOP_WEB_REDIRECT_URI` to that URL plus `/auth/callback`, and
set the persona emails and `BETTER_AUTH_SECRET`. IdP obtains its own issuer from Render.

Use IdP's actual hostname for the account service's `IDP_PUBLIC_HOST`. Configure hooks after the other
three URLs are known, including the matching `LEAD_INTERNAL_TOKEN`, web service token,
`APPROVALS_SERVICE_TOKEN` shared by hooks and web, operator token, and hook secret. Keep
policy staged while tools are registered.
Render's [environment-variable reference](https://render.com/docs/environment-variables)
describes its generated URL and hostname values.

The supplied and Elastic stages accept requests before role sign-in and use the configured
model key. Include access and model-credit arrangements in your deployment rehearsal
before distributing the URL.

### 3. Wire the two OAuth clients

Open a shell on the running **IdP service with its persistent disk**. Its working directory
is `/app`. Retrieve each client separately:

```sh
bun run oauth-client --json
bun run oauth-client --web --json
```

The first is Arcade's client; the second is the workshop web client. Keep the output
private. Set `WEB_OAUTH_CLIENT_ID` and `WEB_OAUTH_CLIENT_SECRET` on web from the second
result, along with the actual `IDP_PUBLIC_HOST`, `HOOKS_PUBLIC_HOST`, `WEB_PUBLIC_ORIGIN`,
persona emails, and matching service tokens. Save settings and redeploy web.

Register Arcade's custom OAuth provider with the exact provider ID **`cg-idp`**, which the
Sales toolkit requires. Use the [IdP registration table](../apps/idp/README.md#registering-it-in-arcade-13)
for its endpoints, client credentials, `client_secret_post`, and required PKCE S256.
Configure its authenticated custom verifier as
`WEB_PUBLIC_ORIGIN/auth/arcade/verify`. The actual URL must use your web origin; do not
paste the environment-variable name into Arcade. Stock Slack retains Arcade's normal
project-member verification.

For the governed exercise, stop the local `dev:web` process and open the deployed web URL
recorded in `WEB_PUBLIC_ORIGIN`. Keep login, callback, Arcade verification and the approval
page on this same origin. Starting sign-in on localhost with a hosted callback loses the
browser's OAuth transaction cookie; mutations also check the exact configured Origin.
The hosted app uses the same agent instructions from the fork you pushed.

Update the root `.env` used by operator commands before the next step:

| Values | What to copy |
|---|---|
| `HOOKS_PUBLIC_HOST`, `LEAD_APP_PUBLIC_HOST`, `IDP_PUBLIC_HOST`, `WEB_PUBLIC_HOST` | Actual hosted hostnames, replacing the localhost defaults. |
| `WEB_PUBLIC_ORIGIN`, `IDP_PUBLIC_URL`, `WORKSHOP_WEB_REDIRECT_URI` | Actual HTTPS web/IdP origins and the web origin plus `/auth/callback`. |
| `WEB_OAUTH_CLIENT_ID`, `WEB_OAUTH_CLIENT_SECRET`, `WEB_SESSION_SECRET` | The web client's stored credentials and the matching web session secret. |
| `WORKSHOP_OPERATOR_TOKEN`, `LEAD_INTERNAL_TOKEN`, `WEB_SERVICE_TOKEN`, `APPROVALS_SERVICE_TOKEN` | The matching values configured on their hosted owners. |
| Gateway/tool names, persona emails, hook mapping and `MASTRA_DB_URL` | Keep them consistent with the hosted services; governed doctor also checks these settings. |

The operator CLI reads this local file; configuring Render alone does not update it. Keep
the file private and use the hosted browser URL for the remaining governed steps.

**Checkpoint:** all four `/health` URLs return `status: "ok"`. On the hosted web URL, select
**Act with approval → Sign in as dana**. The IdP form should identify **Workshop Agent**.
Signing in alone sends no Slack message. Follow [Testing](TESTING.md) for the remaining
sign-in checks; health and login alone do not verify gateway governance.

### 4. Deploy Sales once

Install and authenticate the Arcade CLI, then deploy from the toolkit directory:

```sh
uv tool install arcade-mcp
arcade login
cd tools/lead
uv sync --frozen
arcade deploy
cd ../..
```

Select your workshop Arcade project in the CLI. Supply `LEAD_APP_PUBLIC_HOST` as your
actual account-service hostname when configuring the toolkit's secret. Its `cg-idp` OAuth provider
must already be registered. Inspect the resulting `Sales` toolkit and add it to the same
gateway as Elastic. Record its exact observed CreateDiscountedOffer MCP name in
`ARCADE_DISCOUNT_TOOL_NAME` on web and hooks, and its GetOffer MCP name in
`ARCADE_GET_OFFER_TOOL_NAME` on web. Copy both into the local operator `.env` for governed
readiness. Set `ARCADE_SALES_TOOLKIT=Sales`. These are two tool names from one deployment.
[CLI reference](https://docs.arcade.dev/en/references/arcade-cli).

The app uses Arcade's delegated Slack authorization for the self-DM. There is no custom
Approvals toolkit to deploy or add to discovery. Keep normal attendees' Sales tools staged
until the governance checks below have passed.

### 5. Verify governance before running the action

Configure Arcade's access, pre, and post hooks to your public hooks URL (`/access`, `/pre`,
`/post`) with `ARCADE_HOOK_SECRET`. Enable the extension and select fail-closed behavior for
all three hooks. Observe the separate hook namespace before configuring Elastic policy;
MCP display names alone do not establish that mapping:

```sh
bun run discover --identity verification
bun run workshop hook-tools
```

`hook-tools` reads authenticated `/operator/observed-tools` and returns `status: "inventory"`
with a `tools` array. It contains toolkit names, tool names and observed argument keys,
never argument values or credentials. The first access call records names with
`arguments: []`. Unmapped Elastic tools can be absent from gateway discovery at this point.

1. Select only the observed entries for the Elastic tools in your gateway. Copy those JSON
   entries, initially with `arguments: []`, into `ARCADE_ELASTIC_HOOK_TOOLS` in both your
   local `.env` and the hosted hooks environment. Leave Sales out of that array.
2. Save and redeploy hooks. The observed toolkit/tool pairs now identify the allowed Elastic
   tools. The empty argument list is valid for these retrieval rules, which have no
   argument-specific conditions.
3. Keep the fixture clean. On the hosted web URL, use **Connect evidence** to repeat the
   Northwind search. This invokes a selected read tool through Arcade and records its
   actual argument keys. It uses the model and Elastic; it cannot send Slack or create an offer.
4. Run `bun run workshop hook-tools` again. Copy the selected Elastic entries with their
   observed argument keys into the local and hosted setting, then redeploy hooks. Repeat
   the read for any other selected tool whose argument keys you need to record. Keep the
   exact MCP names from `discover` in their separate web settings.

If the hook inventory is empty after discovery, check the extension is enabled and uses
the matching hook secret and public URLs. Do not guess a toolkit name to get past this
checkpoint. Normal Sales access stays staged throughout this mapping step.

Open your web origin at `/auth/login?persona=verification` and sign in with
`WORKSHOP_VERIFICATION_USER_ID` and password `verification-demo-2026`. This setup identity
is separate from the normal role picker. Use it when authorizing Sales through `cg-idp`;
the authenticated Arcade verifier must see the same identity as the probe.

```sh
bun run discover --identity verification
# Copy the exact observed CreateDiscountedOffer name into ARCADE_DISCOUNT_TOOL_NAME first.
# Copy the observed GetOffer name into ARCADE_GET_OFFER_TOOL_NAME for the governed stage.
bun run workshop verify-governance --read-tool '<exact-observed-GetAccount-name>'
```

On first use, open any returned `authorizationUrls` and complete the verification
identity's Sales consent. Keep the browser signed in as verification for the custom
verifier, then rerun the check. Expect `status: "passed"` with `filtered_read` and
`authority_denial` checks. It calls the actual gateway without running a model: a filtered Northwind read,
then a 30% offer probe tied to a unique operation. Its deliberately empty rationale is
also rejected by the account API if the pre-hook is missing. It does not create an approval
request or call Slack. An incomplete check is a setup failure, not permission to activate.

```sh
bun run workshop activate
bun run discover --identity attendee --elastic-tools '<exact-name>,<exact-name>' --output .workshop/discovery.json
bun run doctor --stage governed
bun run workshop seed --variant governed
```

Expect activation `status: "activated"`, observed attendee tools, and governed readiness.
Copy the discovery configuration into your local and hosted web settings. Keep the Elastic
fixture clean until verification and activation succeed. The flags record the two probes;
they do not prove every cloud extension failure mode or Elastic result shape. Inspect those
separately during the live rehearsal in [Testing](TESTING.md).

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

Reset clears exercise state in hooks, native Mastra storage, the account service, IdP, and the dedicated
Elastic index. It removes extra Elastic events, restores the account fixture and clears draft offers, decisions and operation receipts, and preserves both OAuth clients. Sign
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

## Upgrade an earlier workshop deployment

For this renewal revision, set the account service's `LEADS_DB_PATH=/data/renewal.db`,
hooks' `GOVERNANCE_DB_PATH=/data/governance-renewal.db`, and web's
`MASTRA_DB_URL=file:/data/mastra-renewal.db`, then redeploy all three. Use the corresponding
relative paths locally. These new files start with the renewal fixture, current policy
and empty run state; retain the old databases as history. Earlier offers are not converted
into the new follow-up-email contract. IdP and both OAuth clients stay unchanged. Redeploy
the single Sales toolkit with its required `customer_message`, update observed tool names,
then repeat metadata discovery, verification and activation before a governed run.

After the approval exercise, follow the [capstone hook lab](modules/04-capstone.md#write-one-output-hook)
to test and apply one output rule without replacing the baseline policy.
