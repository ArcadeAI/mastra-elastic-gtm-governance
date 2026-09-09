# At-risk renewal runtime contract

This describes the Northwind renewal revision. Use [Testing](TESTING.md) for current
checks. The [verification record](LOCAL-VERIFICATION.md) dates earlier results; they do
not certify this revision's implementation, live integration or workshop timing.

## Account and offer API

The business service remains in `apps/lead-app`; its Arcade toolkit is named **Sales**.
Public endpoints require the user's OAuth bearer. The API resolves that token through the
IdP; an actor is never a model-supplied argument.

| Endpoint | Contract |
|---|---|
| `GET /accounts` | Search account records. |
| `GET /accounts/:id` | Account, subscription/renewal context, unresolved support case and current offer. |
| `POST /accounts/:id/offers` | `{discount_percent,list_price,rationale,customer_message}` with `Idempotency-Key`. Creates a draft offer and follow-up email. |
| `GET /accounts/:id/offer` | Saved offer, including draft terms and follow-up email. |
| `GET /internal/accounts/:id/value` | `{account_id,list_price}` for independent price validation. |
| `GET /internal/operations/:key` | `{operation_key,actor,action:"discount",account_id,body,completed_at}`; 404 if absent. |
| `POST /internal/reset` | Restore account fixtures and clear exercise offers/decisions/receipts. |

Internal endpoints require `LEAD_INTERNAL_TOKEN`; the name is retained for service
compatibility. The toolkit exposes `SearchAccounts`, `GetAccount`, `CreateDiscountedOffer`
and `GetOffer`. The latter takes `account_id`, not an offer ID.

The Northwind account is `ACC-2291`, with `product: "B2B identity and access software"`,
`billing_cycle: "yearly"` and `list_price: 12000`. Account output includes the billing
contact, active subscription, October 31 renewal, `support` and an optional offer.
Support case CS-1042 is open for SCIM deprovisioning delays, without a confirmed fix date.
`support.api_key` contains a fake pasted credential beginning `workshop_support_FAKE_`;
`support.internal_owner_email` is the field used by the attendee hook lab.

Offer output contains `account_id`, `offer_id`, `discount_percent`, `list_price`,
`net_price`, `status: "draft"`, `follow_up_email` and decisions. The follow-up-email
object contains only `to`, `subject` and `body`. The API sets the recipient from
`billing_contact.email` and builds a draft subject. The body preserves the agent's
`customer_message` verbatim and appends canonical annual list/discount/net terms and the
local-draft label. The agent cannot supply a different recipient or override those terms.
No customer email or external signature request is sent.

`discount_percent` uses percentage units in the 0–100 range, so 30 means 30%. For Northwind, 30% of
$12,000 produces $8,400 net. `list_price` asserts the stored value and cannot overwrite it.
A nonempty rationale and a nonblank `customer_message` of at most 4,000 characters are
required. Riley reviews the proposed message with the exact commercial terms. The host supplies the operation key, which binds the
actor, action, account and exact validated business body. An identical replay returns the
saved response; a changed request conflicts. A transaction commits the offer and receipt
together so repeated continuation cannot create a second write for that operation.

## Identity, permissions and filtering

Dana is the account executive with a 15% discount ceiling. Riley, the sales manager, has
40%; Morgan has 75%; Sam has no offer-creation access. One attendee can play the seeded
roles. Dana uses the attendee's actual Arcade account email. Selecting a role starts fresh
IdP OAuth sign-in; the name alone grants no authority.

Web has its own stable OAuth client, separate from Arcade's client. State, PKCE, issuer and
expected identity are checked at callback. The IdP token lives encrypted inside an HttpOnly
session cookie. Mutation routes require matching Origin and CSRF. The custom Arcade
verifier confirms the signed-in identity. Stock Slack retains project-member verification.

The supplied stage needs only a model; the Elastic stage adds the gateway and selected
read tools. The governed stage adds authenticated identity, hooks and persistent storage.
Required connection failures remain visible instead of falling back to supplied input.

Arcade invokes `/access`, `/pre` and `/post` using `ARCADE_HOOK_SECRET`. Access hides offer
creation from Sam. The pre-hook checks the requested discount against the caller's ceiling
and independently reads list price. Only a discount-permission denial can be remediated by
a grant. Grants cannot override an access or identity denial.

An approval binds every saved input: requester, account, tool, percentage, list price,
rationale, customer message and operation key. Changing one requires a new action. The post-hook removes
API-key fields and the fake credential string, personal phone fields and the known fixture
instruction from model-facing output, including nested JSON/MCP text and email drafts.
Legitimate prices and discount values remain visible. Unsupported sensitive content fails
closed. The filter demonstrates fixture rules, not universal injection or secret detection.

## Staged setup

`ARCADE_SALES_TOOLKIT=Sales` supplies the hook toolkit identity. Set
`ARCADE_DISCOUNT_TOOL_NAME` from the actual gateway's CreateDiscountedOffer name. Elastic
hook identities use a separate `ARCADE_ELASTIC_HOOK_TOOLS` mapping.
Set `ARCADE_GET_OFFER_TOOL_NAME` to the observed GetOffer name so the host can identify the
required read-back. Both Sales names belong to the same custom toolkit deployment.

`hook-tools` reads `/operator/observed-tools`, exposing only authenticated hook toolkit/tool
names and argument keys. Start with `/access` names and empty argument lists, configure and
redeploy hooks, perform a clean Elastic read, then collect and configure observed keys.
No raw arguments, tokens or output bodies are part of this inventory.

The separate `WORKSHOP_VERIFICATION_USER_ID` can inspect staged Sales tools. Sign in through
`/auth/login?persona=verification`, then run the CLI's filtered `GetAccount` and 30% offer
probe. The empty rationale also fails API validation if the pre-hook is missing. The CLI
requires fresh filtered output and the matching authority rejection returned through the
gateway; callbacks alone cannot activate normal roles. It confirms the completed attempt
with hooks before `activate`. No model, approval request or Slack call runs in verification.

The later `hook-lab` exercise is separate from setup activation. Init emits an incomplete
Sales.GetAccount output rule; test uses the real local filter and renewal fixture. Apply
validates that rule and preserves existing policy. Verify reads ACC-2291 through the
observed GetAccount tool as Dana: `support.internal_owner_email` must be absent while the
unresolved issue, renewal and price remain. Local fixture success is not gateway proof.

## Host approval and notification

Web's server-only approval client uses `ARCADE_API_KEY` for delegated Slack authorization
with `chat:write`, `im:write`, `users:read`, and `users:read.email`. It derives the real Slack
user/team with `auth.test` and opens that user's DM. A model cannot choose a destination.
Only the requester can deliver the request; an optional configured team restricts delivery.

| Hooks endpoint | Host request |
|---|---|
| `POST /internal/approvals/request` | `{run_id,requester_id,justification}` for the run's exact owned denial. |
| `GET /internal/approvals/:id/delivery` | `requester_id` query. |
| `POST /internal/approvals/:id/notification/claim` | Requester, actual Slack user and team; atomically claims delivery. |
| `POST /internal/approvals/:id/notification/result` | Claim and sent/failed/uncertain outcome with provider receipt. |
| `POST /internal/approvals/:id/decision` | Actor, approve/deny, optional note, plus `X-Actor-Token`. |

These endpoints use `APPROVALS_SERVICE_TOKEN`, shared only by web and hooks. Hooks
independently validates the human's IdP token, assignment, current authority, exact terms,
request expiry and confirmed delivery before deciding. Dana cannot self-approve. Receiving
the link grants no authority. Repeated identical decisions are idempotent; conflicts fail.

Notification states are pending, sending, sent, failed and uncertain. Claim before posting.
Known no-send rejections allow explicit retry; uncertain outcomes do not automatically
repost. Retry a lost acknowledgement without resending the message. Exactly-once remote
Slack delivery is not promised; account-write idempotency is a separate boundary.

## Native continuation and read-back

The host records the exact proposed action before invoking it through Arcade. An authority
denial triggers app-managed review and can send the self-DM before the user clicks Approve.
Bind the request and tool-call ID, suspend natively, then mark waiting only after Mastra
returns its persisted snapshot. Consent may remain pending; show the delivery status.

Riley's authenticated approval page records the decision with hooks. Resume claims the
waiting run with a lease, rebuilds the same agent and MCP tools, and invokes native
`resumeGenerate` with the saved run/tool-call IDs. It reconnects as Dana and executes the
same action through Arcade. The agent is instructed to call `GetOffer(account_id)` to verify the saved
30%/$12,000/$8,400 draft terms and inspect the saved follow-up-email draft.

Completion requires an actual successful GetOffer result after the write, matching the
saved offer ID, account, discount, list price, net price, draft status and exact nonblank
email recipient, subject and body from creation. If the read is
missing, fails or disagrees, report the saved offer and failed read-back instead of a
completed run; another write is not a repair. Connected local tests use a scripted model
and do not establish that a live model will obey the instruction.

Hooks owns run metadata and exact bindings; web owns native LibSQL snapshots. Supported
states are running, awaiting_snapshot, waiting, resuming, completed and failed. One active
governed run per requester and one web worker are supported. A missing/expired lease needs
explicit recovery after stopping the old worker, never an overlapping snapshot writer.
Closing a failed, denied, expired or undelivered exercise releases the active-run slot and
deletes its native snapshot; an active resume cannot close. Missing snapshots remain an
explicit failure, not permission to create a replacement prompt.

Run/read endpoints use `WEB_SERVICE_TOKEN`. The browser's authenticated session determines
viewers and actors. Hooks scopes reads to requester or assigned approver. Public displays
use filtered copies; execution always uses the original canonical action.

## Operators and proof

`WORKSHOP_OPERATOR_TOKEN` protects policy reads/updates, verification confirmation,
activation, observed metadata, reset and run evidence/recovery. Policy updates validate and
compile before atomic replacement; stale versions conflict and invalid changes leave the
prior policy intact. Operator credentials never enter model tools.

Reset calls each state owner, preserves both OAuth clients and removes extra Elastic
documents. It clears approval state, offers, receipts and native snapshots, and requires a
new sign-in and verification before another governed run. A partial reset is incomplete.

Local tests should use actual application services, OAuth and MCP, with controlled model,
Arcade, Elastic and Slack collaborators. Live proof separately needs native retrieval,
observed enforcement, authorized self-DM, Riley's real login, Dana's exact continuation,
one saved offer, a GetOffer read-back and filtered email output. Capstone collects existing
evidence; it does not send messages or run the agent. Unverified cloud provenance remains
incomplete, and fresh-account timing must be measured separately.
