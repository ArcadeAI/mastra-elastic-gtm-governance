# MCP4GTM delivery plan: an at-risk renewal

Event: Thursday 2026-10-08, 4:30–8:30 PM, Elastic SF (88 Kearny, Fl 19) + livestream.
Partners: Arcade hosts and owns Module 3; Mastra owns Module 1; Elastic owns Module 2.
Target: 1,000 registered; 60–100 in room. The repository is public.

Following Andrew's feedback, the business action is an AE's discount offer. Permission
applies directly to the requested discount percentage. That makes the approval boundary
concrete: Dana can offer up to 15%, the buyer requests 30%, and Riley can approve up to 40%.
Guru's feedback adds the business context and a hands-on execution-hook exercise.

Northwind's October 31 renewal is at risk. Seats fell 220→140 and monthly sign-ins
85,000→42,000; case CS-1042 remains open for SCIM deprovisioning delays. The cause of the
decline and a resolution date are unverified. Its annual list price is $12,000; a 30%
discount produces an $8,400 offer. The agent uses Elastic evidence to write a customer
follow-up. Riley reviews the exact message and terms, then Dana's action resumes once.
GetOffer verifies the saved result. Arcade removes a fake API key pasted into the support
ticket and the synthetic personal phone before model consumption. No customer email,
external signature request or real provisioning is part of the workshop.

## Decisions and handoffs

| Decision | Delivery consequence |
|---|---|
| Same attendee-owned agent and gateway throughout | Save the supplied question, compare native evidence, then inspect cited results and the approved draft in the same project. |
| Mastra → Elastic → Arcade → capstone | Each partner owns its setup; Arcade alone teaches the Elastic-to-gateway connection. |
| 55 minutes per partner, signup included | Equal allocations for onsite and remote attendees; capstone adds 20 minutes. |
| One custom Sales toolkit | `SearchAccounts`, `GetAccount`, `CreateDiscountedOffer`, `GetOffer` deploy from `tools/lead`. Native Elastic remains Remote MCP. |
| App-managed approvals | Web/hooks own review, delegated Slack authorization, self-DM delivery and authenticated decisions. |
| One attendee plays Dana and Riley | Separate seeded OAuth identities; Dana uses the real Arcade member email. No second person or extra inbox. |
| Exact discount permission | Grant binds all saved inputs, including customer_message. Changing terms or text needs a new action. |
| Draft artifacts | Save an offer and follow-up email locally. The only external message in the exercise is the authorized Slack self-DM. |
| Visible verification | Configure staged access, observe hook metadata, verify filtered GetAccount and a denied 30% probe, then activate. |
| Read-back is part of completion | Host requires GetOffer after creation, matching the saved offer ID, account, 30%, $12,000 list, $8,400 net and draft status. |
| Attendee-authored output rule | Capstone init/test/apply/verify removes support.internal_owner_email while preserving issue, renewal and price. |

The scenario is `ACC-2291`. Dana/Riley/Morgan discount ceilings are 15/40/75%; Sam cannot
create offers. The API accepts percentages as 0–100, not fractions. Every artifact must
use these terms consistently. Andrew's other meeting topics are outside this repo change.

## Run of show

These are planned teaching allocations. This renewal revision needs a fresh-account timed
rehearsal; older workshop checks do not establish that it fits.

| Time | Block | Attendee action | Checkpoint |
|---|---|---|---|
| 4:30 | Doors, food, laptop help, 15 min | Open repo and check tools with TAs. | Ready for Module 1. |
| 4:45 | Kickoff, Thierry, 10 min | Watch Northwind's request through evidence, denial, self-DM approval and safe draft read-back. | Understand what each partner adds. |
| 4:55 | Mastra, 55 min | Sign up, configure model, run supplied request, edit instructions. | Recommendation and evidence gaps saved. |
| 5:50 | Elastic, 55 min | Sign up, provision, seed eight events, retrieve/aggregate, prepare native MCP. | Source IDs, MCP URL and read-only key. |
| 6:45 | Break, 10 min | Break. | Resume at 6:55. |
| 6:55 | Arcade, 55 min | Sign up, connect Elastic, deploy Sales/supporting services, verify hooks, approve and read back draft. | One $8,400 offer and an evidence-grounded follow-up draft. |
| 7:50 | Capstone, 20 min | Inspect the run; write, test, apply and verify one output rule; reset. | Local-fixture and gateway-read proof for the attendee's rule. |
| 8:10 | Show and tell, forking discussion, Q&A, 20 min | Three attendee demos including one remote. | Next steps for a real commercial system. |
| 8:30 | Close | End. | |

Module 3 allocates 15 minutes to the first connection, 20 to deployment and verified
activation, 15 to approval/continuation/read-back, and 5 to inspection. If measured setup
exceeds the budget, improve the tooling and rehearse again. Keep equal partner totals and
the full approval loop. Staff each partner's TA, an Arcade floater and a remote chat monitor.
Capstone uses 5 minutes for inspection, 12 for the hook lab and 3 for evidence/reset.
Additional evidence and permission variations are take-home extensions, not hidden work
inside those 20 minutes.

Publish [Arrival](ARRIVAL.md) around Oct 1 and a reminder Oct 5. Optional downloads reduce
laptop friction; partner signup stays in its section. Use [Operator setup](OPERATOR.md),
[Testing](TESTING.md) and the [module guides](modules/01-mastra.md) as current instructions.

## Acceptance and readiness gates

The attendee should show cited evidence with uncertainty; Sam's missing creation tool;
Dana's 30% denial; rejected self-approval; Riley's authenticated decision; Dana's exact
continuation; one saved offer and reviewed customer message; GetOffer read-back; redacted
pasted credential and phone; an authored output rule verified through the gateway; and replay
without a second write. A delivered DM alone is not completion. The
[capstone worksheet](modules/04-capstone.md) records those checks.

| Date | Gate | Required evidence |
|---|---|---|
| Sep 12 | Native Elastic integration | Fresh project → seed → native search → scoped MCP → Arcade → same agent's cited answer. Actual names and result shapes recorded. |
| Sep 18 | Complete renewal loop | Current local tests plus an authorized real-service run, exact approval/continuation, grounded message, GetOffer and hook-lab proof. |
| Sep 25 | Cold start | Someone outside the build team completes fresh machine/accounts within each 55-minute block. Record all help and failures. |
| Sep 28–Oct 2 | Partner dry runs | Each owner passes its setup and handoff; joint end-to-end run includes a remote attendee. |
| Oct 1 | Public materials complete | Commands match code, prerequisites are published, and unresolved limits remain visible. |
| Oct 6 | Prep call | Headcount, AV/capture plan, Slack invite, model-credit access and remote support confirmed. |
| Oct 7 | Venue tech check | Two laptops run the full flow and reset on venue wifi; stream and fallback credentials checked. |

## Live integration questions

Record native MCP names/schemas, Arcade's names, hook toolkit/tool/argument identities,
authentication/space privileges, and actual search payloads. Rehearse `hook-tools` bootstrap
so attendees do not infer names or edit server logging. Check explicit fail-closed settings
and a hook-outage drill. Verify the synthetic pasted-key/phone/instruction markers never reach Mastra
while the legitimate price and discount remain.

The eight-event fixture uses plain text fields. Describe observed retrieval behavior
without asserting semantic search. A competitor's $9,000 quote has unverified scope, and
the buyer's stated $8,400 budget is unconfirmed; neither grants approval. The agent must
explain what it knows and what still needs review.

Measure native/gateway search latency, discovery, provisioning, provider consent and TA
assistance, including the attendee's hook edit and error recovery. Record current code and
deployed revisions. Historical spike and earlier discount evidence do not certify this revision.

## Delivery dependencies and fallback

Confirm the model-key/credit arrangement, workshop Slack invite, remote support and
supported hands-on capacity. One Sales deployment does not make Render's four persistent
services, Elastic and model usage free. Review displayed provider costs at signup.

If Elastic provisioning fails, use a declared shared read-only clean fixture. Each
attendee still owns their gateway and account/approval services. Present fixture mutations
on the presenter's separate deployment and mark participant mutation coverage degraded.
Rehearse credential distribution, expiry/renewal and capacity for onsite and remote users.

| Risk | Mitigation |
|---|---|
| Setup hides the payoff | Complete the first cited Elastic answer before action-service deployment. |
| Hosted app differs from local agent | Commit instruction edits, deploy that branch, and record both revisions. |
| OAuth starts on the wrong origin | Use the deployed web URL and matching callback/verifier; update operator .env separately. |
| Draft email is mistaken for a sent message | Label status and final answer explicitly as drafts; no external customer transport exists. |
| Approval is granted for changed terms | Exact action binding plus API operation receipt and read-back. |
| Pasted credential reaches the agent | Filter the account and support evidence before model consumption. |
| Follow-up invents a cause or fix date | Check its citations and explicit uncertainty; exact text matching alone does not prove writing quality. |
| Local hook test is mistaken for deployment proof | Require the separate gateway-read verification after apply. |
| Slack outcome is ambiguous | Preserve delivery state and inspect; never automatically repost. |
| Concurrent setup exceeds capacity | Rehearse 5–10 concurrent accounts and publish measured limitations. |

The renewal revision's local proof is recorded in [Local verification](LOCAL-VERIFICATION.md).
Next: verify native Elastic interoperability and one authorized self-DM through the
deployed app. Then run the fresh-account rehearsal,
close its recovery gaps and reconcile event/speaker copy. Publishing those updates is a
separate action from changing these files.
