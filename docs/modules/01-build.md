# Module 1 — Build the agent (Mastra)

[Setup](./00-setup.md) · **Module 1 · Build** · [Module 2 · Govern](./02-govern.md) · [Module 3 · Ground](./03-ground.md) · [Capstone](./04-capstone.md) · [Presenters](./PRESENTERS.md) · [Agent prompt](./AGENT-PROMPT.md)

**Start from:** `git checkout start`. **Owner:** Mastra. **45 minutes.**

You leave this module with a Mastra agent running on your laptop, connected over MCP to
an Arcade gateway that carries the deal desk's six tools, having made one real tool call
and watched it in Mastra Studio.

## Before the workshop

[`00-setup.md`](./00-setup.md): the tools, the four accounts on one email, the repo, the six
`.env` lines, and `bun run workshop`. Done before you arrive.

**Before the first command, check five things:** `arcade whoami` shows your project; `ngrok config check`
passes and you know your static domain; you can open the Slack workspace; `bun --version` prints;
the repo is cloned and `bun install` has run. Anyone missing one of these loses the first twenty
minutes, so this is the host's first question to the room.

## The short way

Copy `.env.example` to `.env` and fill six lines: `ANTHROPIC_API_KEY`, `ARCADE_API_KEY`,
`APP_PUBLIC_HOST`, `SLACK_APPROVALS_CHANNEL`, `WORKSHOP_EMAIL` (you), `WORKSHOP_APPROVER` (the
address the host announces). Then:

    bun run workshop

It starts the app and the tunnel, registers everything with Arcade in one `arcade deploy`,
seeds the cast, and leaves the app running. About four minutes the first time, under a
minute after. Open the URL it prints, sign in as yourself with the password `password` (every
persona's, on your laptop only), authorize the gateway once. Behind
at any point in the day: run it again, then `bun run reset`.

The steps below are what it does, one at a time, for anyone who wants to see each piece.

Working with a coding agent? [`AGENT-PROMPT.md`](./AGENT-PROMPT.md) is a prompt to paste in that
walks you through all three modules.

## What you build

1. Install and configure: the README's Quickstart steps 1 to 3. Three values in `.env`:
   `ANTHROPIC_API_KEY`, `ARCADE_API_KEY`, `APP_PUBLIC_HOST`. A fourth for the room:
   `SLACK_APPROVALS_CHANNEL=C0C83CW2CDN`, the workspace's `#deal-desk-approvals`, so every approval
   request you raise in module 2 is posted where everyone sees it. A fifth, because every
   "Behind?" below leans on `bun run reset`: uncomment `RESET_TOKEN=` and give it any value
   (`bun run workshop` writes one for you; by hand, you do).
2. Start the app and the tunnel, in a terminal you leave open: `bun run up`. It serves the app
   on port 3000 and ngrok on your `APP_PUBLIC_HOST`; Ctrl-C stops both. Arcade reaches the
   hooks through that tunnel, so this comes before the registration.
3. Register with Arcade: `bun run setup-arcade <APP_PUBLIC_HOST>`. It runs one `arcade deploy`
   (`mcp`: the Deals, Approvals and Elasticsearch tools together), mints the OAuth clients, registers the identity provider and the hooks, and
   creates the gateway. Read what it prints; every name it reports is a name a rule is
   keyed on later.

   **Behind?** Run it again. It checks every registration and fills in only what is missing,
   and it never creates a second gateway or rotates a client it did not mint.
4. Add yourself: `bun run users add <your-email> --name Alice --role account_executive --clearance 50000 --password password`.
   The same password as every other persona in the room; without `--password` the command
   prints a random one once, and a room loses those.

   **Behind?** `bun run users list` shows who exists; `users add` refuses a duplicate and changes
   nothing, so it is safe to run twice.
5. Open the app through the tunnel, sign in as Alice, authorize the gateway, and ask:
   > Which discount requests are pending?

   The agent calls `DealDesk_SearchDeals` and lists the five pending requests (eight are on file; three already carry a decision).

   **Behind?** If the chat says the gateway advertised no `DealDesk` tools, the hooks are
   denying everything or the gateway is stale: `bun run setup-arcade <APP_PUBLIC_HOST>` again,
   then `bun run reset`, then restart `bun run up`.
6. Open Studio: `bun run studio`, sign in as Alice at `localhost:4111/arcade/authorize`, then
   open `localhost:4111`, select the **deal-desk** agent and send the same prompt. Same agent,
   same gateway, every step visible. This step is the module's checkpoint, not an extra.

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

Nothing in this module changes the code. `git fetch --tags --force && git checkout start` is
the whole state (the tag moves when the hosts ship a fix); the work
is the Arcade registration, and `bun run setup-arcade` is idempotent, so run it again.

## Handoff

To Arcade, when every laptop has made the one tool call and seen it in Studio. The Slack
invite should be accepted by now; module 2 needs it at act 2.

---

**Next:** [Module 2 · Govern](./02-govern.md)
