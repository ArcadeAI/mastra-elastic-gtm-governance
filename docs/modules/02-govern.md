# Module 2 — Govern every tool call (Arcade)

[Setup](./00-setup.md) · [Module 1 · Build](./01-build.md) · **Module 2 · Govern** · [Module 3 · Ground](./03-ground.md) · [Capstone](./04-capstone.md) · [Presenters](./PRESENTERS.md) · [Agent prompt](./AGENT-PROMPT.md)

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

## The prompts

Copy these as written. `bun run reset` and a new chat before each one.

**Act 1**, as Bob (`bob@example.com`):

> Approve the discount for Northwind at $95K and double-check your work.

**Act 2**, as Alice (you):

> Approve the discount for Northwind at $95K and double-check your work.

If the agent stops after the denial to ask how to justify the request:

> Yes, request approval for the full $95,000, citing the three-year prepay and eight years as a customer.

Then, as Charlie, open the approval link and press **Approve**.

**Act 3**, as Alice:

> Read DL-2291 and show me every field on the record.

The bank account number and tax ID are `[REDACTED]` on the `DealDesk_GetDeal` card.

**Act 3 again**, as Charlie (`hello@brisedemer.io`, or the approver address the host announced), new chat:

> Read DL-2291 and show me every field on the record.

The same card now carries the values.

**Act 4**, as Alice:

> Read DL-2291 and summarize its CRM notes.

**Change the rule**, after `bun run reset` and `bun run users set-clearance <your-email> 100000`, as Alice:

> Approve the discount for Northwind at $95K and double-check your work.

Then `bun run users set-clearance <your-email> 50000` and `bun run reset` before module 3.

## What you build

1. The cast is already there: `bun run workshop` seeded it in module 1. Check with
   `bun run users list`: you as Alice (account executive, $50,000), Bob the SDR with no
   clearance, Charlie the VP Sales at $250,000 (`WORKSHOP_APPROVER`, the host's address), and
   Michael the CRO at $5,000,000. Every password is `password`. Doing it by hand instead:

       bun run users seed-demo --alice <your-email> --charlie <the approver email the host announces> --bob bob@example.com --michael michael@example.com --password password

   Charlie's email is the one thing that has to be real: the escalation finds the approver in
   Slack by it. In the room, everyone's Charlie is the host's address, so every DM lands with
   the host and every request is posted in `#deal-desk-approvals`. Approving is still yours:
   Charlie signs in on *your* app, in a second browser profile. Nobody else's Charlie is
   involved. Do not remove and re-add a person Arcade has already authorized: Arcade keeps the
   old token and every deal tool then fails with *the identity provider rejected the token*.

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
   - **Act 1.** Sign in as Bob (`bob@example.com`), new chat: *"Approve the discount for
     Northwind at $95K and double-check your work."* `DealDesk_ApproveDiscount` is not in his
     tool list, and neither is `DealDesk_RequestApproval`: an SDR has nothing to escalate. Nor
     are `DealDesk_DenyDiscount` and `DealDesk_Decide`: an SDR has no say in a discount either
     way, so Bob sees only `DealDesk_SearchDeals` and `DealDesk_GetDeal`. The agent says it
     cannot approve and stops. Nothing was refused; the tools were never offered, and Bob never
     sees a Slack consent. The Access card in `/panel` names all four.
   - **Act 2.** As Alice: *"Approve the discount for Northwind at $95K and double-check your
     work."* `/hooks/pre` refuses, the denial names `DealDesk_RequestApproval`, the agent
     calls it (it may first stop and ask how to justify the request, citing the risks in the
     CRM notes; answer *"Yes, request approval for the full $95,000, citing the three-year
     prepay and eight years as a customer"*), Charlie gets a Slack DM from Alice's own account and the request appears in
     `#deal-desk-approvals` with the link and no buttons, Alice's turn ends. Charlie approves
     on the signed-in page; Alice's retry passes on a single-use grant.

     *Behind?* `bun run reset`, new chat, the same prompt. If the model will not retry after
     the approval, that is the fix too. If Slack did not deliver, the link is on the
     *Approval requested* card in the chat. With Arcade's built-in Slack app the requester has
     to be a member of your Arcade project (dashboard, your project, Members); the project's
     owner already is ([`docs/faq.md`](../faq.md)).
   - **Act 3.** As Alice, new chat: *"Read DL-2291 and show me every field on the record."*
     The bank account number and tax ID come back `[REDACTED]`. As Charlie, same prompt, they
     come through. Ask for the record, not for the identifiers: asked to *quote* them, the
     model refuses before any tool runs (0 tool calls, nothing on the panel). Show the opened
     `DealDesk_GetDeal` card in each chat, which is the result exactly as the model received it
     after `/post`, beside `/panel`'s Post lane.
   - **Act 4.** As Alice, new chat: *"Read DL-2291 and summarize its CRM notes."* The notes
     end at "scope unverified": the pasted instruction after that was stripped from
     `crm_notes` before the model saw it, as on every read, for everyone. `/panel`'s Post lane
     names the pattern. `INJECTION_DETECTION=off` shows what was prevented.
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

---

**Next:** [Module 3 · Ground](./03-ground.md)
