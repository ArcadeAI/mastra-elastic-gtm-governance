# MCP4GTM delivery plan: approved discount offers

Event: Thursday 2026-10-08, 4:30–8:30 PM, Elastic SF (88 Kearny, Fl 19) + livestream.
Partners: Arcade hosts and owns Module 3; Mastra owns Module 1; Elastic owns Module 2.
Target: 1,000 registered; 60–100 in room. The repository is public.

Following Andrew's feedback, the business action is an AE's discount offer. Permission
applies directly to the requested discount percentage. That makes the approval boundary
concrete: Dana can offer up to 15%, the buyer requests 30%, and Riley can approve up to 40%.
The old routing/ACV story is superseded.

Northwind buys B2B identity and access software. Its annual list price is $12,000; a 30%
discount produces an $8,400 draft offer. Elastic holds the renewal justification and its
uncertainties. After approval, Dana's exact action resumes once, then the agent reads the
offer back and checks its terms. Arcade redacts the synthetic activation token from trial
provisioning and the activation-email draft. No customer email, external signature request
or real provisioning is part of the workshop.

## Decisions and handoffs

| Decision | Delivery consequence |
|---|---|
| Same attendee-owned agent and gateway throughout | Save the supplied question, compare native evidence, then inspect cited results and the approved draft in the same project. |
| Mastra → Elastic → Arcade → capstone | Each partner owns its setup; Arcade alone teaches the Elastic-to-gateway connection. |
| 55 minutes per partner, signup included | Equal allocations for onsite and remote attendees; capstone adds 20 minutes. |
| One custom Sales toolkit | `SearchAccounts`, `GetAccount`, `CreateDiscountedOffer`, `GetOffer` deploy from `tools/lead`. Native Elastic remains Remote MCP. |
| App-managed approvals | Web/hooks own review, delegated Slack authorization, self-DM delivery and authenticated decisions. |
| One attendee plays Dana and Riley | Separate seeded OAuth identities; Dana uses the real Arcade member email. No second person or extra inbox. |
| Exact discount permission | Grant binds all saved inputs. Changing percentage, price or rationale needs a new action. List price asserts the stored account value. |
| Draft artifacts | Save an offer and activation email locally. The only external message in the exercise is the authorized Slack self-DM. |
| Visible verification | Configure staged access, observe hook metadata, verify filtered GetAccount and a denied 30% probe, then activate. |
| Read-back is part of completion | Host requires GetOffer after creation, matching the saved offer ID, account, 30%, $12,000 list, $8,400 net and draft status. |

The scenario is `ACC-2291`. Dana/Riley/Morgan discount ceilings are 15/40/75%; Sam cannot
create offers. The API accepts percentages as 0–100, not fractions. Every artifact must
use these terms consistently. Andrew's other meeting topics are outside this repo change.

## Run of show

These are planned teaching allocations. The discount version needs a fresh-account timed
rehearsal; older routing checks do not establish that it fits.

| Time | Block | Attendee action | Checkpoint |
|---|---|---|---|
| 4:30 | Doors, food, laptop help, 15 min | Open repo and check tools with TAs. | Ready for Module 1. |
| 4:45 | Kickoff, Thierry, 10 min | Watch Northwind's request through evidence, denial, self-DM approval and safe draft read-back. | Understand what each partner adds. |
| 4:55 | Mastra, 55 min | Sign up, configure model, run supplied request, edit instructions. | Recommendation and evidence gaps saved. |
| 5:50 | Elastic, 55 min | Sign up, provision, seed eight events, retrieve/aggregate, prepare native MCP. | Source IDs, MCP URL and read-only key. |
| 6:45 | Break, 10 min | Break. | Resume at 6:55. |
| 6:55 | Arcade, 55 min | Sign up, connect Elastic, deploy Sales/supporting services, verify hooks, approve and read back draft. | One $8,400 offer and redacted activation-email draft. |
| 7:50 | Capstone, 20 min | Inspect controls, change evidence/permission and record limits. | Correlated evidence for the complete journey. |
| 8:10 | Show and tell, forking discussion, Q&A, 20 min | Three attendee demos including one remote. | Next steps for a real commercial system. |
| 8:30 | Close | End. | |

Module 3 allocates 15 minutes to the first connection, 20 to deployment and verified
activation, 15 to approval/continuation/read-back, and 5 to inspection. If measured setup
exceeds the budget, improve the tooling and rehearse again. Keep equal partner totals and
the full approval loop. Staff each partner's TA, an Arcade floater and a remote chat monitor.

Publish [Arrival](ARRIVAL.md) around Oct 1 and a reminder Oct 5. Optional downloads reduce
laptop friction; partner signup stays in its section. Use [Operator setup](OPERATOR.md),
[Testing](TESTING.md) and the [module guides](modules/01-mastra.md) as current instructions.

## Acceptance and readiness gates

The attendee should show cited evidence with uncertainty; Sam's missing creation tool;
Dana's 30% denial; rejected self-approval; Riley's authenticated decision; Dana's exact
continuation; one saved offer; GetOffer read-back; redacted activation tokens; and replay
without a second write. A delivered DM alone is not completion. The
[capstone worksheet](modules/04-capstone.md) records those checks.

| Date | Gate | Required evidence |
|---|---|---|
| Sep 12 | Native Elastic integration | Fresh project → seed → native search → scoped MCP → Arcade → same agent's cited answer. Actual names and result shapes recorded. |
| Sep 18 | Complete discount loop | Current local tests plus one authorized real-service run, delayed human decision, exact continuation, saved terms and GetOffer redaction. |
| Sep 25 | Cold start | Someone outside the build team completes fresh machine/accounts within each 55-minute block. Record all help and failures. |
| Sep 28–Oct 2 | Partner dry runs | Each owner passes its setup and handoff; joint end-to-end run includes a remote attendee. |
| Oct 1 | Public materials complete | Commands match code, prerequisites are published, and unresolved limits remain visible. |
| Oct 6 | Prep call | Headcount, AV/capture plan, Slack invite, model-credit access and remote support confirmed. |
| Oct 7 | Venue tech check | Two laptops run the full flow and reset on venue wifi; stream and fallback credentials checked. |

## Live integration questions

Record native MCP names/schemas, Arcade's names, hook toolkit/tool/argument identities,
authentication/space privileges, and actual search payloads. Rehearse `hook-tools` bootstrap
so attendees do not infer names or edit server logging. Check explicit fail-closed settings
and a hook-outage drill. Verify the synthetic token/instruction markers never reach Mastra
while the legitimate price and discount remain.

The eight-event fixture uses plain text fields. Describe observed retrieval behavior
without asserting semantic search. A competitor's $9,000 quote has unverified scope, and
the buyer's stated $8,400 budget is unconfirmed; neither grants approval. The agent must
explain what it knows and what still needs review.

Measure native/gateway search latency, discovery, provisioning, provider consent and TA
assistance. Record the current code/deployed revisions with the result. Historical spike
and routing evidence remain historical; they do not certify this discount version.

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
| Activation token appears in a draft | Filter GetAccount, creation output and GetOffer at the model boundary. |
| Slack outcome is ambiguous | Preserve delivery state and inspect; never automatically repost. |
| Concurrent setup exceeds capacity | Rehearse 5–10 concurrent accounts and publish measured limitations. |

Next: finish and record the discount-version local proof, native Elastic interoperability,
and one authorized self-DM through the deployed app. Then run the fresh-account rehearsal,
close its recovery gaps and reconcile event/speaker copy. Publishing those updates is a
separate action from changing these files.
