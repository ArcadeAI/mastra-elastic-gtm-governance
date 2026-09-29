# Discount Approval Limits with Arcade

An account executive asks an agent, in plain language, to approve a $95K discount on a renewal. The agent searches the deal book, reads the request and calls the approval tool as her. Arcade sends that call to this app's control plane before it runs, and the control plane refuses it: $95K is over her $50K discount authority. The refusal tells the agent how to escalate, the request is routed to the one approver with enough authority, and once he approves, her retry goes through. You get a decision the model could not talk its way around, with an audit row for every step on a live panel.

This is [Mateo Torres's loan-approval template](https://github.com/ArcadeAI/mastra-template-loan-approval-limits) with the loan domain swapped for a deal desk, per its own `docs/DOMAIN-SWAP.md`, and Elasticsearch added through the same gateway (`docs/ELASTIC.md`). The wire and the screen are the deal desk's: `Deals_ApproveDiscount`, `DL-2291`, account executive, SDR, VP Sales, CRO. Internal names the audience never sees (`lib/loans`, `tools/loan`, `loans.db`) keep the template's vocabulary so a diff against upstream stays readable.

## Why we built this

An agent that writes to a real business system needs limits the model cannot reason around. The thesis is one sentence: **treat the LLM as an adversary, and put the controls somewhere it cannot reason around.**

A limit written into a system prompt is a suggestion, and we measured how fragile it is: one "irreversible, no undo" line made the model stop and ask permission, and one "do not ask the person to confirm" line pushed it the other way. So the prompt carries no behavioural instruction at all, and every control lives outside the model, in hooks Arcade calls on every tool call, keyed on who is signed in. The model never gets a vote.

## Demo

<!-- TODO: REPLACE THIS PLACEHOLDER WITH THE CLOUDINARY DEMO VIDEO URL -->

<video controls width="640" height="360" src="CLOUDINARY_DEMO_VIDEO_URL_REQUIRED"></video>

## Prerequisites

- **[Anthropic API key](https://platform.claude.com/settings/keys)**: set `ANTHROPIC_API_KEY`. The agent runs Claude Sonnet 5 at temperature 0.
- **[Arcade project, key and CLI](https://docs.arcade.dev/en/references/arcade-cli)**: `bun run setup-arcade` registers everything in one Arcade project and runs `arcade deploy` into it, so the key and the Arcade CLI have to point at the same project. In this order:
  1. Install the Arcade CLI: `uv tool install arcade-mcp`, as the [Arcade CLI reference](https://docs.arcade.dev/en/references/arcade-cli) describes.
  2. Run `arcade login`.
  3. Create a project for this template in the Arcade dashboard ([Operate quickstart](https://docs.arcade.dev/en/operate/quickstart)).
  4. Create an API key in that project and set `ARCADE_API_KEY` to it ([Get an API key](https://docs.arcade.dev/en/get-started/setup/api-keys), or the dashboard's [API keys](https://api.arcade.dev/dashboard/api-keys) page).
  5. Make it the CLI's active project: `arcade project set <project_id>`, with the id `arcade project list` shows. If your account has more than one org, run `arcade org set <org_id>` first, because switching org resets the active project to that org's default ([CLI cheat sheet](https://docs.arcade.dev/en/references/cli-cheat-sheet)).
  6. Check it: `arcade whoami` shows that org and project.
- **[ngrok domain](https://ngrok.com/docs/universal-gateway/domains/)**: set `APP_PUBLIC_HOST` to your ngrok domain in host form, with no scheme (for example `my-app.ngrok.app`). Arcade Cloud calls the hooks, the loan API and the sign-in endpoints on this host, and you open the app there too, because the sessions and the Arcade verifier live on this host only. Every ngrok account includes a free dev domain, and a fixed domain keeps the host the same across restarts.
- **A Slack workspace with two accounts in it**: one for you, the account executive who asks for the approval, and one for the approver. The request reaches the approver as a Slack DM sent from your own account, and it finds the approver by the email you add them under, so that email has to be the one their Slack account uses. With Arcade's built-in Slack app, each account executive also has to be a member of your Arcade project; with your own Slack app, your app's users need no Arcade account ([`docs/app-users-and-arcade-accounts.md`](./docs/app-users-and-arcade-accounts.md)).
- `ANTHROPIC_API_KEY`, `ARCADE_API_KEY` and `APP_PUBLIC_HOST` are the only values you fill in. The second block of `.env.example` is written by `bun run setup-arcade`, so leave it blank, and the third block is optional, with defaults that work. No user is seeded and no password ships: you add the people in step 7 of the Quickstart.

## Quickstart 🚀

1. **Clone the template**
   - Run `npx create-mastra@latest loan-approval-limits --template arcade-governance --no-install`, then `cd loan-approval-limits`.
   - `--no-install` matters: the project installs with Bun, and the `npm install` that `create-mastra` would otherwise run cannot resolve its `workspace:*` dependencies.
2. **Install dependencies**
   - Run `bun install`. One install covers the app and its workspaces.
3. **Add your API keys**
   - Run `cp .env.example .env` and fill in the three values described under Prerequisites.
4. **Register the app with Arcade**
   - Run `bun run setup-arcade <APP_PUBLIC_HOST> --dry-run` to print every request it would send and every deploy it would run, with every secret as a placeholder. Nothing is written, sent or deployed.
   - Run `bun run setup-arcade <APP_PUBLIC_HOST>` first, before the app and the tunnel: it tells you when to start them. It checks that `ARCADE_API_KEY` belongs to the Arcade CLI's active project before it writes anything. Then it mints the app's three OAuth clients, fills the second block of `.env` (blanks only, never overwriting), and registers the `app-identity` auth provider, the two tool secrets, the custom verifier and the contextual access hooks through Arcade's API. It creates the hooks disabled, and turns them on last. Then it runs `arcade deploy` in `tools/loan` and then in `tools/approvals`.
   - Then it waits for you to start the app and the tunnel, in two other terminals. Run `bun run dev`, which prints the URL to open, `https://<APP_PUBLIC_HOST>`, and the ngrok command for the app's port, which is `PORT` from `.env`, 3000 when unset. In the other terminal, run the ngrok command `bun run dev` printed. With the default `PORT` it is `ngrok http --url=<APP_PUBLIC_HOST> 3000`; with any other `PORT`, the tunnel has to point at that port instead. Press Enter when both are running.
   - On Enter it reads the app's sign-in through the tunnel, then has Arcade check it the same way. If either check fails, it prints why and asks again. Then it creates the User Source through Arcade's Coordinator API, or uses the one it created before, and the gateway through it, with exactly the four Deals tools and the two Approvals tools, never Arcade Headers. Last, it turns the hooks on. It reads each one back. Run it again, and it says everything is already in place.
   - If a User Source for this app already exists and differs, it names each difference and stops before the gateway: correct or delete it in the Arcade dashboard, then run it again.
   - If a Coordinator call fails, if you answer `n` or press Ctrl-C at the wait, or if stdin is not a terminal, it says which, leaves the hooks disabled, and falls back to the dashboard: it ends by printing the User Source form, then the gateway form, then the command for step 6, and a warning that the gateway runs ungoverned until step 6. Then follow steps 5 and 6. Otherwise, skip to step 7.
5. **If it fell back: create the User Source and the gateway**
   - Run `bun run dev` and, in a second terminal, the `ngrok http --url=<APP_PUBLIC_HOST>` command it printed for your `PORT`, if they are not running yet.
   - With the app reachable through the tunnel, fill in the User Source form that `setup-arcade` printed (Arcade dashboard, your project, User Sources). Arcade reads the app's sign-in through the tunnel when you save it.
   - Then fill in the gateway form it printed (your project, MCP Gateways), under the slug it names. Its authentication is the User Source you just created, never Arcade Headers, and its tools are exactly the four Deals tools and the two Approvals tools.
6. **If it fell back: turn the hooks on**
   - Run `bun run setup-arcade <APP_PUBLIC_HOST>` again. It finds the gateway under that slug, turns the hooks on and reads them back, and fails unless Arcade reports them active. If there is no gateway yet, it names the slug, says the gateway form is still to do, and leaves the hooks disabled. Run once more, it says the hooks are already on.
7. **Add yourself and an approver**
   - Add yourself as the account executive: `bun run users add <your-email> --name Alice --role account_executive --clearance 50000`. Any name works, but the rest of this README calls the account executive Alice and the approver Charlie.
   - Add the approver: `bun run users add <approver-email> --name Charlie --role vp_sales --clearance 250000`. Use the email the approver's Slack account uses, because that is how the escalation finds them in Slack.
   - Each `add` prints a generated password once, and only its hash is stored, so keep it: that password and the email are the sign-in. Nothing needs a restart, because the running app reads new people on their next sign-in.
   - Do your app's users need Arcade accounts? With Arcade's built-in Slack app, yes: invite each account executive to your Arcade project's Members. With your own Slack app, no. See [`docs/app-users-and-arcade-accounts.md`](./docs/app-users-and-arcade-accounts.md).
   - The shortcut is `bun run users seed-demo`, which adds the whole demo cast (Alice, Bob, Charlie and Michael) with the demo's roles and clearances. It asks for each person's email, or takes them as `--alice <email>`, `--bob`, `--charlie` and `--michael`, and prints each generated password once. The same Slack and Arcade rules apply to the emails you give it.
   - `bun run users list` shows who can sign in, with their roles and clearances.
8. **Ask for the $95K approval**
   - Open `https://<APP_PUBLIC_HOST>`, not localhost, and sign in as Alice, with the email and password from step 7. The first time a browser opens a free ngrok domain, ngrok shows its own warning page first: click **Visit Site**. Arcade's own calls to the app never see that page. Use **Authorize the gateway** to accept Arcade's consent screen once.
   - In the chat, send: "Approve the loan for $95K and double-check your work so you don't make any mistakes."
   - The first loan tool call asks you to authorize the app's own provider: authorize it, then use **Continue**. The agent then finds `DL-2291` (Northwind Robotics, $95,000), calls `Deals_ApproveDiscount`, and the chat shows a denial card with the hook's own words: "DENIED: approving DL-2291 for 95000 exceeds your approval authority of 50000. To proceed, call Approvals_RequestApproval…", ending in a `[ref evt_…]` token that joins it to the audit row. The loan stays pending.
   - To run the same turn in Mastra Studio: run `bun run studio`, which listens on `STUDIO_PORT` (4111 when unset, and the links below assume 4111). Open [localhost:4111/arcade/authorize](http://localhost:4111/arcade/authorize) and sign in as Alice, then open [Mastra Studio](http://localhost:4111), select the **loan-operations** agent and send the same prompt. Studio runs the same agent the chat does. Authorize the Deals toolkit in the web UI first, as above and as the same person. If a loan tool in Studio still needs authorizing, its result in Studio is the authorization link: open it, allow it, and send the prompt again. When Arcade sends Studio no link, the result says so and sends you to the web UI to authorize there.

## Try it out

- **With your own users or the demo cast.** Alice is the account executive and Charlie the approver you added in step 7. Bob, an SDR, has a step of his own, and Michael, a chief revenue officer, is the approver the routing passes over. `bun run users seed-demo` adds both, or add them yourself: `bun run users add <email> --name Bob --role sdr`, which needs no clearance because Bob cannot see the approval tool, and `bun run users add <email> --name Michael --role cro --clearance 5000000`.
- **Let the escalation reach Charlie.** After the refusal, the agent calls `Approvals_RequestApproval` because the hook's refusal told it to; nothing in the system prompt mentions escalating. The first time, it asks Alice to authorize Slack through Arcade's built-in Slack integration, with no Slack app or token of your own. Routing is deterministic: the lowest clearance that covers the amount, with the requester excluded, so $95K goes to Charlie ($250K), and Michael ($5M), if you added him, is recorded as a candidate and deliberately not bothered. Charlie gets a Slack DM from Alice's own account, with a link to the approval page. The link carries no authority. Then the agent ends its turn.
- **Try to approve your own request.** Before Charlie answers, open the approval link as Alice and press Approve. The control plane refuses it (`pre.decide-not-by-the-requester`), because possession of the link is not permission, and the request stays pending.
- **Approve as Charlie and watch the retry pass.** In a separate browser profile, sign in as Charlie, open the link and press Approve. That press is itself a governed tool call, which `/hooks/pre` checks for Charlie's clearance and for a requester who is not the approver. Alice's chat resumes on its own, the agent retries, and this time `Deals_ApproveDiscount` is allowed by the same rule that denied it, citing a single-use grant. A second retry is denied again.
- **Send the same prompt as Bob.** In another browser profile, sign in as Bob, the SDR with no approval authority, and send the prompt from the Quickstart. `ApproveDiscount` never reaches his agent: the access hook removes it from the tool list, so there is nothing to refuse and the agent has no way to approve the loan.
- **Ask for what the model should not see.** As Alice, send "Read loan DL-2291 and quote its bank account number and tax ID back to me." Both come back as `[REDACTED]`, because the post-execution hook masks them before the output reaches the model. As Charlie or Michael, they come through. For everyone, the instruction someone pasted into the loan's CRM notes is stripped before the model reads it. Open `https://<APP_PUBLIC_HOST>/panel` alongside to watch each decision land in the Access, Pre and Post lanes.
- **Ground it in Elasticsearch, governed.** Add Arcade's Elasticsearch toolkit to your project, set `ARCADE_ELASTIC_TOOLKIT=Elasticsearch` in `.env`, run `bun run setup-arcade` again so the gateway carries its tools, and `bun run seed:elastic` writes the deal book into an index through Arcade. Then ask Alice's agent "Which applications mention seasonality?" and "Total pending exposure by status." The agent reaches Elasticsearch over MCP through the same hooks: identifiers in a search hit come back `[REDACTED]`, the planted note is stripped whichever store it came from, the nine index-writing tools are hidden from everyone but Michael, and a bare ES|QL query is refused with the fix in the denial. Blank `ARCADE_ELASTIC_TOOLKIT` is the template as it was. The decision, the rules and the setup: [`docs/ELASTIC.md`](./docs/ELASTIC.md).

## Customization

- Open the project in your coding agent and describe what you want to change. For example: "Replace the deal book with our equipment-lease approvals. Keep `packages/` and the control plane as they are, replace `lib/loans/`, `tools/loan` and the seed fixtures, and keep `app-test/loans/knows-nothing-about-governance.test.ts` passing. Explore the code and propose a plan before making changes."
- Change who can approve what with `bun run users`: `set-clearance <email> <n>` sets a person's approval limit and `set-role <email> <role>` their role, `add` and `remove` bring people in and take them out, and `list` shows everyone. The running app sees each change within one poll, with no restart and no reset, and every change is recorded in `governance.db`'s `subject_changes`. A role has to be one the policy knows, and `bun run users` names those when it refuses one.
- Change the rules in `lib/control-plane/fixtures/governance.json`: each rule matches a toolkit and a PascalCase tool name such as `ApproveDiscount`. The fixture seeds `governance.db` once, so after editing it set `RESET_TOKEN` in `.env`, restart `bun run dev` and run `bun run reset`. Until you do, `/health` reports `fixture_drift`. A reset leaves the people you added under addresses of your own as they are, roles and clearances included.

## Further reading

The internals live in `docs/`, one page per question:

- [`docs/architecture.md`](./docs/architecture.md): how the four control points work, the two OAuth hops and which mechanism answers each, and what lives where in the repo.
- [`docs/configuration.md`](./docs/configuration.md): what `/health` reports, which Arcade project `setup-arcade` writes to, the port, rotating the identity secret, and what `bun run reset` puts back and what it keeps.
- [`docs/faq.md`](./docs/faq.md): why the limits live in hooks, why the Slack DM comes from Alice, why Bun, using another model, and what we measured against a real Arcade project.
- [`docs/deploying.md`](./docs/deploying.md): hosting the image instead of running it on your machine behind ngrok.
- [`docs/app-users-and-arcade-accounts.md`](./docs/app-users-and-arcade-accounts.md): who needs an Arcade account, for each of the two Slack routes.
- [`docs/ELASTIC.md`](./docs/ELASTIC.md): the Elastic module, Elasticsearch through the same gateway and the same hooks.
- [`docs/DOMAIN-SWAP.md`](./docs/DOMAIN-SWAP.md) walks through pointing the template at your own business system.
- [`docs/control-plane.md`](./docs/control-plane.md) is the control plane's own reference: the hooks, `governance.db`, drift and reset, the live stream and the audit log.
- [`docs/studio-memory.md`](./docs/studio-memory.md) covers Studio's thread memory: why `memory.db` is libsql, what it never keeps, and how the reset empties it.
- [`DESIGN.md`](./DESIGN.md) is the authoritative record: architecture, contracts, and the reasoning behind each decision.

## About Mastra templates

This partnership template was contributed by Arcade to show how Mastra works with Arcade's contextual access hooks, auth providers and MCP gateways for enforcing loan approval limits on an agent's tool calls. Partnership templates live in their own repositories.

[Want to contribute?](https://github.com/ArcadeAI/mastra-template-loan-approval-limits)
