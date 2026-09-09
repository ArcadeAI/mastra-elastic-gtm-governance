# Workshop web

Run `bun run --cwd apps/web dev` from the repository root and open
`http://localhost:3000`. The three sections use the same Mastra lead agent:

1. **Build your agent:** ask “What evidence supports qualifying Northwind, and what
   is missing?” This uses the supplied practice input and needs only a model key.
2. **Connect evidence:** ask the same question with Elastic source citations. This
   adds the configured Arcade gateway, observed Elastic tool names, and Dana's
   real Arcade email. It does not require the workshop IdP or hooks.
3. **Act with approval:** sign in as Dana, research LD-2291, and request a route.
   Arcade denies the action above Dana's authority. The approval tool sends a
   Slack self-DM naming Dana and Riley. Sign in as Riley to approve or deny the
   exact displayed action. Approval resumes the original Dana run automatically;
   the separate resume button retries the continuation if necessary.

The pending run survives role switching and a web restart. “Start a new exercise”
closes a failed or denied wait before deleting its native snapshot. A running
resume cannot be closed. Policy and audit controls in this UI are read-only;
operator policy edits use the hooks operator API or workshop CLI.

## Configuration and identity

The root `.env.example` documents every setting. Set `WORKSHOP_DEMO_MODE=true`
explicitly to enable the supplied demo-role sign-in. Dana's configured email is
the attendee's real Arcade account; Riley, Sam, and Morgan are separate demo
identities. These are independent OAuth principals even when one attendee signs
in to all four. The Slack recipient does not acquire approval authority.

The web OAuth client is separate from Arcade's client. Configure the IdP's
`WORKSHOP_WEB_REDIRECT_URI` as `WEB_PUBLIC_ORIGIN/auth/callback`, then obtain the
stable credentials with `bun run --cwd apps/idp oauth-client --web --json` and put
them in the server's `WEB_OAUTH_CLIENT_ID` and `WEB_OAUTH_CLIENT_SECRET`.
`WEB_SESSION_SECRET` must contain at least 32 characters. Role changes require a
fresh IdP login; state, PKCE, issuer and expected identity are checked before an
encrypted HttpOnly session is created. The browser never receives access tokens.
Mutation routes require that session's CSRF token and matching Origin.

Configure the custom Arcade verifier as
`WEB_PUBLIC_ORIGIN/auth/arcade/verify`. It confirms the authenticated session's
identity, never a user ID supplied in a URL. Stock Slack authorization retains
Arcade's project-member verifier. Consent URLs returned by tools are shown as
attendee actions. They do not count as successful decisions or writes.

`MASTRA_DB_URL` must be a persistent file URL for the governed stage. Hooks owns
the run/request/action binding; LibSQL stores native Mastra snapshots. One web
worker is supported. A lost resume lease requires stopping that worker before
operator recovery; there is no automatic overlapping recovery.

## Owned reset endpoints

All reset endpoints require `Authorization: Bearer WORKSHOP_OPERATOR_TOKEN`.
This credential is server/operator-only and is never a model tool argument.

1. Reset hooks with `POST /operator/reset`, which rejects executing workers and
   returns `reset_epoch`.
2. Call web `POST /api/operator/reset` with JSON `{ "reset_epoch": <returned epoch> }`.
   It verifies hooks is inactive with no active runs and the same reset epoch,
   rejects active local work, and deletes only `agentic-loop` snapshots through
   Mastra's storage API. The result reports `deleted_snapshots`.
3. IdP `POST /internal/reset` reseeds identities and invalidates sessions/tokens
   while preserving both OAuth clients and secrets.

The repository's reset CLI also coordinates the separate Lead and Elastic owners.
Deleting a database file is not the supported recovery path.

## Local proof

`bun test apps/web/test` exercises the actual agent and MCP transports. The
connected test uses real hooks, Lead SQLite, IdP login/consent/token flows, and
the registered Python Lead/Approvals MCP servers. Only external model, Arcade,
Elastic and Slack boundaries are controlled on loopback addresses. It proves
filtered tool results reach the model, an approval waits in native file LibSQL,
a replacement web process resumes as Dana after Riley's real OAuth decision,
one business write is recorded, replay sends no extra notification/write, and
a denied wait can close and release a new exercise. Reset preserves both clients.

The smaller runtime test isolates native persistence; the authentication tests
cover forged identity/state, CSRF, and the Arcade verifier. Typecheck with
`bun run --cwd apps/web typecheck`; build with `bun run --cwd apps/web build`.
These local proofs do not establish live cloud connectivity, live Slack delivery,
model quality, or a measured workshop rehearsal. Capstone metadata distinguishes
an injected test model from a configured provider response.
