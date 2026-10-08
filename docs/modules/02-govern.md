# Module 2 — Govern every tool call (Arcade)

**Start from:** `git checkout start`, with module 1 done. **Owner:** Arcade. **45 minutes.**

You leave with the four acts running on your own build: an account executive asks for a
$95K discount and "double-check your work", four things go wrong, and the control plane
catches all four while the model never gets a vote.

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
   the channel), the request is still recorded and routed, and the tool says so. Open
   `/approvals/<request id>` on your app as Charlie, with the id from the agent's reply, and the
   act finishes without the DM.
2. Confirm the hooks are on: `/hooks/health` reports `status: healthy` and `setup-arcade`
   printed *hooks: … status active (read back)*. Hooks are created disabled and turned on
   last, so if they are off, run `setup-arcade` once more.
3. Run the four acts, in the words `README.md` → Try it out uses:
   - **Act 1.** Sign in as Bob and ask for the approval. `DealDesk_ApproveDiscount` is not in his
     tool list. Nothing was refused; the tool was never offered.
   - **Act 2.** As Alice: *"Approve the discount for Northwind at $95K and double-check your
     work."* `/hooks/pre` refuses, the denial names `DealDesk_RequestApproval`, the agent
     calls it, Charlie gets a Slack DM from Alice's own account and the request appears in
     `#deal-desk-approvals` with the link and no buttons, Alice's turn ends. Charlie approves
     on the signed-in page; Alice's retry passes on a single-use grant.
   - **Act 3.** As Alice: *"Read DL-2291 and quote its bank account number and tax ID."* Both
     come back `[REDACTED]`. As Charlie they come through.
   - **Act 4.** Any read of DL-2291 strips the pasted instruction from `crm_notes` before the
     model sees it, for everyone. `INJECTION_DETECTION=off` shows what was prevented.
4. Edit a rule live. Raise Alice's clearance with `bun run users set-clearance` and watch the
   same prompt pass within one policy poll, with no restart.

## What to look at

- `gate/policies/governance.json`: every rule, keyed on `Toolkit.Tool` with
  the model-facing sentence in `Toolkit_Tool` spelling. The catalogue is a closed world.
- `gate/engine/src/policy-engine.ts` and `redaction-engine.ts`: pure, no
  domain words, the same engine for every act.
- `/panel`: one card per hook decision, with the audit row's reference on it.

## Checkpoint

All four acts on your own deployment, and one rule edited live.

## If you are behind

Module 2 is Arcade state, not code: users, hooks on, Slack. Three commands, each safe to run
again, put all of it in place and bring you to act 1:

    bun run setup-arcade <APP_PUBLIC_HOST>
    bun run users seed-demo --alice <your-email> --charlie <the host's approver email> --bob bob@example.com --michael michael@example.com --password <one you choose>
    bun run reset

The first checks every registration and fills in only what is missing; the second keeps anyone
who already exists; the third puts the deal book and the control plane back. `bun run reset`
keeps a real user's clearance as it is, so after raising Alice's, put it back yourself:
`bun run users set-clearance <your-email> 50000`.

## Handoff

To Elastic, when every laptop shows all four acts. **Start the Elastic Serverless signup now**,
before the handoff: a project takes a few minutes to come up, and module 3 needs it at step 1.
