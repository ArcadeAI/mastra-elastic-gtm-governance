# Workshop web

Run `bun run dev:web` from the repository root for the first two stages. The same Mastra
agent grows through three capabilities:

1. **Build your agent:** assess the supplied request for Northwind's 30% renewal discount
   and identify missing evidence. Only a model credential is required.
2. **Connect evidence:** retrieve declining usage, open SCIM support, renewal and budget context through
   the Arcade gateway. Cite source IDs and retain uncertainty. This stage has no writes.
3. **Act with approval:** Dana prepares a 30% offer on a $12,000 annual list price. Arcade
   blocks it against Dana's 15% permission. The app requests Riley's review in a self-DM;
   Riley's 40% authority permits approval. Dana's exact run resumes, saves one $8,400 draft
   offer, and is instructed to call `GetOffer` to verify its terms and inspect the redacted email draft.

The agent supplies the required `customer_message`, grounded in cited evidence and explicit
about uncertainty. Riley reviews the exact message with the discount. The API chooses the
recipient and appends canonical terms and a draft label to `follow_up_email`.
The offer and follow-up email stay in the workshop account system as drafts. No customer
email, real provisioning or external signature request occurs. The governed Run can send
the Slack self-DM before anyone selects Approve. If consent is pending, complete it as Dana,
then use **Retry Slack notification** for the saved request. Delivery must be confirmed
before the assigned Riley identity can decide.

## Setup and identity

Use [Operator setup](../../docs/OPERATOR.md). Commit local agent edits before deployment,
then open the hosted `WEB_PUBLIC_ORIGIN` for the governed flow. OAuth state cookies and CSRF
bind that origin; a localhost session cannot complete a callback on the hosted app.

Configure the gateway, selected Elastic names, `ARCADE_DISCOUNT_TOOL_NAME`,
`ARCADE_GET_OFFER_TOOL_NAME`, hooks credentials and persistent `MASTRA_DB_URL`. Sales is the
only custom toolkit, deployed from `tools/lead`. Completion requires GetOffer after the
write with matching saved terms and draft status; otherwise show that the offer was saved
but verification failed. Two selected Sales tool names do not require two deployments.
The host approval client uses `ARCADE_API_KEY` for delegated Slack authorization and
`APPROVALS_SERVICE_TOKEN` for hooks. Slack tokens remain on the server.

The web OAuth client is separate from Arcade's client. IdP's
`WORKSHOP_WEB_REDIRECT_URI` is the web origin plus `/auth/callback`; obtain its stable
credentials from the persistent IdP with `bun run oauth-client --web --json`.
`WEB_SESSION_SECRET` must contain at least 32 characters. State, PKCE, issuer and expected
identity are checked before setting an encrypted HttpOnly session cookie. The IdP token
is encrypted inside that cookie; frontend JSON never exposes its plaintext. Mutations
require the session CSRF token and matching Origin.

`WORKSHOP_DEMO_MODE=true` enables seeded role switching. Dana's configured email is the
attendee's real Arcade account; Riley, Sam and Morgan remain distinct OAuth identities.
The approval link grants no authority. Riley's decision sends the signed-in IdP token to
hooks for independent validation; the resumed action still runs through Arcade as Dana.
The custom Arcade verifier is `WEB_PUBLIC_ORIGIN/auth/arcade/verify`. Stock Slack keeps
Arcade's normal project-member verification. The verifier checks the returned authorization
ID through `/v1/auth/status`; identity confirmation alone never displays completion.
`/auth/arcade/status` checks status without repeating confirmation, and rejects a
status response belonging to another signed-in identity.

The setup identity signs in at `/auth/login?persona=verification` with
`WORKSHOP_VERIFICATION_USER_ID` and `verification-demo-2026`. It is absent from the normal
role picker and cannot run the governed agent. Use it for the filtered GetAccount and
empty-rationale denied-offer probe, then activate normal roles through the CLI.

## Persistence and testing

Hooks owns the run/request/action binding; native Mastra LibSQL owns snapshots. A waiting
run survives role switching and web restart. One web worker is supported. Stop an expired
worker before operator lease recovery; do not create an overlapping writer.

**Start a new exercise** closes eligible failed/denied/expired or undelivered waits and
removes their native snapshots. It cannot close an active resume. Operator reset coordinates
hooks, web storage, the account service, IdP and Elastic; both OAuth clients are preserved.

Use [Testing](../../docs/TESTING.md) for installation and `bun run test:workshop`. Current
acceptance checks must establish discount enforcement, exact continuation, one draft offer,
GetOffer read-back, pasted-key/phone redaction and replay. The capstone uses `hook-lab` to
remove `support.internal_owner_email` and verify the effect through the gateway. Local controlled collaborators
prove application behavior separately from live cloud consent and workshop timing.
