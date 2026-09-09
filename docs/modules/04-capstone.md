# Capstone — prove the complete workflow

**Owner:** Arcade leads the integrated exercise, with all partner TAs available.
**Budget:** 20 minutes.

**Guide status:** the runtime, reset command, policy endpoint, and read-only evidence
collector are implemented. The checks below define the live workshop acceptance exercise;
local tests do not certify the cloud path.

## Follow one request all the way through

Start from the governed baseline: the eight Elastic event IDs include the prepared
adversarial variant, output filters are active, Dana's authority is $50K, and prior routes
and grants have been reset. Clear completed/pending continuations so no prior approval can
resume a new probe. Use the same Mastra agent and Arcade gateway from Module 3.

Ask Dana's agent to research Northwind and route the $95K lead to its proposed owner,
obtaining approval if needed. Follow the trace together: cited Elastic research → blocked
route → `request_approval` → Riley's request in your own Slack DM using the connected
requester authorization → switch to Riley and authenticate on the approval page → resume
the same Dana conversation → identical retry → one route
write and the final cited brief.

The Slack link opens the decision surface; it carries no permission to approve. The decision
must come from the assigned signed-in approver and apply to the exact action. Check that the
human wait preserves the request and arguments, with one successful write after resumption.
Save this trace as the evidence for the corresponding checks below; the checklist inspects
the completed journey rather than requiring a second manual approval cycle.

## Change the evidence and policy

Add the prepared account-history event explaining that Northwind already has an enterprise
agreement handled by Riley's team, using your separate setup credential. Ask the same agent
again and inspect the citation supporting its change to follow-up. The new Elastic evidence
changes the recommendation through the existing gateway connection.

Restore the governed baseline and clear the previous grant/write. Use the [operator guide](../OPERATOR.md) to edit policy through its
authenticated endpoint to raise Dana's authority, then rerun the controlled route
probe. Restore the $50K limit and verify the denial returns. Neither policy change requires
editing the Mastra agent or redeploying it.

Restore the governed baseline before the eight checks below: remove the added event, retain
the adversarial variant for the privacy/integrity probes, and reset route history, grants,
and policy changes. The existing seed command only upserts fixture IDs; rerunning it alone
does not remove extra documents or reset the apps.

## Prove the controls

| Check | Evidence of success |
|---|---|
| 1. Grounded research | Dana's qualification cites at least two Elastic facts and their source records; the trace uses the same Mastra agent and Arcade gateway. |
| 2. Access | Sam cannot discover or call the routing tool. |
| 3. Approval | Dana's $95K route is denied; `request_approval` delivers Riley's request to the attendee's own Slack account; approval as Dana fails; the attendee switches to Riley and authenticates to approve; Dana's conversation resumes and retries identical arguments; exactly one route write exists. A changed owner cannot reuse that approval. |
| 4. Privacy | The model-facing tool results omit the synthetic personal phone from Elastic and every Lead result, including the successful route response. |
| 5. Integrity | The seeded injected instruction is absent from model-facing Elastic and Lead results. |
| 6. Authoritative ACV | A lowball argument cannot lower the server's authority check or rewrite the authoritative amount. |
| 7. Policy editing | An authenticated operator raises Dana's authority and changes the outcome without redeployment or agent edits; restoring it restores the denial. |
| 8. Audit | The panel correlates the evidence calls, denial, Slack delivery, authenticated decision, resumed request, single write, and applicable rules. |

Run `bun run capstone --run-id '<run-id>' --output .workshop/evidence --live`
to collect the existing run, safe audit, and matching business receipt. The command starts
no agent and sends no Slack message. It reports missing or unexercised checks explicitly;
credentials alone cannot certify the integration. The baseline reset and each probe must control prior
writes/grants so one check cannot accidentally authorize or invalidate the next.

Attendees on the shared read-only Elastic fallback watch the presenter introduce the
adversarial variant and change the account evidence on the presenter's own deployment. They
record the relevant checks as degraded and receive no independent Elastic mutation credit.
The fallback gateway may still demonstrate their Lead approval flow, but it cannot certify
their own Elastic privacy/integrity mutation exercise.

At the final reset, restore the clean eight-event Elastic fixture used for the first
connection checkpoint, remove added events, and clear exercise writes, grants, and policy
edits, including pending continuations. Then revoke the setup write key. Keep the read-only credential's expiration and
renewal instructions with your project so you can continue using it after the event.

Use `bun run reset --variant clean` for the final complete baseline reset. It clears the
exercise across hooks, native Mastra storage, Lead, IdP, and the dedicated Elastic index.
It preserves both OAuth clients and requires a new sign-in. A partial failure stops the
sequence and reports which owners already acknowledged their reset.
