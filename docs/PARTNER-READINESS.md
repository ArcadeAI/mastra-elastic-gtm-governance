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
MCP embedded media. Deployment and live regression results will be recorded below.

| Gate | Status |
|---|---|
| Real Elastic search through Arcade | Passed: four Northwind events returned |
| Sales authorization and preflight | Passed for Dana and the setup identity |
| Live Elastic marker redaction | Pending deployment of the document-envelope fix |
| Same Mastra agent completes live approval and read-back | Pending |
| Self-DM receipt, rejected self-approval and replay | Pending |
| Attendee hook-lab proof | Pending live run |
| Clean-checkout automated rehearsal | Pending |
| Timed independent attendee and remote rehearsal | Pending; worksheet prepared |
| Speakers/TAs, model access, costs, Slack invite and remote support | Partner confirmation pending |

## Partner packet

Use [Partner brief](PARTNER-BRIEF.md), [draft review note](PARTNER-REVIEW-NOTE.md),
[agenda](WORKSHOP-PLAN.md), [arrival guide](ARRIVAL.md) and [rehearsal worksheet](REHEARSAL.md).
The review note is unsent. Do not describe the workshop as fully rehearsed until the
independent attendee run passes each 55-minute section and the 20-minute capstone.
