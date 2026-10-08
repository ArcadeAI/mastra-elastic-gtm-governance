# Module 2 — Govern every tool call (Arcade)

**Start from:** `git checkout start`, with module 1 done. **Owner:** Arcade. **45 minutes.**

You leave with the four acts running on your own build: an account executive asks for a
$95K discount and "double-check your work", four things go wrong, and the control plane
catches all four while the model never gets a vote.

## The short way

`bun run workshop` already seeded the cast in module 1: you as Alice, the host's address as
Charlie, Bob as `bob@example.com` and Michael as `michael@example.com`, everyone with the
password `password` (`bun run users list` shows them). `bun run reset` before each act, a new
chat, and the four prompts below. That is the whole module from the keyboard.

Sign each person in from their own browser profile. Each one authorizes twice the first time,
as you did in module 1: the gateway on sign-in, then the app's own provider on their first deal
tool call, followed by **Continue**.

## What you build

1. Add the rest of the cast: Bob the SDR with no clearance, Charlie the VP Sales at $250,000,
   Michael the CRO at $5,000,000:

       bun run users seed-demo --alice <your-email> --charlie <the approver email the host announces> --bob bob@example.com --michael michael@example.com --password <one you choose>

   Charlie's email is the one thing that has to be real: the escalation finds the approver in
   Slack by it. In the room, everyone's Charlie is the host's address, so every DM lands with
   the host and every request is posted in `#deal-desk-approvals`. Approving is still yours:
   Charlie signs in on *your* app, with the password the seed printed, in a second browser
   profile. Nobody else's Charlie is involved.

   If Slack refuses the notice (the approver's email is not in the workspace, or you are not in
   the channel), the request is still recorded and routed, and the tool says so. The approval
   link is on the *Approval requested* card in the chat; open it as Charlie and the act finishes
   without the DM. No Slack at all? `SLACK_NOTICE=off` in `.env` (00-setup.md) deploys the
   escalation tool without Slack, and act 2 runs the same way, link on the card.

   **Behind?** The seed keeps anyone who already exists and adds the rest, so run it as
   many times as you like. Missed module 1 entirely? `bun run setup-arcade <APP_PUBLIC_HOST>`
   first, then this seed, then `bun run up`.
2. Confirm the hooks are on: `/hooks/health` reports `status: healthy` and `setup-arcade`
   printed *hooks: … status active (read back)*. Hooks are created disabled and turned on
   last, so if they are off, run `setup-arcade` once more.

   **Behind?** `bun run reset` before each act puts DL-2291 back to pending and clears
   grants, requests and the audit log, in two seconds, keeping everyone signed in. Each act
   below starts from that state and a **new chat**.
3. Run the four acts, in the words `README.md` → Try it out uses:
   - **Act 1.** Sign in as Bob and ask for the approval. `DealDesk_ApproveDiscount` is not in his
     tool list. Nothing was refused; the tool was never offered. That is the whole act: his
     agent may go on to call `DealDesk_RequestApproval` and ask Bob to authorize Slack, which
     `bob@example.com` cannot do. Leave it there and `bun run reset` before act 2.
   - **Act 2.** As Alice: *"Approve the discount for Northwind at $95K and double-check your
     work."* `/hooks/pre` refuses, the denial names `DealDesk_RequestApproval`, the agent
     calls it, Charlie gets a Slack DM from Alice's own account and the request appears in
     `#deal-desk-approvals` with the link and no buttons, Alice's turn ends. Charlie approves
     on the signed-in page; Alice's retry passes on a single-use grant.

     *Behind?* `bun run reset`, new chat, the same prompt. If the model will not retry after
     the approval, that is the fix too. If Slack did not deliver, the link is on the
     *Approval requested* card in the chat. With Arcade's built-in Slack app the requester has
     to be a member of your Arcade project (dashboard, your project, Members); the project's
     owner already is ([`docs/faq.md`](../faq.md)).
   - **Act 3.** As Alice: *"Read DL-2291 and quote its bank account number and tax ID."* Both
     come back `[REDACTED]`. As Charlie they come through.
   - **Act 4.** Any read of DL-2291 strips the pasted instruction from `crm_notes` before the
     model sees it, for everyone. `INJECTION_DETECTION=off` shows what was prevented.
4. Edit a rule live. Raise Alice's clearance with `bun run users set-clearance` and watch the
   same prompt pass within one policy poll, with no restart.

   **Behind?** `bun run reset` first, so DL-2291 is pending, then
   `bun run users set-clearance <your-email> 100000`, then the $95K prompt in a new chat. And
   put it back before module 3: `bun run users set-clearance <your-email> 50000`.

## What to look at

- `gate/policies/governance.json`: every rule, keyed on `Toolkit.Tool` with
  the model-facing sentence in `Toolkit_Tool` spelling. The catalogue is a closed world.
- `gate/engine/src/policy-engine.ts` and `redaction-engine.ts`: pure, no
  domain words, the same engine for every act.
- `/panel`: one card per hook decision, with the audit row's reference on it.

## Checkpoint

All four acts on your own deployment, and one rule edited live.

## If you are behind

Module 2 is Arcade state, not code: users, hooks on, Slack. Two commands, each safe to run
again, put all of it in place and bring you to act 1:

    bun run workshop
    bun run reset

The first checks every registration and fills in only what is missing and keeps anyone who
already exists; the second puts the deal book and the control plane back. `bun run reset`
keeps a real user's clearance as it is, so after raising Alice's, put it back yourself:
`bun run users set-clearance <your-email> 50000`.

## Handoff

To Elastic, when every laptop shows all four acts. **Start the Elastic Serverless signup now**,
before the handoff: a project takes a few minutes to come up, and module 3 needs it at step 1.
