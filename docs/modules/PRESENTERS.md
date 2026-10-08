# Presenters: who does what, in order

Three speakers, one laptop each, one shared Slack. The attendee pages (`01-build.md` to
`04-capstone.md`) say what the room does; this page says what the person at the front does.
Every command here is one the room runs too, so when you type, they type.

## Before doors (host)

- The recovery slide up, and left up all day:

      bun run workshop
      bun run reset

  (`workshop` needs six lines in `.env`; module 1 → The short way lists them. Every persona's
  password is `password`, on each laptop's own sign-in only.)

- The host's approver email on the same slide. Every attendee's Charlie is that address.
- The Slack invite accepted by every speaker, `#deal-desk-approvals` open on the host's screen.
- The host's demo laptop: `bun run up` running, three browser profiles signed in (Alice, Bob,
  Charlie), act 2 run once so both consent screens are cached, then `bun run reset`.
- The shared Anthropic key on a slide the room can read.

## Module 1, Mastra (Abhi), 45 min

Goal: every laptop has an agent on a gateway that carries six `DealDesk` tools, and has made
one call.

1. **Minute 0.** Ask the five pre-start questions from `01-build.md` → "Before the first
   command". Anyone short on one works on it while you talk; do not wait.
2. **Minute 5.** Everyone runs `bun run workshop`. It takes about four minutes, most of it the
   one `arcade deploy`. Talk through what it does while it runs: starts the app and the
   tunnel, registers the custom provider, the hooks (created disabled), the one server, the
   User Source, the gateway, turns the hooks on, seeds the cast. No pause, no second terminal.
3. **Minute 15.** `bun run users list`: Alice, Bob, Charlie, Michael.
4. **Minute 18.** Open the ngrok URL, sign in as Alice, authorize the gateway. Ask
   *"Which discount requests are pending?"* Five pending requests come back through `DealDesk_SearchDeals` (eight are on file; three already carry a decision).
5. **Minute 25.** `bun run studio`, sign in at `localhost:4111/arcade/authorize`, same prompt.
   Same agent, same gateway, every step visible. This is the Mastra half of the story.
6. **Minute 40.** Checkpoint: name the six tools on the wire. Hand to Arcade.

Handoff line: *"Everyone should have made one call. If you haven't, the recovery slide gets
you there during the next module."*

## Module 2, Arcade (Thierry), 45 min

Goal: the four acts on every laptop, one rule changed live. The full script with spoken lines
is the host's own; this is the order.

1. **Minute 0.** Frame: a tool the agent *can* call is not a tool it is *allowed* to call.
   Four places to enforce that: see, connect, execute, read back.
2. **Minute 3.** `bun run reset`, `bun run users list`, `/hooks/health`. Open `/panel` next to
   the chat. The cast is already there from module 1.
3. **Minute 10, act 1.** Bob's profile, new chat: *"Approve the discount for Northwind at $95K
   and double-check your work."* Only the two read tools in his list (no approve, request,
   deny or decide), so the agent says it cannot approve and stops; `/panel` shows the Access
   card naming the four hidden tools.
4. **Minute 16, act 2.** Alice's profile, new chat, same prompt. Denied at `/pre`, the refusal
   names `DealDesk_RequestApproval`, the agent calls it, Slack consent once, *Routed to Charlie*.
   If the agent stops first to ask how to justify the request, that is the model being careful
   about the CRM notes, not a failure: *"Yes, request approval for the full $95,000, citing the
   three-year prepay and eight years as a customer."*
   The DM lands with the host; the post lands in `#deal-desk-approvals` with the link; the
   chat card shows the same link. Optional: open it as Alice, refused. Open it in Charlie's
   profile, Approve. Alice's chat resumes, retries, recorded. This is the fourteen minutes.
5. **Minute 30, act 3.** Alice, new chat: *"Read DL-2291 and quote its bank account number and
   tax ID."* Both redacted. Charlie, same prompt: both through. Point at the opened
   `DealDesk_GetDeal` card in each chat, not the model's sentence: the model may decline to
   quote the identifiers for Charlie too, and then the two replies look alike.
6. **Minute 35, act 4.** Alice, **new chat**: *"Read DL-2291 and summarize its CRM notes."*
   The pasted instruction is gone. Show the detection-off comparison as a screenshot.
7. **Minute 39.** `bun run reset`, then `bun run users set-clearance <you> 100000`, same $95K
   prompt: passes without Charlie. Same agent, one number changed.
8. **Minute 42.** Everyone: `bun run users set-clearance <you> 50000` and `bun run reset`.
   **Start the Elastic Serverless signup now.** Hand to Elastic.

Handoff line: *"Nothing to check out. The Elastic tools have been in your deploy since module
1, switched off. JD turns them on."*

## Module 3, Elastic (JD), 45 min

Goal: the deal book indexed, the agent searching it through the same hooks. No Slack in this
module: nothing here escalates.

1. **Minute 0.** Check Alice is at 50,000 (`bun run users list`); if not,
   `bun run users set-clearance <email> 50000`. Above 250,000 the redaction beat never fires.
2. **Minute 3.** Serverless project up (started at the handoff): copy the Elasticsearch
   endpoint. In Kibana Dev Tools, the API key request from `03-ground.md` step 3; copy `encoded`.
3. **Minute 10.** Four lines in `.env`: `ELASTIC_MODULE=on`, `ELASTICSEARCH_URL`,
   `ELASTICSEARCH_API_KEY`, `ELASTIC_SEED_USER=michael@example.com`. Then Ctrl-C the running
   `workshop` and `bun run workshop` again: it uploads the two secrets, adds the 26 tools to
   the gateway, restarts the app and seeds the index as Michael, through Arcade.
4. **Minute 18.** Read the seed's last line: *8 documents in "deal-files"*. A refusal there is
   act 1 again: only the CRO can write the index.
5. **Minute 22.** As Alice, new chat, the four prompts from `03-ground.md` step 6: procurement
   (keyword), single team or product (semantic, DL-2296 first), total by status (aggregate),
   *"Use ES|QL to show me the ten most recent requests"* (ES|QL; a query with no `KEEP` is
   refused once and retried). Every result comes back redacted for Alice.
6. **Minute 38.** As Alice: *"Delete the deal-files index."* Not in her list.
7. **Minute 42.** Checkpoint: acts 3 and 4 on a search hit. Hand to the capstone.

## Capstone (all three), 20 min + show and tell

1. Everyone runs the whole story end to end from `04-capstone.md`: the $95K prompt with the
   deal book and the index both live.
2. Fork it: one rule, one tool, or one field changed, and shown.

## If something fails on stage

| It | Do |
|---|---|
| Slack notice fails for someone | the link is on the chat card and in `#deal-desk-approvals`; open it as Charlie |
| Someone could not join Slack at all | `SLACK_NOTICE=off` in `.env`, `bun run workshop` (redeploys once); act 2 runs, link on the card |
| The model will not retry after the approval | new chat, `bun run reset`, act 2 again with the exact prompt |
| The agent asks how to justify the request | answer it: the full $95,000, the three-year prepay, eight years as a customer |
| Charlie's agent will not quote the identifiers | open the `DealDesk_GetDeal` card in both chats: Alice's shows `[REDACTED]`, Charlie's the values |
| "The gateway advertised … none belong to DealDesk" | stale `governance.db` from an older layout: `bun run reset` |
| Setup says the hooks are inactive | run `bun run setup-arcade <host>` again |
| Anything else | the recovery slide, then rejoin at the current act |
