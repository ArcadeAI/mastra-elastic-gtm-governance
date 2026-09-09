# Workshop operator commands

Run from the repository root after installing its locked dependencies. Commands read
`.env` through Bun and print JSON. Account signup, consent, and service provisioning remain
guided steps; a configured value does not prove a successful external connection.

```sh
bun scripts/workshop.ts setup --stage supplied
bun scripts/workshop.ts setup --stage elastic
bun scripts/workshop.ts setup --stage governed
bun scripts/workshop.ts readiness --stage supplied
bun scripts/workshop.ts readiness --stage elastic
bun scripts/workshop.ts readiness --stage governed --live
bun scripts/workshop.ts discover --output .workshop/tools.json --elastic-tools EXACT_OBSERVED_NAME
bun scripts/workshop.ts discover --identity verification
bun scripts/workshop.ts hook-tools
bun scripts/workshop.ts verify-governance --read-tool EXACT_GET_ACCOUNT_NAME
bun scripts/workshop.ts activate
bun scripts/workshop.ts hook-lab init --output .workshop/renewal-rule.json
bun scripts/workshop.ts hook-lab test --file .workshop/renewal-rule.json
bun scripts/workshop.ts hook-lab apply --file .workshop/renewal-rule.json
bun scripts/workshop.ts hook-lab verify --read-tool EXACT_GET_ACCOUNT_NAME
bun scripts/workshop.ts seed --variant clean
bun scripts/workshop.ts seed --variant governed
bun scripts/workshop.ts capstone --run-id EXISTING_RUN_ID
bun scripts/workshop.ts capstone --run-id EXISTING_RUN_ID --live
bun scripts/workshop.ts reset --variant clean
```

`setup --stage elastic|governed --output PATH` also runs discovery and writes selected
configuration. `discover` uses the installed Mastra MCP client to request actual
`tools/list` results. Run it without a selection to inspect available names; then pass
`--elastic-tools` or set `ARCADE_ELASTIC_TOOL_NAMES`. Every selected name must exist in
the response. Discovery never calls a tool or guesses names from descriptions.

| Command | Required configuration |
| --- | --- |
| Supplied readiness | `MODEL_ID` and its provider key; default Anthropic model uses `ANTHROPIC_API_KEY` |
| Elastic readiness/discovery | `ARCADE_API_KEY`, `ARCADE_GATEWAY_ID`, `PERSONA_DANA_EMAIL`; readiness additionally needs exact `ARCADE_ELASTIC_TOOL_NAMES` |
| Governed readiness | Elastic values, exact offer write and read-back tool names, `ARCADE_ELASTIC_HOOK_TOOLS`, service addresses and separate tokens, persistent `MASTRA_DB_URL`, web OAuth/session settings, four persona emails, verification identity |
| Verification discovery/probe | Arcade key/gateway, `WORKSHOP_VERIFICATION_USER_ID`; probe additionally requires observed CreateDiscountedOffer and GetAccount names, hooks address and operator token |
| Activate | Hooks address and operator token; the latest complete `verify-governance` attempt must have passed |
| Hook lab init/test | Local rule path; real filter and renewal fixture, no service credentials |
| Hook lab apply | Local rule path, hooks address and operator token; current policy is preserved |
| Hook lab verify | Arcade key/gateway, Dana identity and Sales consent, exact observed GetAccount name |
| Clean seed | `ELASTICSEARCH_URL`, `ELASTIC_API_KEY`, optional `ELASTIC_GTM_INDEX` (default `gtm-account-context`) |
| Governed seed | Clean seed values plus `HOOKS_PUBLIC_HOST`, `WORKSHOP_OPERATOR_TOKEN`; policy must already be active with verified denial and filter flags |
| Reset | Elastic setup values, hooks/web/IdP/account-service addresses, `WORKSHOP_OPERATOR_TOKEN`, `LEAD_INTERNAL_TOKEN` |
| Capstone | Hooks/account-service addresses, operator/internal account tokens, Dana/Riley emails, exact Elastic MCP and hook identities, exact discount and GetOffer MCP names; live also requires gateway configuration |

Service addresses are `HOOKS_PUBLIC_HOST`, `LEAD_APP_PUBLIC_HOST`, `IDP_PUBLIC_HOST`, and
`WEB_PUBLIC_ORIGIN`. They accept complete HTTP(S) URLs or bare hosts. An optional
`ARCADE_MCP_URL` supports controlled local MCP tests. Live checks reject local/private/test
and non-HTTPS endpoints. Credentials are never written into generated configuration.

The offer write setting is `ARCADE_DISCOUNT_TOOL_NAME`; the required read-back setting is
`ARCADE_GET_OFFER_TOOL_NAME`. Set both to observed MCP names and use
`ARCADE_SALES_TOOLKIT=Sales`. These two tools belong to the same toolkit deployment.
Deploy only `tools/lead`; the web host uses `APPROVALS_SERVICE_TOKEN` to request human
review from hooks and records authenticated decisions through that service boundary.
`ARCADE_ELASTIC_HOOK_TOOLS` is a JSON array of explicit
`{"toolkit":"observed toolkit","name":"observed hook name","arguments":["observed argument"]}`
entries. Copy these from actual hook payloads: hook identities and MCP names are separate
namespaces. A selected MCP name is not proof of a corresponding hook identity.
`hook-tools` reads only observed toolkit names, tool names, and argument keys from hooks.
With hooks registered, run discovery once, then `hook-tools`. Unmapped Elastic tools may
be hidden, but the access callback records their actual names. Copy the selected Elastic
entry with `arguments: []` into `ARCADE_ELASTIC_HOOK_TOOLS` locally and on hooks, then
redeploy hooks. Perform a clean Elastic read and run `hook-tools` again to collect its
argument keys, update the entry, and redeploy. No argument values, OAuth credentials or
output content are included in this inventory. The inventory is cleared on exercise reset.

Readiness returns `configured` when required values and available read-only checks succeed;
it explicitly marks model execution and consent unexercised. It never invokes the agent.
Governed checks contact each health endpoint, authenticate the operator policy read, and
read Northwind's authoritative value. `--live` cannot pass unexercised boundaries.

Before activation, use `discover --identity verification` to inspect staged Sales tools.
`verify-governance --read-tool EXACT_GET_ACCOUNT_NAME` executes an account read and a 30% offer probe as
that setup identity. It requires a fresh filtered result and the matching authority
rejection returned through the gateway, then confirms those observations to hooks.
Hook callbacks alone cannot activate the workshop. Each new probe invalidates the prior
confirmation; a failed probe must be repaired and rerun. The offer probe uses an intentionally
empty rationale as a second guard against writes if the pre hook is missing.
The command creates no approval and sends no Slack message. Pending consent URLs appear
in `authorizationUrls`; open them as the setup identity and rerun the same command.

`hook-lab` is the attendee's later output-filter exercise. Init writes an incomplete
`renewal-contact-redaction` rule scoped to Sales.GetAccount. Add removal of
`support.internal_owner_email`, then test against the real local filter and renewal fixture.
Apply validates the candidate and preserves existing policy through the operator API.
Verify uses Dana's actual gateway GetAccount call and reports a separate gateway-read proof;
it preserves the unresolved support issue, renewal and price. No lab command runs a model,
saves an offer or sends Slack. See the [capstone](../docs/modules/04-capstone.md#write-one-output-hook)
for the exact rule edit and expected failing/passing checks.

Hook-lab init returns `status: "guide"`; successful test, apply and verify return
`status: "passed"`. Check `proof_scope`: `local_fixture`, `policy_update` or
`gateway_read`. Verify also reports `connection_scope: "local" | "remote"`.
These bounded reports keep `live_proof: false`; they do not certify the full renewal run.
Apply reports `changed: false` without a policy write when the same rule is already saved.

Reset calls hooks first, passes its `reset_epoch` to the web storage owner, then resets
the account service, IdP, and Elastic. It stops at the first failed acknowledgement and reports prior
completed owners. Retrying after repair is supported. Hooks refuses active writers. Web
uses native storage deletion; IdP preserves both clients while clearing tokens. Elastic
reset deletes all documents only in the explicitly configured dedicated index and then
reads back the eight clean records. A missing owner never counts as a complete reset.

`WORKSHOP_ELASTIC_MODE=shared-read-only` produces `degraded` results and prevents seed/reset
mutations. The default is `owned`; unknown mode values are rejected.

Capstone is a read-only collector for an **existing** run. It checks run/request/operation
bindings, native resumed-result metadata, exact argument and receipt fingerprints, source
citations in successful Elastic post-hook output (including JSON inside MCP text), filtered
markers, gateway denial/allow, Slack acknowledgement, and authenticated Riley decision.
The denial must match the approval owner's exact saved gateway execution ID; another
earlier discount denial in the run cannot substitute for it.
It saves `run.json`, `gateway-audit.json`, `approval.json`, and `operation-receipt.json` with
the same correlation IDs. `manifest.json` lists their SHA256 hashes and all boundary checks.
The operation artifact contains the receipt fingerprint instead of its original free-text
body. The bound body includes the exact customer_message. Fixture pasted-key/phone/instruction
markers are removed from retained artifacts.

Use `--output DIRECTORY` to select the artifact directory, or set
`WORKSHOP_EVIDENCE_DIR`; its default is `.workshop-evidence`, with one subdirectory per run.
Treat the manifest's artifact list as authoritative, especially after an incomplete rerun.
A non-live `passed` result proves consistency of recorded service evidence only. It never
sets `live_proof: true`. The current owner records do not independently attest cloud Arcade
execution or the remote Slack receipt, so **live capstone remains incomplete** until those
boundaries can be verified. Local controlled tests and workshop timing are explicitly
excluded. The collector does not run an agent, send a message, or create an approval.

Check the process exit code together with the report's status and checks. A local fixture
pass and a gateway-read pass establish different things; neither can be substituted for
the other. Missing, failed, partial, unexercised live and degraded results are not complete
workshop proof.

## Local proof

```sh
bun test scripts
bun x tsc --project scripts/tsconfig.json
```

The CLI suite spawns real Bun processes with automatic `.env` loading disabled and explicit
test-only environments. Controlled HTTP servers stand in for the external gateway,
Elasticsearch, and service endpoints; the actual installed MCP client performs discovery.
No external messages, agent executions, deployments, or cloud fixture writes occur.

Current results must be recorded for this renewal revision. Earlier operator and
discount-test counts are historical; use [Testing](../docs/TESTING.md) and
[historical verification](../docs/LOCAL-VERIFICATION.md) without relabeling those results.
