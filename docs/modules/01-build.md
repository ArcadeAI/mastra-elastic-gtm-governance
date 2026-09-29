# Module 1 — Build the agent (Mastra)

**Start from:** `git checkout start`. **Owner:** Mastra. **45 minutes.**

You leave this module with a Mastra agent running on your laptop, connected over MCP to
an Arcade gateway that carries the deal desk's six tools, having made one real tool call
and watched it in Mastra Studio.

## What you build

1. Install and configure: the README's Quickstart steps 1 to 3. Three values in `.env`:
   `ANTHROPIC_API_KEY`, `ARCADE_API_KEY`, `APP_PUBLIC_HOST`.
2. Register with Arcade: `bun run setup-arcade <APP_PUBLIC_HOST>`. It deploys the two
   toolkits, mints the OAuth clients, registers the identity provider and the hooks, and
   creates the gateway. Read what it prints; every name it reports is a name a rule is
   keyed on later.
3. Add yourself: `bun run users add <your-email> --name Alice --role account_executive --clearance 50000`.
4. Open the app through the tunnel, sign in as Alice, authorize the gateway, and ask:
   > Which discount requests are pending?

   The agent calls `Deals_SearchDeals` and lists the eight requests.
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

You can name the six tools on the wire (`Deals_SearchDeals`, `Deals_GetDeal`,
`Deals_ApproveDiscount`, `Deals_DenyDiscount`, `Approvals_RequestApproval`,
`Approvals_Decide`) and you have seen one of them called from both the app and Studio.

## If you are behind

Nothing in this module changes the code. `git checkout start` is the whole state; the work
is the Arcade registration, and `bun run setup-arcade` is idempotent, so run it again.
