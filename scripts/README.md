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
| Governed readiness | Elastic values, all four write/approval tool names, `ARCADE_ELASTIC_HOOK_TOOLS`, service addresses and separate tokens, persistent `MASTRA_DB_URL`, web OAuth/session settings, four persona emails, verification identity |
| Clean seed | `ELASTICSEARCH_URL`, `ELASTIC_API_KEY`, optional `ELASTIC_GTM_INDEX` (default `gtm-account-context`) |
| Governed seed | Clean seed values plus `HOOKS_PUBLIC_HOST`, `WORKSHOP_OPERATOR_TOKEN`; policy must already be active with verified denial and filter flags |
| Reset | Elastic setup values, hooks/web/IdP/lead addresses, `WORKSHOP_OPERATOR_TOKEN`, `LEAD_INTERNAL_TOKEN` |
| Capstone | Hooks/lead addresses, operator/lead tokens, Dana/Riley emails, exact Elastic MCP and hook identities, exact route MCP name; live also requires gateway configuration |

Service addresses are `HOOKS_PUBLIC_HOST`, `LEAD_APP_PUBLIC_HOST`, `IDP_PUBLIC_HOST`, and
`WEB_PUBLIC_ORIGIN`. They accept complete HTTP(S) URLs or bare hosts. An optional
`ARCADE_MCP_URL` supports controlled local MCP tests. Live checks reject local/private/test
and non-HTTPS endpoints. Credentials are never written into generated configuration.

The four tool settings are `ARCADE_ROUTE_TOOL_NAME`, `ARCADE_CLASSIFY_TOOL_NAME`,
`ARCADE_REQUEST_APPROVAL_TOOL_NAME`, and `ARCADE_DECIDE_TOOL_NAME`.
`ARCADE_ELASTIC_HOOK_TOOLS` is a JSON array of explicit
`{"toolkit":"observed toolkit","name":"observed hook name","arguments":["observed argument"]}`
entries. Copy these from actual hook payloads: hook identities and MCP names are separate
namespaces. A selected MCP name is not proof of a corresponding hook identity.

Readiness returns `configured` when required values and available read-only checks succeed;
it explicitly marks model execution and consent unexercised. It never invokes the agent.
Governed checks contact each health endpoint, authenticate the operator policy read, and
read Northwind's authoritative value. `--live` cannot pass unexercised boundaries.

Reset calls hooks first, passes its `reset_epoch` to the web storage owner, then resets
lead, IdP, and Elastic. It stops at the first failed acknowledgement and reports prior
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
earlier route denial in the run cannot substitute for it.
It saves `run.json`, `gateway-audit.json`, `approval.json`, and `operation-receipt.json` with
the same correlation IDs. `manifest.json` lists their SHA256 hashes and all boundary checks.
The operation artifact contains the receipt fingerprint instead of its original free-text
body. Fixture phone/instruction markers are removed from retained artifacts.

Use `--output DIRECTORY` to select the artifact directory, or set
`WORKSHOP_EVIDENCE_DIR`; its default is `.workshop-evidence`, with one subdirectory per run.
Treat the manifest's artifact list as authoritative, especially after an incomplete rerun.
A non-live `passed` result proves consistency of recorded service evidence only. It never
sets `live_proof: true`. The current owner records do not independently attest cloud Arcade
execution or the remote Slack receipt, so **live capstone remains incomplete** until those
boundaries can be verified. Local controlled tests and workshop timing are explicitly
excluded. The collector does not run an agent, send a message, or create an approval.

Exit code 0 accompanies successful `guide`, `configured`, `observed`, `seeded`, `reset`, or
non-live `passed` results. Missing, failed, partial, unexercised live, and degraded results
exit 1. Always inspect the status and checks, not the exit code alone.

## Local proof

```sh
bun test scripts
bun x tsc --project scripts/tsconfig.json
```

The CLI suite spawns real Bun processes with automatic `.env` loading disabled and explicit
test-only environments. Controlled HTTP servers stand in for the external gateway,
Elasticsearch, and service endpoints; the actual installed MCP client performs discovery.
No external messages, agent executions, deployments, or cloud fixture writes occur.

Verified on 2026-09-08: 38 script tests / 181 assertions, scripts typecheck and diff checks
passed. The separate Lead URL regression added three passing HTTP cases (bare host,
complete URL, trailing slash); the combined focused run passed 41 tests / 187 assertions.

OPS1.R2 maps to the command tests in `workshop.test.ts`: stage-specific readiness,
observed discovery, guided setup, clean/governed seeding, all-owner reset and partial reset,
and separate missing-credential live readiness/capstone cases. The seed partition test
also asserts marker absence/presence, stable IDs, dates and retained legitimate context.
Capstone cases discriminate altered receipt bodies/IDs, changed trace arguments, absent
resume/citations/trace/denial, wrong approver, unfiltered output, uncertain Slack delivery,
and local/degraded proof. These command checks supplement the real owner and full-agent
integration suites; they do not replace those proofs.
