# Module 1 — Build the agent (Mastra)

**Start from:** `git checkout start`. **Owner:** Mastra. **45 minutes.**

You leave this module with a Mastra agent running on your laptop, connected over MCP to
an Arcade gateway that carries the deal desk's six tools, having made one real tool call
and watched it in Mastra Studio.

## Before the workshop

Four things, each one signup, all with the **same email**:

- An [Arcade](https://api.arcade.dev/dashboard) account and one project in it, with an API key. The project is yours; everything the
  workshop registers lands there.
- The Slack invite the host sent, to the workshop workspace. Accept it with the same email. The escalation in
  module 2 is sent from your own Slack account, so you have to be in the workspace.
- An [ngrok](https://ngrok.com) account and its free static domain. Arcade reaches your laptop through it.
- An [Elastic Serverless](https://ela.st/arcade) account, for module 3.

The Anthropic key is the host's, shared in the room.

## What you build

1. Install and configure: the README's Quickstart steps 1 to 3. Three values in `.env`:
   `ANTHROPIC_API_KEY`, `ARCADE_API_KEY`, `APP_PUBLIC_HOST`. A fourth for the room:
   `SLACK_APPROVALS_CHANNEL=C0C83CW2CDN`, the workspace's `#deal-desk-approvals`, so every approval
   request you raise in module 2 is posted where everyone sees it.
2. Register with Arcade: `bun run setup-arcade <APP_PUBLIC_HOST>`. It runs one `arcade deploy`
   (`mcp`: the Deals, Approvals and Elasticsearch tools together), mints the OAuth clients, registers the identity provider and the hooks, and
   creates the gateway. Read what it prints; every name it reports is a name a rule is
   keyed on later.
3. Add yourself: `bun run users add <your-email> --name Alice --role account_executive --clearance 50000`.
4. Open the app through the tunnel, sign in as Alice, authorize the gateway, and ask:
   > Which discount requests are pending?

   The agent calls `DealDesk_SearchDeals` and lists the eight requests.
5. Open Studio: `bun run studio`, sign in at `localhost:4111/arcade/authorize`, and send the
   same prompt. Same agent, same gateway, every step visible.

## What to look at

- `lib/agent/agent.ts`: the agent is a model plus instructions plus a tools map. The
  instructions carry no behaviour; read the header to see why.
- `lib/agent/tools.ts`: `MCPClient` against `https://api.arcade.dev/mcp/{gateway}` with this
  browser's own bearer, and `selectGoverned`, the allow-list on the two toolkit prefixes.
- `lib/agent/run.ts`: one `for await` over `fullStream`. Every event the UI shows comes from
  this loop.

## Checkpoint

You can name the six tools on the wire (`DealDesk_SearchDeals`, `DealDesk_GetDeal`,
`DealDesk_ApproveDiscount`, `DealDesk_DenyDiscount`, `DealDesk_RequestApproval`,
`DealDesk_Decide`) and you have seen one of them called from both the app and Studio.

## If you are behind

Nothing in this module changes the code. `git checkout start` is the whole state; the work
is the Arcade registration, and `bun run setup-arcade` is idempotent, so run it again.
