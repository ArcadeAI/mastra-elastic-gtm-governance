# Module 2 — Govern every tool call (Arcade)

**Start from:** `git checkout start`, with module 1 done. **Owner:** Arcade. **45 minutes.**

You leave with the four acts running on your own build: an account executive asks for a
$95K discount and "double-check your work", four things go wrong, and the control plane
catches all four while the model never gets a vote.

## What you build

1. Add the rest of the cast: `bun run users seed-demo`, or one at a time — Bob the SDR with
   no clearance, Charlie the VP Sales at $250,000, Michael the CRO at $5,000,000. Charlie's
   email has to be the one his Slack account uses.
2. Confirm the hooks are on: `/hooks/health` reports `status: healthy` and `setup-arcade`
   printed *hooks: … status active (read back)*. Hooks are created disabled and turned on
   last, so if they are off, run `setup-arcade` once more.
3. Run the four acts, in the words `README.md` → Try it out uses:
   - **Act 1.** Sign in as Bob and ask for the approval. `DealDesk_ApproveDiscount` is not in his
     tool list. Nothing was refused; the tool was never offered.
   - **Act 2.** As Alice: *"Approve the discount for Northwind at $95K and double-check your
     work."* `/hooks/pre` refuses, the denial names `DealDesk_RequestApproval`, the agent
     calls it, Charlie gets a Slack DM from Alice's own account, Alice's turn ends. Charlie
     approves; Alice's retry passes on a single-use grant.
   - **Act 3.** As Alice: *"Read DL-2291 and quote its bank account number and tax ID."* Both
     come back `[REDACTED]`. As Charlie they come through.
   - **Act 4.** Any read of DL-2291 strips the pasted instruction from `crm_notes` before the
     model sees it, for everyone. `INJECTION_DETECTION=off` shows what was prevented.
4. Edit a rule live. Raise Alice's clearance with `bun run users set-clearance` and watch the
   same prompt pass within one policy poll, with no restart.

## What to look at

- `lib/control-plane/fixtures/governance.json`: every rule, keyed on `Toolkit.Tool` with
  the model-facing sentence in `Toolkit_Tool` spelling. The catalogue is a closed world.
- `packages/governance-core/src/policy-engine.ts` and `redaction-engine.ts`: pure, no
  domain words, the same engine for every act.
- `/panel`: one card per hook decision, with the audit row's reference on it.

## Checkpoint

All four acts on your own deployment, and one rule edited live.

## If you are behind

Still `git checkout start`. Module 2 is Arcade state, not code: users, hooks on, Slack.
`bun run reset` puts the deal book and the control plane back between attempts.
