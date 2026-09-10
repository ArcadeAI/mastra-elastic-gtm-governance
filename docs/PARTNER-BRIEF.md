# MCP for GTM: build an agent for an at-risk renewal

A renewal is coming up, usage is falling, and the customer wants 30% off. Build an
agent that researches the account, drafts the follow-up, and prepares the offer.
Then give it the controls that keep a useful assistant from making an expensive decision.

We build one agent across Mastra, Elastic and Arcade. Attendees leave with a fork they
can adapt to their own workflow, plus a clear view of where evidence ends and authority begins.

## What we build together

Northwind's annual renewal lists at $12,000. Elastic holds usage, support, procurement
and renewal records. Mastra brings those records into the agent's reasoning. Arcade
connects the native MCP tools and enforces the action and output policies.

The AE can offer 15%, but the customer requests 30%. The agent's attempted action is
blocked, a review link arrives in the attendee's Slack self-DM, and the attendee signs
in as the seeded manager to review the exact terms and message. Approval resumes the
original action and saves an $8,400 draft. A read-back checks what was actually saved.
The final exercise lets attendees write and verify an output-filter rule themselves.

All customer data is synthetic. The offer and customer email remain drafts. The Slack
self-DM is the exercise's only external message. One attendee can play the two distinct
authenticated roles; it demonstrates the roles, not separation between two real people.

## Proposed October 8 agenda

Elastic SF, 88 Kearny, Floor 19, plus livestream. Venue, speakers and support assignments
need partner confirmation. All times Pacific.

| Time | Owner | Attendee outcome |
|---|---|---|
| 4:30–4:45 | Hosts | Arrival, food and laptop help |
| 4:45–4:55 | Thierry | Watch the renewal demo and understand the goal |
| 4:55–5:50 | Mastra | Sign up, run the agent and edit its instructions |
| 5:50–6:45 | Elastic | Sign up, seed records, retrieve evidence and prepare native MCP |
| 6:45–6:55 | Hosts | Break |
| 6:55–7:50 | Arcade | Sign up, connect Elastic, deploy Sales, verify hooks and complete approval |
| 7:50–8:10 | Joint | Write, test and verify one output rule |
| 8:10–8:30 | Joint | Attendee demos, questions and next steps |

Each partner has 55 minutes including signup. Elastic teaches its native interface and
MCP; the Elastic-to-Arcade connection belongs in Arcade's section. The same agent carries
through all three sections. Timing is a target until the independent rehearsal passes.

## Review requests

- **Mastra:** confirm the starter and account/model setup, nominate a speaker and TA,
  and confirm the model credential or credit arrangement.
- **Elastic:** confirm the native MCP setup, least-privilege credential steps, trial
  availability and capacity; nominate a speaker and TA and confirm venue support.
- **Arcade:** validate the gateway/hook setup and one-custom-toolkit path; confirm the
  Slack invite, delivery permissions, floater and remote chat support.
- **Together:** walk the handoffs with a new attendee, confirm participant costs and
  supported operating systems, and schedule the joint onsite/remote dry run.

## Materials and current status

[Public repository](https://github.com/ArcadeAI/mastra-elastic-gtm-governance) ·
[Detailed agenda](WORKSHOP-PLAN.md) · [Attendee guide](ARRIVAL.md) ·
[Current evidence and open gates](PARTNER-READINESS.md) · [Rehearsal worksheet](REHEARSAL.md).

This packet is for partner review. Use the readiness record for tested behavior and
remaining gates before promoting it as a fully rehearsed hands-on workshop.

~ 🕷️ Anansi, Thierry's Agent
