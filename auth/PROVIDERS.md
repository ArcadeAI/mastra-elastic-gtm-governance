# auth/ — who signs in, and what to put in the Arcade dashboard

Three identities meet in this repo, and each has a provider. `bun run setup-arcade`
registers the first two by API; this page is the same information laid out for a
dashboard, for when you would rather see it, or when a project key cannot register
something and the run prints a form instead.

| Who | Provider | Where it is configured |
|---|---|---|
| The person using the agent (hop 1) | **User Source** on the gateway: the app's own sign-in | Arcade dashboard → MCP Gateways → the gateway's Authentication |
| The loan API, called by the deal tools (hop 2) | **Custom OAuth 2.0 provider** `app-identity`: the app's own identity provider in `auth/provider/` | Arcade dashboard → Auth Providers |
| Slack, for the approval DM and the channel post | **Arcade's built-in Slack provider** | Arcade dashboard → Auth Providers → Slack (nothing to create) |

Elasticsearch is not an identity: the 26 Elastic tools read two project secrets,
`ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY` (`elastic/README.md`). Google is not
used by this repo.

## 1. The User Source (hop 1)

The gateway authenticates its users through the app's own OpenID Connect sign-in, so
the email the agent acts as is the email the hooks govern. `setup-arcade` creates it
through the Coordinator once the app is reachable through the tunnel; this is the form.

| Field | Value |
|---|---|
| Name | Deals Approval Limits |
| Issuer URL | `https://<APP_PUBLIC_HOST>` |
| Client ID | the `arcade-user-source` client's id, `bun run oauth-client` prints it |
| Client Secret | the same client's secret; `bun run oauth-client --client arcade-user-source --rotate` mints one |
| Advanced → Scopes | `openid profile email` |
| Advanced → Subject Claim | `email` (not the default `sub`) |

Its callback, `https://cloud.arcade.dev/oauth2/intermediate_callback`, is already
allowlisted on the app's `arcade-user-source` client.

## 2. The custom provider for the loan API (hop 2)

The deal tools in `mcp/deal_desk/deals.py` declare `OAuth2(id="app-identity", scopes=["openid", "email"])`.
Arcade turns that into a sign-in at the app's identity provider the first time a
persona calls one, and from then on the tool carries that persona's token to the loan
API, which attributes the call to the email in it. The provider id is fixed in three
places that a test keeps equal: the tool, the provider, and `setup-arcade`.

| Field | Value |
|---|---|
| Provider ID | `app-identity` |
| Type | OAuth 2.0 |
| Client ID / Secret | the `arcade` client at the app's identity provider (`bun run oauth-client --client arcade`) |
| Authorization URL | `https://<APP_PUBLIC_HOST>/oauth2/authorize` |
| Token URL | `https://<APP_PUBLIC_HOST>/oauth2/token`, `POST`, client authentication HTTP Basic (`client_secret_basic`), form-encoded |
| PKCE | on, `S256` |
| Scopes | `openid email` |
| User info | `GET https://<APP_PUBLIC_HOST>/oauth2/userinfo` with the bearer; user id is `$.email` |
| Callback to allowlist on the `arcade` client | `https://cloud.arcade.dev/api/v1/oauth/<provider id Arcade assigns>/callback` |

`setup-arcade` sends exactly this body (`scripts/setup-arcade/arcade.ts`, `providerBody`)
and allowlists the callback Arcade answers with. A provider that already exists is
compared and left alone: DESIGN.md → "Arcade config is read-only".

## 3. Slack (built in)

`request_approval` declares `Slack(scopes=["chat:write", "im:write", "users:read", "users:read.email"])`.
Arcade's own Slack provider serves it; there is nothing to create. The token is the
requester's, so the DM to the approver and the channel announcement
(`SLACK_APPROVALS_CHANNEL`) both arrive under her name. Four scopes rather than three
because `users:read` is a prerequisite for `users:read.email`. Arcade routes this
built-in provider through its own user verifier, not the app's, so the requester must
be a member of the Arcade project (`docs/app-users-and-arcade-accounts.md`).

## Where the people are

The personas, their passwords, roles and clearances live in `idp.db` and
`governance.db`, both on your machine: `bun run users add <email> --name … --role … --clearance …`,
or `bun run users seed-demo` for the demo cast. Nothing about a person is stored at Arcade.
