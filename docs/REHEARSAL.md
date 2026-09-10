# Fresh-attendee rehearsal

Status: independent attendee rehearsal pending. An automated clean-checkout test does
not establish signup, billing, email verification, Slack membership or teaching time.

## Before the timed run

Record date, tester, OS, repo revision, starting account state, support person and whether
onsite or remote. The tester should not have built the workshop. Use separate workshop
resources, synthetic data and self-DM delivery. Do not share production keys.

Download-only preparation is optional. Count all partner signup, provisioning, model-key
configuration, deployment and consent inside the relevant 55-minute section.

## Timing sheet

| Section | Start/end | Minutes | Help and failure recovery | Evidence |
|---|---|---|---|---|
| Mastra | Pending | Target ≤55 | Record signup, installation, model access | Saved supplied response and instruction edit |
| Elastic | Pending | Target ≤55 | Record signup, provisioning, scoped keys | Eight seeded records, four Northwind IDs, native MCP read |
| Arcade | Pending | Target ≤55 | Record gateway, services, hooks, OAuth, Slack | Governed Elastic read, blocked discount, DM, approval, one draft and read-back |
| Capstone | Pending | Target ≤20 | Record rule edit, test, deploy and recovery | New output rule verified through gateway |

Record provisioning time separately from active work, but keep both in the elapsed total.
If a step exceeds budget, improve the tooling and repeat. Watching a presenter complete a
step does not count as an attendee-owned completion.

## Recovery checks

- Missing model credential produces a useful setup message.
- Elastic search uses the fixture's August 2026 window and returns actual source IDs.
- Elastic tools missing from the gateway lead to hook mapping diagnostics, not a direct bypass.
- Wrong-role or expired consent returns to a recoverable sign-in/authorization path.
- Pending consent does not display completion or save an offer.
- Dana cannot approve her own request; Riley sees and approves the exact original terms.
- Ambiguous Slack delivery is inspected before retry, with no automatic duplicate message.
- Repeated continuation saves no second offer. Read-back failure is visible.
- An unavailable hook prevents the governed action; restored service permits a fresh retry.
- Finish with the documented reset and verify the next attendee's starting state.

## Signoff

Record measured section times, manual interventions, supported OS, remaining blockers and
links to sanitized run evidence. Repeat once with a remote attendee before delivery.
Partner owners confirm speakers/TAs, model access, costs, Slack invite, venue and remote
support separately. Leave each unconfirmed item explicitly pending.
