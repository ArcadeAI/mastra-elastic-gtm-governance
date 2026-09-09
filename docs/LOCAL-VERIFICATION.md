# Local verification

Checked 2026-09-08. This records local implementation and deployment evidence. No live
Slack message, complete cloud agent run, real CRM write, or prospect outreach was performed.

Final local results: **517 Bun tests passed with 1,853 assertions; 20 Python Lead tests
and 27 Python Approvals tests passed.** Typechecks, production build, generated contract
checks, Python lint/type checks, and dependency scans passed.

Both final independent Claude/Opus reviews approved with no blocking findings: the
connected runtime and the safe expired-approval error-message correction. Remaining
deployment and live-integration checks are listed below.

The [published revision's CI](https://github.com/ArcadeAI/mastra-elastic-gtm-governance/actions/runs/34299055152)
passed all six jobs, including all four Docker image builds and boot health checks. The
Bun test job installs both locked Python MCP environments before its connected tests.

Render accepted the Blueprint configuration. Four services were then created through its
services API, with separate 1 GB persistent disks, one Oregon instance each, and automatic
deployments disabled. These services are managed individually. All four public `/health`
endpoints returned HTTP 200, and their configured environment references were verified.
The persistent IdP web client is configured on the web service. Model credentials and
Arcade/Elastic registration remain separate setup steps.

Live API smoke exposed a packaging gap that `/health` did not exercise: a Bun-built
standalone tree omitted Mastra's `ws` dependency. An isolated Node 22 reproduction also
identified an untraced native LibSQL package. The Docker builder now runs Next under
Node 22, with explicit tracing for LibSQL's installed native files. The web image's CI
smoke requests `/api/session` and checks its JSON response without any service credentials.
That checks the complete route's dependency graph before deployment.

## What ran

| Surface | Proof | Result |
|---|---|---|
| Agent stages | `bun test apps/web/test/runtime.test.ts` | Actual Mastra agent; supplied mode without other services, observed MCP tools in Elastic mode, native persistent wait/restart. |
| Connected workflow | `bun test apps/web/test/connected.test.ts` | Real Python MCP tools, hooks, Lead SQLite, IdP OAuth, and Mastra file LibSQL. Replacement web process resumes Dana after Riley's authenticated decision. One write; replay adds no write or notification. Filtered Lead/Elastic content reaches the model. |
| Approval web | `bun test apps/web/test/web-auth.test.ts apps/web/test/expired-decision.test.ts` and connected test | Real login/callback, Dana-to-Riley change, pending-run preservation, forged callback/identity rejection, CSRF, decision through MCP, explicit expired-decision rejection with no grant/write. |
| Hook boundary | `bun test apps/hooks/test` | Access/pre/post schemas and separate bearer credentials, authoritative ACV, exact grants, replay, filtering, safe audit, policy rollback, reset and lease recovery. |
| Lead API | `bun test apps/lead-app/test` | Actual HTTP and SQLite, transactional receipt rollback, changed-action conflicts, and separate child-process restart. |
| Python Lead | `uv run --directory tools/lead --frozen --extra dev python -m pytest` | 20 tests against the actual Lead API. |
| Python Approvals | `uv run --directory tools/approvals --frozen --extra dev python -m pytest` | 27 tests: registered MCP tools, local OAuth/Slack HTTP, real-hooks integration, rejected delegated authorization, notification claims/failure states and safe expiry error reporting. |
| Operator CLI | `bun test scripts` | Actual installed MCP discovery, clean/governed fixture partition and read-back, owner reset sequencing, truthful incomplete/degraded evidence reports. |
| Workshop layout | Headless Chrome at 1440×1000 and 390×844 against built Next.js | Stage buttons work; governed execution requires sign-in; no page errors or horizontal overflow. No model/tool execution in this visual check. |
| Build/contracts | Root typecheck, Next production build, both `generate:check` commands | Passed. Python Ruff and Lead mypy checked separately. |

The connected test controls only external model, Arcade, Elastic, and Slack boundaries on
loopback. It runs the actual application services and registered Python tools. Its scripted
model sees filtered tool results and emits citations to fixture evidence. That establishes
the local contract, not the quality of a live model's research.

## Remaining verification

- Live Elastic native MCP registration, its actual scoped key, Arcade hook configuration,
  fail-closed behavior, and the same gateway's model-facing tool results.
- Authorized Slack self-DM in the workshop workspace, real account consent, approval link,
  and the full cloud resume under the original requester.
- Record the final deployed revision and live OAuth result with the rehearsal evidence.
- Fresh-machine and fresh-account rehearsal, model-credential distribution, organizer
  workspace invite, and the planned 55 minutes for each partner.

Capstone reads existing service records and checks their run/action/receipt bindings. It
keeps independently unverified cloud provenance incomplete even when service records exist.
An injected test model cannot become live-model evidence. A shared read-only Elastic path
is degraded and does not receive fixture-mutation credit.

## Tooling limits

The sandbox cannot bind local test-server ports. The complete service suites are run with
permission to start their loopback servers; sandbox listener failures are environmental.
The packaged Safeword verification helper logged successfully. Its prescribed command
resolver could not find a local test-plan-capable CLI; the packaged runtime can generate
a plan, but the project-specific commands above provide the executed evidence. There is
no Cucumber harness; the Gherkin scenarios map to Bun and pytest tests. The live scenario
remains open and is excluded from the automated local suite.

Primary API checks: [Mastra human-in-the-loop](https://mastra.ai/docs/agents/human-in-the-loop)
for snapshot storage and native suspension, and
[Render Blueprint reference](https://render.com/docs/blueprint-spec) for public hostname
references and persistent service configuration. Installed packages and real local runtime
tests supply version-specific behavior.

## Dependency check

The root advisory scan initially flagged Next's inherited PostCSS 8.4.31. A root override
pins PostCSS 8.5.23, the patched version identified by the
[maintainer advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp).
The production build passed with that lockfile, and `bun audit --json` returned `{}`.
The IdP's separate lockfile also returned `{}`. `uv audit` found no known vulnerabilities
or adverse project statuses in Lead's 121 packages and Approvals' 117 packages.
