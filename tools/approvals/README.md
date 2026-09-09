# Approvals toolkit

Two registered Python `arcade-mcp` tools complete the workshop approval step:

| Tool | Inputs | Authorization |
| --- | --- | --- |
| `Approvals.RequestApproval` | `denial_id`, `justification` | Requester's stock Slack user token |
| `Approvals.Decide` | `request_id`, `decision` (`approve` or `deny`), optional `note` | Assigned approver's `cg-idp` token, scopes `openid`, `email` |

MCP stdio discovery uses `Approvals_RequestApproval` and `Approvals_Decide`.
Record the deployed gateway's observed names in the workshop configuration.
Actor identity comes from Arcade's trusted `Context.user_id`, never a model argument.

## Configuration

Both tools require exactly two Arcade secrets:

- `HOOKS_PUBLIC_HOST`: hooks hostname, without scheme or path. Loopback hosts use HTTP for local tests; other hosts use HTTPS.
- `APPROVALS_SERVICE_TOKEN`: dedicated service bearer matching hooks. Keep it separate from hook, web, operator and Lead credentials.

`RequestApproval` declares the stock Slack provider's four scopes:
`chat:write`, `im:write`, `users:read`, `users:read.email`. Arcade supplies the
requester's user token at execution time; this toolkit does not store Slack tokens.
See the [Slack scope evidence](../../docs/spikes/03-slack-scopes.md).

Hooks must explicitly enable `WORKSHOP_SOLO_SLACK=true`. If
`WORKSHOP_SLACK_TEAM_ID` is set on hooks, delivery must match that workspace.
Use the attendee's actual Arcade email for Dana and complete Slack consent in the
workshop workspace. Riley remains a separate seeded demo identity; one attendee
can switch personas and authenticate as Riley to decide.

The tool calls `auth.test`, opens the authenticated Slack user's self-DM, then
requests a delivery claim from hooks. The Block Kit message names the logical
requester and assigned approver. The inbox receiving that message provides no
approval authority. `Decide` forwards its IdP token in `X-Actor-Token`; hooks
independently verifies its identity and current authority.

## Delivery and exact actions

Hooks owns denial records, approval routing, claims, decisions and grants. A
request is bound to the original server-recorded action; the toolkit cannot
choose replacement arguments or grant itself permission. Only the filtered
display copy of the action goes to Slack and the model. Resume uses the original
canonical arguments retained by hooks.

Repeated or concurrent requests reuse one approval and one atomic delivery
claim. `sent`, `sending` and `uncertain` states never post again. A known rejection
before sending, such as a missing scope, records `failed` and permits an explicit
later retry after the problem is fixed.

An ambiguous Slack response, connection loss, server error, or malformed receipt
records `uncertain`. Slack's `internal_error` and `fatal_error` may follow partial
success, so they are also uncertain. A successful Slack send followed by a lost
hooks acknowledgement retries only that acknowledgement, up to three attempts.
If acknowledgement remains unresolved, the claim stays blocked from reposting.
This prevents automatic duplicate sends; it does not claim exactly-once delivery
across Slack and SQLite. See the [runtime contract](../../docs/RUNTIME-CONTRACT.md).

## Local verification

From the repository root, install Bun workspace dependencies first. Then:

```sh
cd tools/approvals
uv sync --extra dev
uv run pytest -q
uv run ruff check approvals tests server.py
uv run ruff format --check approvals tests server.py
```

The tests invoke the registered tools over actual MCP stdio and actual HTTP.
`test_hooks_integration.py` starts the real hooks application with SQLite and
checks concurrency, filtered display versus canonical resume, and service and
actor authentication. Arcade authorization, Slack, Lead values and IdP userinfo
are local HTTP stand-ins. The test server refuses any non-loopback Slack URL.
These checks neither contact live Slack nor establish a live workshop proof.

`server.py` is the toolkit entry point. Deployment and live Slack authorization
are separate workshop setup actions; running the tests does neither.
