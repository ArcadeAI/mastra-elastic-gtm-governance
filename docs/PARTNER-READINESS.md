# Partner readiness, September 9, 2026

This is the current status. Earlier verification documents are historical evidence for
the revisions they name. Partner review and hands-on delivery have separate gates.

## Confirmed in the live workshop project

- Elastic's native MCP server is healthy and connected to Arcade. The gateway exposes
  four selected read tools alongside Sales. A real search returned all four Northwind
  events from gtm-account-context using the explicit August-to-November 2026 window.
- Missing Elastic hook configuration caused the earlier empty gateway inventory.
  Configuring the observed toolkit, names and argument requirements fixed discovery.
- Dana and the operator verification identity both completed delegated Sales OAuth.
  Token and refresh requests had incorrectly combined Basic and body client credentials;
  the provider now uses the body method expected by the demo IdP, with PKCE enabled.
- Live GetAccount filtering and a 30% authority denial passed the operator verification
  command. The policy was activated and all eight governed fixture records were read back.

## Implementation and remaining proof

The runtime uses Arcade for all Elastic retrieval. The direct runtime fallback is removed.
The verifier now checks authorization status before showing completion and preserves its
callback through sign-in. Elastic document JSON is inspected separately from unsupported
MCP embedded media. The fixes are deployed: web revision `5e08371`, hooks revision `e37bf5b`.
Both completed authorization status pages returned HTTP 200 for their matching identities.

| Gate | Status |
|---|---|
| Real Elastic search through Arcade | Passed: four Northwind events returned |
| Sales authorization and preflight | Passed for Dana and the setup identity |
| Live Elastic marker redaction | Passed: native document read removed all three markers and retained CS-1042 |
| Same Mastra agent completes live approval and read-back | Passed: all four sources, original action, one $8,400 draft and GetOffer |
| Self-DM receipt, rejected self-approval and replay | Passed: one self-DM acknowledgement, Dana HTTP 403, Riley approval, unchanged receipt/audit on replay |
| Attendee hook-lab proof | Passed: starter fails, edited rule passes, applied and verified through remote gateway |
| Clean-checkout automated rehearsal | Passed: frozen installs and 15 auth/output tests; independent human timing remains pending |
| Timed independent attendee and remote rehearsal | Pending; worksheet prepared |
| Speakers/TAs, model access, costs, Slack invite and remote support | Partner confirmation pending |

## Evidence and limits

The local suite passed **205 tests**, typechecking and the web production build. A clean
temporary checkout passed frozen root/IdP installs and 15 auth/output tests. The final
connection-ID correction passed all 11 auth tests, and GitHub CI passed both code revisions.

- [Native Elastic document filtering](evidence/elastic-gateway.json)
- [Completed renewal and bound receipt](evidence/live-renewal/manifest.json)
- [Authenticated decisions, model identity and replay](evidence/live-regression.json)
- [Attendee-authored output hook](evidence/hook-lab.json)

Run `596c81c7-c476-480c-8fb2-e164bafa7550` used the configured Claude Sonnet 4.6 provider,
real native Elastic tools through Arcade, and seeded Dana/Riley identities. Slack returned
a self-DM delivery acknowledgement. We did not separately query Slack history; the CLI
therefore retains `live_proof: false` for its narrower recorded-service evidence scope.
No customer email or public-channel message was sent. The completed draft and lab rule
remain available for inspection; this test did not reset them.

Presenter note: the generated final narrative described the discount as flagged for review
even though authenticated approval and the completed write were recorded. Use the approval
panel and receipt as the authority for approval state, not the model's prose. The structured
checks confirm the exact approved message and commercial terms.

## Partner packet

Use [Partner brief](PARTNER-BRIEF.md), [draft review note](PARTNER-REVIEW-NOTE.md),
[agenda](WORKSHOP-PLAN.md), [arrival guide](ARRIVAL.md) and [rehearsal worksheet](REHEARSAL.md).
The review note is unsent. Do not describe the workshop as fully rehearsed until the
independent attendee run passes each 55-minute section and the 20-minute capstone.
