# Connected workshop runtime contract

Status: implemented and covered by local service tests. Live cloud verification remains
separate; see [local verification](LOCAL-VERIFICATION.md). The scenario source is `features/connected-workshop.feature`.

## Identity and ownership

One attendee controls four distinct demo OAuth identities. Dana uses the attendee's
Arcade account email; Riley, Sam, and Morgan use supplied demo addresses. Only Dana needs
stock Slack authorization. Thierry provides the workshop Slack workspace and invite.
The toolkit derives the actual Slack user/team from `auth.test` and sends a self-DM.
The notification names Dana and Riley, but its recipient does not become the approver.

Web sign-in uses a separate, stable `workshop-web` client in the existing demo IdP.
Persona switching starts authorization with `prompt=login`, a random state and PKCE S256.
The callback verifies the transaction and compares `/oauth2/userinfo` with the expected
persona before establishing an encrypted HttpOnly session. A query/body persona is never
the authority for a decision. The custom Arcade verifier confirms the session identity;
stock Slack still uses Arcade's project-member verifier.

The supplied stage needs only a model. The Elastic stage additionally needs the gateway
and configured Dana identity. Neither depends on the IdP or hooks. The governed stage
requires an authenticated session and persistent services. Broken required connections
return errors instead of silently falling back to supplied input.

## Data owners

| Owner | Durable state | Reset |
|---|---|---|
| lead-app | Existing leads/decisions plus operation receipts | Restore fixture and clear receipts in one transaction |
| IdP | Existing people, tokens and two ownerless OAuth clients | Reset people/tokens; preserve both clients and secrets |
| hooks | Subjects, policy, safe audit, denied actions, requests/grants, delivery claims, run bindings | Clear exercise state and restore baseline policy |
| web | Native Mastra snapshots in LibSQL; encrypted browser session | Delete exercise snapshots through the storage API |

Web's Node runtime cannot import `bun:sqlite`. Use `@mastra/libsql` for native snapshots;
hooks remains the owner of business-independent continuation metadata. Persist both
services on disks. A redeploy is not a reset.

## Lead API

The existing OAuth bearer remains required on public Lead routes. Both write tools take
`operation_key` and forward it as `Idempotency-Key`. Keys contain 1–128 ASCII letters,
digits, dots, underscores, colons, or hyphens.

| Route | Body/result |
|---|---|
| `POST /leads/:id/route` | `{estimated_acv, owner_email, rationale}`; existing LeadRecord result |
| `POST /leads/:id/classify` | `{disposition, rationale}`; existing LeadRecord result |
| `GET /internal/leads/:id/value` | `{lead_id, estimated_acv}` |
| `GET /internal/operations/:key` | `{operation_key, actor, action, lead_id, body, completed_at}`; 404 if absent |
| `POST /internal/reset` | Restore the fixture; return restored counts |

Internal routes require `Authorization: Bearer LEAD_INTERNAL_TOKEN`, supplied only to
the lead service, hooks, and operator tooling. They do not implement policy or roles.

An immediate SQLite transaction checks the globally unique key, compares the complete
validated request (actor/action/lead/body), reads the stored ACV, writes, and saves the
original response. An exact replay returns that saved response, even after later changes
or restart. A changed request returns 409 `OPERATION_CONFLICT`; missing/invalid keys return
400. Route ACV is an equality assertion, never an update: mismatch returns 409
`ACV_MISMATCH` and changes nothing. Responses expose `Idempotency-Key` and
`Idempotency-Replayed: true|false`. Internal receipt reads do not expose the saved raw result.
Receipt `action` is `route|classify`. Reset returns `{leads, decisions, operations}`:
fixture historical decisions are restored; operation receipts are cleared.

## Hooks and policy

`/access`, `/pre`, and `/post` require the configured Arcade bearer secret and validate the
vendored hook schemas. Access responses retain the exact toolkit/tool/version-array shape.
Pre denials use `CHECK_FAILED` and a remediation message; post modifications use
`OK` with `override.output`. Invalid input, unknown identity/tool, lookup failures, and
uninspectable sensitive output fail closed.

Reuse `compilePolicy`, `resolveVisibility`, `evaluatePermission`, and `routeApproval`.
Configure Elastic tools from observed gateway names, never guessed normalizations.
The authority check overlays independently read ACV, while retaining the exact original
arguments for the pending action. Reject inconsistent asserted ACV without creating a grant.
Only an authority-limit denial can be remediated by a grant. Grants cannot override an
access/identity/assignment denial.

A denied route persists an opaque denial ID, requester, tool, complete inputs including
`operation_key`, authoritative value, execution ID, and expiry. The remediation instructs
the model to call `Approvals.RequestApproval(denial_id, justification)`.

Grants bind every original input, requester, tool, resource and authoritative value, with
`ceiling: null` and exact pinned inputs. First use claims the operation atomically. Another
operation cannot reuse it. An identical operation may retry before expiry; after expiry
it can only replay a matching completed lead receipt, never begin a new write. This avoids
pretending two independent databases share one transaction. The lead transaction supplies
the final one-write guarantee.

Output filtering handles JSON objects/arrays and JSON inside MCP text blocks, preserving
legitimate evidence. Unsupported binary content and filtering errors return failed checks.
The default rules remove synthetic personal-phone fields and the fixture's injected text;
this is not a claim to detect every possible prompt injection. Audit stores safe output and
rule/marker metadata, never unfiltered phone/instruction bodies.

Operator routes use `WORKSHOP_OPERATOR_TOKEN`, separate from all tool/web credentials:
`GET/PUT /operator/policy`, `GET /operator/state`, `POST /operator/activate`,
`POST /operator/reset`, `GET /operator/runs/:id/evidence`, and
`POST /operator/runs/:id/recover`. Reset refuses active workers and returns an incremented
`reset_epoch`. Recovery requires `{worker_stopped:true, lease_id}` for the current expired
lease. Run evidence includes safe trace/audit and a SHA-256 receipt binding over the
requester, action, resource, and exact canonical business body.
Policy updates validate/compile completely before an atomic swap. Start in staged mode;
only a configured verification identity can inspect sensitive tools until the operator has
observed a denial and filtered result through the actual gateway and activates normal roles.

## Approval toolkit and notification

The Python toolkit is `MCPApp(name="approvals")`, exposing `RequestApproval` and `Decide`.
RequestApproval requires stock Slack's four scopes (`chat:write`, `im:write`, `users:read`,
`users:read.email`). Decide requires the custom demo IdP. Both receive
`HOOKS_PUBLIC_HOST` and `APPROVALS_SERVICE_TOKEN` as tool secrets.

These hooks routes require the approvals service bearer. The Python tool derives actor
fields from trusted `Context.user_id`; they are never model arguments.

| Route | Body | Result |
|---|---|---|
| `POST /internal/approvals/request` | `{denial_id, justification, requester_id}` | Find/create one public request from the owned denial |
| `POST /internal/approvals/:id/notification/claim` | `{requester_id, slack_user_id, slack_team_id}` | `{claim_id, notification_status}`; null claim if already sending/sent/uncertain |
| `POST /internal/approvals/:id/notification/result` | `{requester_id, claim_id, outcome, channel?, ts?, error?}` | Updated public request; identical acknowledgement is idempotent |
| `POST /internal/approvals/:id/decision` | `{actor_id, decision, note?}` and `X-Actor-Token` | Committed request/grant state after independent IdP verification |

Public request fields are `request_id`, `requester_id`, `approver_id`, `requester_name`,
`approver_name`, `operation_key`, `tool_name`, `inputs`, `resource_id`, `required_clearance`,
`status`, `notification_status`, and `approval_url`. Filter free text before exposing it.
Run displays combine tools, so stored trace/text/error display applies the requester's
current output restrictions conservatively across the combined view, including older
stored traces. The requester-filtered copy is the canonical display for both the requester
and assigned approver; reads do not apply a separate approver-specific filter. Immediate
browser text/tool-call traces use that copy. Tool-result error summaries and authorization
metadata retain their individual tool's post-hook filtering scope.
Filtered `inputs` is a display copy only. Never replace the canonical denied arguments or
execute this display copy. The resume action comes from the exact stored run action after
requester/operation/approval binding has been verified.
Decision values are `approve|deny`; request states are `pending|approved|denied|expired`.

Only the configured solo delivery mapping permits a self-DM. Routing still chooses Riley
over eligible Morgan. Verify the IdP email equals the tool context actor, is the assigned
approver, differs from requester, has sufficient authority, and the request is current.
Repeated identical decisions return the existing grant. A different subsequent decision
conflicts. A Slack link carries only the request ID and no decision capability.

Notification states are `pending|sending|sent|failed|uncertain`. Acquire one claim before
`chat.postMessage`. Only documented no-send rejections are retryable. Slack `internal_error`
and `fatal_error`, 5xx responses, ambiguous dispatch, or a lost process keep the claim
uncertain and must not automatically repost. If Slack acknowledged
success but the hooks acknowledgement failed, retry only acknowledgement. Exactly-once
remote Slack delivery is not guaranteed; business-write idempotency is a separate claim.

## Web and continuation

All run/read routes require `WEB_SERVICE_TOKEN`. Web passes the validated session identity
as `viewer_user_id` on reads and `actor_user_id` on mutations. Hooks scopes reads to the
requester or assigned approver. A forged browser field cannot select these identities.

| Route | Body/result |
|---|---|
| `POST /internal/runs` | `{run_id, requester_user_id, stage, message}` → `{run}` |
| `GET /internal/runs/:id` | `viewer_user_id` query → `{run}` |
| `POST /internal/runs/:id/action` | `{operation_key, tool_name, arguments}` → `{run}` |
| `POST /internal/runs/:id/approval` | `{request_id, tool_call_id, operation_key}` → `{run}` |
| `POST /internal/runs/:id/suspended` | `{tool_call_id, text?, tool_calls?}` → `{run}` |
| `POST /internal/runs/:id/resume` | `{actor_user_id}` → `{lease_id, run, approval, action}` |
| `POST /internal/runs/:id/result` | `{lease_id?, status, text, tool_calls, error?}` → `{run}` |
| `POST /internal/runs/:id/close` | `{actor_user_id}` → terminal no-write `{run}` |
| `GET /internal/approvals/:id` | `viewer_user_id` query → `{approval, run_id}` |
| `GET /internal/policy` | Authenticated read → `{version, subjects, rules, output_rules}` |
| `GET /internal/audit` | `run_id`, `viewer_user_id`, `after` → `{events, next_cursor}` |

A run records `run_id`, `requester_user_id`, `stage`, `status`, `request_id`, `operation_key`,
`tool_call_id`, `text`, and `error`. Statuses are
`running|awaiting_snapshot|waiting|resuming|completed|failed`.
Only one active governed run per requester is allowed in this workshop application.
Execution/operation IDs and the active requester run correlate safe hook events with the
agent's own tool trace. Operator probes use the separate verification identity.

Before a write, web supplies a stable operation key and records the exact attempted action.
The approval binding must match that action, its denial, the requester, and the unique
request/run association. The model cannot invent that association with an approval ID.

Wrap only the discovered RequestApproval tool for suspension. On successful delivery,
persist its binding as `awaiting_snapshot`, then return `context.agent.suspend(...)`.
After Mastra has persisted and returned its suspended snapshot, mark the run `waiting`.
An early approval cannot race into resumption before the snapshot exists. If delivery is
failed/sending/uncertain, show that state without claiming a successfully delivered wait.

Resume atomically claims a waiting, approved run with a short lease. Rebuild the same
agent and its MCP tools, then call native `resumeGenerate` with the stored run/tool-call
IDs and server-verified resume data. The wrapper returns the recorded decision instead
of reissuing RequestApproval. Reconnect as the original requester, even while the browser
is signed in as Riley. Save the final result before responding; repeated resume requests
return it. Pending/denied/expired permission cannot begin a write.

An authenticated requester may close a non-resuming failed/delivery-pending run. Either
requester or assigned approver may close a denied/expired wait. Closing marks it `failed`
with a safe terminal reason and blocks subsequent resume, releasing the active-run slot.
Web then deletes any native snapshot through the storage API without running a tool. A
cleanup failure remains visible and can retry; a leftover snapshot cannot resume a closed
hooks record. Never close an active resume lease. Browser exposes a CSRF-protected close
route and a new-exercise control for failed/denied waits.

Initial result updates omit a lease; resumed updates require the current unexpired lease,
and stale updates fail. This deployment has one web worker. A lost resume lease is a
visible recovery condition, never permission to launch an overlapping native snapshot
writer. Operator recovery requires stopping the old worker first, then invalidating its
lease and reusing the existing snapshot. If the snapshot is absent, report that condition
and inspect the operation receipt instead of silently starting a new run. The mandatory
restart proof covers the persisted waiting state; it does not claim atomicity across
Mastra snapshot completion and hooks result recording.

Browser routes cover session/login/callback/logout, the Arcade verifier, agent execution,
run status/resume, approval status/decision, and safe audit/policy reads. Decision requests
require CSRF and invoke discovered Decide through Arcade, never a direct local grant.
The UI labels the active demo role and preserves the pending Dana run while switching.

## Proof and operator commands

Use real services, SQLite/LibSQL and MCP in local integration tests, controlling only the
external model, Arcade and Slack network boundaries. The scripted model must see filtered
real tool results. Restart the web process while waiting, complete real IdP authentication,
and verify one final lead decision with source citations. Separately exercise rejection,
expiry, duplicate/replayed keys, failed/ambiguous delivery, policy rollback and audit scope.

The stage-specific doctor/setup, observed gateway discovery, clean/governed Elastic
seed/reset, baseline reset, and capstone evidence commands live in `scripts/workshop.ts`. Setup guides account consent
and public-service provisioning where no verified automation API is available; it never
prints a successful connection merely because configuration values exist.

Live capstone uses actual configured cloud services and a model and retains citations,
gateway decisions, Slack acknowledgement, approval identity, resumed run and operation
receipt. Missing credentials, failed or unexercised boundaries and read-only fallback
produce explicit incomplete/degraded results. Local tests never qualify as live proof or
as a measured 55-minute rehearsal.
