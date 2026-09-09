 w# MCP4GTM — A+ delivery plan

> Local build update, 2026-09-08: the staged Mastra runtime, hooks, approval tools,
> authenticated role switching, persistent continuation, and operator commands are now
> implemented. [Local verification](LOCAL-VERIFICATION.md) records the observed checks.
> The delivery gates below also include cloud rehearsal and attendee timing, which remain
> open. This plan is a delivery backlog; use the module guides for current commands.


Event: Thursday 2026-10-08, 4:30–8:30 PM, Elastic SF (88 Kearny, Fl 19) + livestream.
Partners: Arcade (host, Module 3), Mastra (Module 1), Elastic (Module 2).
Target: 1,000 registered; 60–100 in room. Repo public by 2026-10-01.

The workshop demonstrates how Arcade connects a Mastra agent to Elastic and carries a
complete business workflow through governed tools. Attendees build one Northwind lead
journey: research the account, propose a route, encounter an authority limit, request human
approval through Slack, and continue the original action after approval.

Each section adds to the same project. Mastra supplies the agent, Elastic supplies the
evidence, and Arcade connects the tools, manages authorization, and enforces the controls.
The full approval loop is part of the core workshop. Ease of integration must be visible in
the attendee's setup and handoffs, then demonstrated by a working run.

This is a delivery plan for work still to build and rehearse. It does not claim that the
current checkout already completes that journey.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Story is lead qualification and routing, not discount approval.** | It is what the repo implements; inbound lead qualification is a recognizable GTM workflow; every one of the four acts maps cleanly. The brief, Partiful, and speaker abstracts still say "$95K discount" — update them (see §6). |
| D2 | **The model does not supply the number that decides its authority.** | `route_lead(lead_id, estimated_acv, …)` today lets the agent overwrite the ACV. A $49K submission would dodge the $95K act. The pre-hook must resolve ACV server-side from the lead record and bind the grant to that value. |
| D3 | **Teach Mastra → Elastic → Arcade → capstone in one project.** | Confirmed 2026-09-08. Carry the same Northwind question and agent forward. Mastra starts with supplied input; Elastic demonstrates the evidence natively; Arcade first connects read-only retrieval, then expands the same gateway to the complete governed workflow. |
| D4 | **Signup and setup happen at the workshop, inside the owning section.** | Confirmed 2026-09-08. Mastra signup is in Module 1; Elastic signup/provisioning is in Module 2; Arcade signup, supporting-service deployment, OAuth, and gateway setup are in Module 3. Checkpoints are progressive; no cloud-ready `doctor` gate at the door. Budget setup inside each module and rehearse from fresh accounts. |
| D5 | **Every attendee owns a Mastra project, Elastic deployment, and Arcade gateway.** | Confirmed 2026-09-08. Each speaker owns their product's setup. Arcade alone teaches Elastic Remote MCP registration and the gateway connection. Spike 04 must prove the fresh-trial path and the handoff between Modules 2 and 3. Shared read-only Elastic exists only as the day-of degraded fallback (§8). |
| D6 | **Keep the full Slack approval and agent continuation loop.** | The attendee authorizes Slack through Arcade. The request assigned to Riley arrives in the attendee's own Slack account; they switch from Dana to Riley, authenticate on the approval page, and approve the exact action. The original Dana agent request resumes and completes one route write. Spike 03 proved Slack posting; this full loop still needs implementation and verification. |
| D7 | **Fail-closed everywhere, stated explicitly.** | Set and read back the gateway extension's failure mode for all three hooks; activate the extension. Arcade enforces the failure mode when a hook is unreachable or times out. Verify a known-deny call through the real gateway and surface gateway failures in the UI even when the hooks service cannot emit an event. |
| D8 | **Track upstream.** | Add `upstream` remote to `ArcadeAI/mastra-contextual-governance`, record the base SHA, keep `packages/*` domain-agnostic so governance fixes flow both ways. |
| D9 | **Make integration easy while retaining the full use case.** | Confirmed 2026-09-08. Put the first Mastra → Arcade → Elastic answer ahead of action-system setup. Supply a guided launcher and explicit connection checkpoints, retain all governance acts and human approval, and measure setup friction. All three partners retain 55 minutes, including signup. |
| D10 | **One attendee plays the demo roles.** | Confirmed 2026-09-08. Follow Mateo's persona-switcher pattern: distinct seeded Dana/Sam/Riley/Morgan identities, one attendee's Slack account, and supplied demo credentials. No extra inboxes or second person required. The delivery mapping never changes who may approve; Dana's self-approval still fails. |

## 2. What an attendee leaves with

First, attendees compare the supplied-input answer from Mastra, the source records they
found in Elastic, and the same agent's cited answer through Arcade. Record the minimal
configuration change, discovered tools, source IDs, and time to that first connected result.
Use the clean synthetic Elastic fixture and an Elastic-only gateway for this checkpoint;
action tools and adversarial fixtures enter only after the relevant controls are active.

By 8:10 PM the normal-path attendee (in room or remote) can, on their own deployment,
complete the following. Record the §8 shared-data fallback as degraded rather than claiming
independent ownership or a completed data-mutation exercise:

1. Ask the agent as **Dana** to research `LD-2291` and get a cited qualification that quotes
   Elastic evidence (trial activity, docs visits, security questions).
2. Switch to **Sam** and show `Lead_RouteLead` is absent from tool discovery (access).
3. Route `LD-2291` as Dana → blocked at $95K vs $50K → Riley's request lands in the
   attendee's own Slack DM → the attendee switches to **Riley**, authenticates, and approves → the original
   agent request resumes → the *identical* call retries and exactly one route write exists.
   The agent returns the completed disposition and cited brief; a delivered DM alone is not a pass.
4. Show the personal phone number never reached the Mastra model during the governed runs, including through successful
   route/classification results and the sensitive Elastic fixture hit (post/privacy).
5. Show the seeded instructions in the form message and Elastic hit were stripped
   (post/integrity).
6. Try to lower the authoritative ACV through tool arguments (for example a $49K lowball
   where the signature accepts an estimate); verify it cannot change the stored authority
   value or authorize the over-limit route (D2).
7. Edit one policy rule live (e.g. raise Dana's authority) and re-run without redeploying.
8. Read all of the above as an audit stream on the governance panel.

That list is also the capstone checklist and the acceptance test for the repo. Correlate the
agent request, Elastic evidence, gateway decision, Slack request, human decision, resumed
tool call, and business write so the complete journey is visible in one trace.

## 3. Build list (repo work, owner: Arcade)

Ordered so that one complete governance loop exists before anything else is polished.

### P0 — the loop (target 2026-09-18, brief's "three spikes resolved" date)

- [ ] **hooks: `/access`** — deny-list by persona; Sam cannot discover `Lead_RouteLead`.
- [ ] **hooks: `/pre`** — authority check for `Lead_RouteLead`. Resolve ACV from lead-app by
      `lead_id` (service token), not from tool args. Emit deny with remediation text that names
      the minimum-sufficient approver (Riley, not Morgan). Fail closed on lead-app error.
- [ ] **hooks: `/post`** — redact `personal_phone` and strip the seeded injection from
      `form_message` on every Lead result that contains them, including get, route, and
      classify. Cover Elastic result shapes measured by Spike 04. Verify the final output
      sent to the Mastra model. Emit `modify` events with before/after.
      For each tool declared to carry sensitive content, an unparseable or unsupported
      result shape must return `CHECK_FAILED` with no raw output forwarded. Test malformed
      and alternate payload shapes through the real gateway as well as the local contract.
- [ ] **Elastic privacy/integrity fixture** — keep the initial eight-event fixture clean for
      Modules 2 and the first connection. Prepare a governed exercise variant that adds an
      unmistakably synthetic phone and seeded instruction to one existing event, preserving
      all eight IDs and dates. Load it only after the post filters are active and verified.
      Prove retrieval of that exact hit through Elastic → Arcade → Mastra; beats 4–5 fail if
      its raw markers reach the model. Reset must distinguish clean and governed fixtures
      and remove the extra capstone event. Shared fallback data stays clean; its users watch
      the presenter's own deployment for this mutation and record the degraded coverage.
- [ ] **approvals toolkit** — `request_approval` posts a Slack Block Kit message as the
      requester (spike 03 pattern); `decide` records a grant bound to
      `(user, tool, lead_id, authoritative_acv, approved inputs)`, including owner and
      rationale; grant is single-use. Verify the designated approver's identity at decision time.
- [ ] **Approval continuation** — persist the original agent request/thread, requester,
      pending tool call, exact arguments, and approval request ID server-side. The waiting UI
      observes the authenticated decision and resumes that request with the same Mastra agent
      and gateway. A denial or expiry leaves the action unexecuted. A Slack link carries only
      an opaque request ID; clicking it or possessing it never grants authority. Prevent
      duplicate continuations and enforce a stable action idempotency key in lead-app so
      duplicate approval events, polling, or retries cannot create a second business write.
      Test a delayed decision after the first HTTP request ends. The current route has no
      persisted wait/resume path; reporting "waiting" is not a completed approval loop.
- [ ] **retry-unchanged** — reconcile with `packages/policy-schema` grant schema, which today
      permits *lower* amounts. Bind the authoritative value and all approved arguments exactly;
      test changed-owner, changed-amount, expired-grant, and consumed-grant rejection.
- [ ] **`route_lead` signature** — remove `estimated_acv` as a model-supplied authority input
      (keep it read-only from the record) or keep it purely informational and ignored by both
      policy and the business write. Preserve the lowball exercise with the chosen signature.
      Update `tools/lead`, `apps/lead-app`, tests, DESIGN.md.
- [ ] **audit stream** — `governance.db` + SSE endpoint using the DESIGN.md event contract.
- [ ] **Local contract tests** — drive lead-app + hooks with a fake Arcade caller for fast CI.
      These prove local behavior, not gateway enforcement, Slack delivery, or model-visible output.
- [ ] **Live integration acceptance** — run the §2 beats through Mastra, the real Arcade
      gateway, Elastic, and distinct requester/approver identities. Include an inactive
      extension check, a hook-outage drill, and inspection of the model-facing tool results.
      Record this separately from the local CI result.

### P1 — participant experience (target 2026-09-23; cold-start gate Sep 25)

- [ ] **One agent across the teaching stages** — same agent definition and workshop
      project, with an independent baseline run requiring
      only its model credential. Mastra account/project setup and a visible hosted project
      result belong in the worksheet. No Arcade/Elastic discovery or required tool calls in
      this stage. Add explicit Elastic-only and full-workflow stages as the same gateway's
      tool catalog grows. The first connected stage must answer from Elastic without requiring
      Lead tools; the current Lead-first prompt cannot do that reliably. Keep stage selection
      explicit and inspectable; never silently fall back when a required gateway is broken.
      Teach the connection/configuration changes, keeping policy and per-app authentication
      in Arcade rather than adding them to the agent for each stage.
- [ ] **`bun run doctor`** — implement progressive Mastra, Elastic, and Arcade checks.
      The Mastra checkpoint requires no later-stage credentials. Elastic checks index contents
      and native MCP auth/search. Arcade first checks its Elastic-only connection and cited
      answer, then checks public services, OAuth/persona identities,
      the curated catalog's toolkit AND tool names, active extension, explicit failure modes,
      and a real known-deny probe. Credentials must never be printed.
- [ ] **`bun run reset`** — the brief's reset script: reseed leads.db, clear governance.db and
      grants, pending continuations, and the exact baseline policy. Explicitly select the
      clean Elastic fixture for a fresh workshop or the governed fixture for capstone control
      checks; remove extra exercise documents. Idempotent. Re-indexing the eight original
      IDs alone is not a reset. Preserve trace evidence before resetting it.
- [ ] **Web UI** — persona switcher, chat, approvals inbox, split-screen governance panel
      driven by SSE. Split-screen is what makes the livestream legible.
- [ ] **Arrival checklist** — laptop, access to email/GitHub, install permissions, and the
      supported toolchain list. Make clear that partner signup, keys, cloud provisioning,
      and integration are taught during the workshop. Offer an optional repo download and
      laptop check; neither substitutes for the live modules.
- [ ] **Guided Arcade launcher and checkpoints** — first connect Elastic MCP to the same
      Mastra agent through an Elastic-only gateway. Then guide public deployment of hooks,
      lead-app, IdP, and web; collect actual URLs; configure persona emails before first seed;
      register OAuth; deploy toolkits; authorize Lead and requester Slack access. Configure
      and activate fail-closed hooks, stage action toolkits on the same gateway under
      operator-only access, and verify actual names, denials, and output filtering with a
      separate setup identity before enabling workshop persona rules. No probe result is
      passed to the Mastra model. Document/test the setup identity and access transition. The
      launcher must expose progress, actionable failures, and a safe resume point rather
      than requiring attendees to debug four services during the exercise. Signup, provider
      consent, and Remote MCP registration remain visible guided steps where APIs do not
      support automation. `arcade deploy` only deploys toolkits. Helpers are not implemented;
      time the whole fresh-account path, document hosting requirements, and preserve all acts.
- [ ] **Shared read-only Elastic fallback** — owner: Arcade, with Elastic validating the
      deployment/key privileges; ready by Sep 23. Provision the fixture endpoint, seed it,
      mint scoped read-only credentials, and document private distribution through TAs for
      in-room and remote attendees. Rehearse using the handed-out credential through a new
      attendee gateway. Keep the shared fixture clean while any attendee is still at the
      first connection. Record tested capacity, renewal, and the presenter-owned deployment
      used for evidence/adversarial mutations, without changing data under other attendees.
- [ ] **Persona and approval mapping** — owner: Arcade; ready by Sep 23. Document the solo
      attendee-to-Dana/Sam/Riley/Morgan and setup-verifier mapping. Seed Dana with the
      attendee's Arcade account email so stock Slack's project-member verification succeeds;
      supply distinct demo credentials for the other roles. Configure an authenticated
      custom user verifier for the demo OAuth provider. Map notification delivery separately
      to the attendee's actual Slack account. Test Dana's rejected self-approval, switching
      and authenticating as Riley, and resuming Dana's run before the cold-start gate.
- [ ] **RECOVERY.md** — the ten most likely day-of failures and the fix for each (wrong toolkit
      name in policy [spike 02], hook timeout, Slack scope missing, Elastic 9.3 requirement,
      zod 4 collision, expired Elastic one-day key, wifi clone failure → USB/zip fallback).
- [ ] **Module worksheets** — finish the drafts in `docs/modules/` with measured signup
      steps, commands, expected output, recovery points, and an explicit handoff. Every setup
      step stays in the responsible partner's section.
- [ ] **`bun run capstone` + policy editing** — implement the attendee acceptance runner and
      live policy edit without redeployment. Print evidence per beat, and distinguish a
      degraded demonstration or skipped check from a pass. Prove all eight beats before dry runs.
      Policy edits update the deployed hooks service's SQLite policy store through a
      dedicated operator-authenticated admin endpoint. Use a separate operator bearer
      credential, deny missing/invalid credentials, validate edits atomically, and keep the
      credential and admin operation out of the Mastra toolset and Arcade secrets/catalog.
      The operator UI/CLI targets the deployed service. Beat 7 must observe allow → deny
      through the same real gateway after raising/restoring authority; a local-only test
      cannot satisfy it. Test that agent-accessible tools cannot mutate policy.

### P2 — polish (target 2026-10-01, repo public)

- [ ] `FORKING.md` — swap `tools/lead` for Salesforce/HubSpot/Attio; swap fixture; keep
      `packages/*`.
- [ ] Slides per module: one connected journey, each partner's contribution, and the four
      control boundaries. Reuse the same Northwind example and tool trace throughout.
- [ ] Recording chapter plan matching the run of show.
- [ ] README "Current status" section removed once P0/P1 land.

## 4. Run of show with exercises

Publish the arrival checklist ~2026-10-01, reminder 2026-10-05. In-room and remote attendees
sign up during the same guided sections. Each partner gets 55 minutes, including signup/setup;
the fresh-account rehearsal must validate these proposed allocations.

| Time | Block | Attendees do | Checkpoint |
|---|---|---|---|
| 4:30 | Doors, food, laptop help (15) | Open the repo and check the toolchain with TAs. | Ready to follow Module 1; no partner accounts required yet |
| 4:45 | **Kickoff (Thierry, 10)** | Watch one Northwind request move from Elastic research through Arcade denial, Slack approval, and resumed action in Mastra. | Understand the complete workflow they will build |
| 4:55 | **Module 1 — Mastra: Build (55)** | Sign up; create a project; configure the model credential; run the agent on sanitized Northwind input. Save the question, answer, and missing evidence. | A working agent and a question to revisit when its tools are connected |
| 5:50 | **Module 2 — Elastic: Prepare the evidence (55)** | Sign up; provision; seed clean data; search/aggregate natively to answer that question. Save source IDs; obtain the Kibana MCP URL and read-only credential. | Eight events, native evidence, and a ready MCP endpoint; no Arcade setup |
| 6:45 | Break (10) | — | — |
| 6:55 | **Module 3 — Arcade: Connect and govern (55)** | Sign up; connect Elastic to the same Mastra agent through Arcade and inspect cited evidence. Use guided setup to add governed Lead/Approvals tools to the same gateway. Complete the Slack request, authenticated human approval, and resumed identical action. | First connected answer, then the complete governed workflow and one route write |
| 7:50 | **Capstone (20)** | Prove the full journey with its trace and all eight §2 checks. Change Elastic evidence and observe follow-up; restore the governed fixture. Change authority and observe allow/deny without rewriting the agent. | Completed business outcome, correlated evidence, and a result for every control check |
| 8:10 | Show & tell, forking guide, Q&A | 3 attendee demos (one remote). Point to FORKING.md. | — |
| 8:30 | Close | — | — |

TAs: one per partner during their module + one Arcade floater all night + one chat monitor for
remote. Each TA carries RECOVERY.md. The Arcade presenter owns the entire Elastic-to-Arcade
connection step in Module 3. There is no later Arcade setup segment inside Elastic's module.

Module 3's rehearsal targets are **15 minutes to connect**, **15 to prepare and activate
governed actions**, **20 for the full Slack approval and continuation**, and **5 to inspect
controls and hand off**. These add to 55 and include signup/setup. Record actual elapsed
times before advertising ease of setup. If they do not fit, improve the supplied tooling
and teaching path; the full workflow and equal partner allocations remain the requirement.

## 5. Readiness gates (how we know it is A+ before Oct 8)

| Date | Gate | Pass criteria |
|---|---|---|
| Sep 18 | **Loop works** | Local contract tests green; one person runs §2 beats 1–6 through real services, including a delayed Slack approval, authenticated decision, and resumed original action with one write; Spike 04 S4.1–S4.9 closed. Beats 7–8 remain due Sep 25. Speaker cards in. |
| Sep 25 | **Cold-start test** | Someone outside the build team starts with a fresh machine and no partner accounts, follows Modules 1–3 in order, and meets each 55-minute budget including signup. Record time, manual steps, retries, and assistance for the first connected answer and full approval loop. Confirm the same project, same agent definition, and gateway continue through the stages. All eight capstone beats pass on participant-owned deployments with distinct requester/approver identities. Separately test fallback credential delivery/retrieval and record mutation coverage as degraded. Every stumble becomes a RECOVERY entry. |
| Sep 28–Oct 2 | **Dry runs** | Each speaker owns only their section's setup and passes its handoff within the §4 budget. One shared call runs the entire attendee path, including account creation, setup, and capstone. Include a remote attendee. |
| Oct 1 | **Repo public** | README/DESIGN/module guides/arrival checklist/RECOVERY/FORKING final; every advertised command exists and passes; prereqs on Partiful. Retain honest limitations if a gate is not met. |
| Oct 6 | **Prep call** | Headcount to Elastic; AV program feed confirmed or capture card packed; Slack access rechecked; day-of model credentials ready. |
| Oct 7 | **Tech check at Elastic** | Stream from the room; 2 laptops run `doctor` + full capstone on venue wifi; `reset` run once; recheck the shared fallback endpoint and handed-out credential path. |

## 6. Copy to reconcile (brief → build)

- Lead with the full integration promise: build a Mastra agent, connect Elastic evidence
  through Arcade, and complete a governed action with Slack approval and agent continuation.
  Use the same example in the event page, speaker abstracts, README, and kickoff.
- Storyline paragraph: "$95K discount on a deal" → "route a $95K inbound opportunity."
- Act 2: "AE's $95K exceeds their $50K authority… VP" → "SDR's $95K route exceeds $50K
  authority; approved by the *sales manager* (minimum-sufficient), not the VP."
- Act 3: "deal record contains a bank account number" → "lead record contains a personal
  phone number."
- Act 4: "seeded CRM note" → "inbound form message."
- Elastic abstract (now Module 2): "deal records and call notes" → "account context: trial activity,
  docs visits, security questions, prior ACV estimate."
- Open item "loan domain swapped for deals" → "swapped for leads" (done in this repo).
- Emmit's abstract: "over-limit approval" → "over-authority route."
- Agenda and partner abstracts: Mastra → Elastic → Arcade; signup inside each section.
  Arcade's abstract includes the first connected answer, adding actions to the same gateway,
  and the complete human approval loop. Preserve the 55-minute allocation per partner.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| First payoff is buried in service setup | Measure the Elastic-only answer first; use a guided launcher for the action system and demonstrate the same agent/gateway gaining governed tools |
| Slack message arrives but the agent never completes the action | Persist the pending action, test an authenticated decision after the initial request ends, resume the same request, and prove one business write under duplicate callbacks |
| Wifi can't take 100 clones/downloads | Offer optional advance download, provide a repo zip, and rehearse laptop/toolchain recovery for supported operating systems. Do not assume one copied node_modules works everywhere. |
| Signup/provisioning exceeds the section budget | Fresh-account rehearsal; provision early during the owning section; TAs handle account failures while teaching continues; use §8 fallback with explicit limitations |
| Simultaneous signup/provisioning or shared fallback load | Rehearse 5–10 concurrent attendees during dry runs; record provisioning, hosting, OAuth/Slack, and fallback limits. This sample does not prove capacity for every registrant; publish the supported hands-on capacity and fallback plan from measured results. |
| Elastic one-day API key expires | Mint during Module 2; document renewal for rehearsals and use after the event |
| Toolkit name mismatch kills policy (spike 02) | `doctor` reads names off the wire and diffs against policy file |
| Hook timeout or inactive extension | D7 gateway-side fail-closed configuration; activation readback and known-deny probe; include a hook-outage drill |
| Slack approval doesn't render for remote attendees | Remote attendees join same workspace; TA monitors |
| Speaker no-shows | Arcade can teach Module 1 from worksheet; Elastic module has a recorded fallback from dry run |
| Attendees without a model credential | Provide the day-of credential path during Mastra setup; verify configuration/restart instructions in rehearsal |
| Slack setup/refresh fails | Create the workshop workspace before the cold-start test; rehearse fresh authorization, solo self-DM delivery, switching to the authenticated approver role, and a token older than 12 hours; document recovery |
| Upstream drifts before Oct 1 | D8 remote + recorded base SHA; cherry-pick governance fixes weekly |

## 8. Elastic MCP integration — the unverified critical path

Everything above assumes Elastic's Agent Builder MCP server sits behind the participant's
Arcade gateway and is governed like the Lead toolkit. That has **not been measured**. Spike 02
proved hooks fire for *a* Remote MCP server (a probe we wrote); it did not touch Elastic.
Module 3 and the capstone depend on this, so it is the first thing to build.

### What exists

- `scripts/seed-elastic.ts` + `elastic/fixtures/account-context.json`: 8 events across
  5 leads, including 4 for `LD-2291`, in `gtm-account-context` (strict mapping, plain `text` fields — no
  `semantic_text`, so nothing is actually semantic yet).
- `elastic/README.md`: the intended path (API key with scoped role → MCP URL → Remote MCP
  in Arcade → Arcade Headers gateway). Written from docs, not from a working run.
- `apps/web` Mastra route: connects to `https://api.arcade.dev/mcp/{gateway}` and hands all
  discovered toolsets to the agent. Elastic-agnostic; it will pick up whatever the gateway
  exposes. Its current prompt requires Lead first, so the Elastic-only teaching stage needs
  an explicit capability-aware path. The route also has no persisted approval continuation.

### Spike 04 — Elastic Agent Builder MCP through Arcade (target 2026-09-12)

Stand up one Serverless project, register its MCP server in one Arcade project, connect from
Mastra, and record answers to each of these. Every one changes either the policy file, the
fixture, or the participant guide.

| # | Question | Why it matters | Current guess |
|---|---|---|---|
| S4.1 | What `serverInfo.name` does Agent Builder return, and what toolkit name does Arcade derive (spike 02 normalisation strips `mcp`/`server`)? | Every `/access`, `/pre`, `/post` rule is keyed on it. | Unknown — could be `Kibana`, `ElasticAgentBuilder`, … |
| S4.2 | How are dotted tool IDs (`platform.core.search`) surfaced over MCP and in Arcade's FQN? | Arcade uses `.` as the toolkit/tool separator and spike 02 showed a bad segment is a *parse* error. LLM APIs also restrict tool names to `[A-Za-z0-9_-]`, so Elastic likely renames on the wire. | Probably `platform_core_search`; must confirm the `/pre` payload's `tool.name`. |
| S4.3 | ~~Does Arcade's Remote MCP registration accept a static header?~~ **Answered 2026-09-08 from docs:** Arcade supports "Custom headers" with `${secret:NAME}` values alongside OAuth2. | Module 2 creates the read-only Elastic key; Module 3 stores it as an Arcade secret and sets `Authorization: ApiKey ${secret:ELASTIC_MCP_KEY}`. | Confirm on a live registration during the spike; docs-only so far. |
| S4.4 | What does the full catalog look like over MCP? | MCP exposes the available Agent Builder catalog; contents vary by deployment, permissions, and feature flags. The integrated agent needs only the selected retrieval tools. | Curate in the Arcade gateway + `/access` allow-list. Module 3 compares the measured full catalog with the curated set; do not promise a fixed catalog size. |
| S4.5 | What is the result shape of `platform.core.search` / `execute_esql`? | `/post` has to rewrite it for the redaction-on-search-results beat. | Unknown; likely text blocks with hit summaries. Fixture needs a doc carrying a phone number or an injected instruction. |
| S4.6 | Does `platform.core.search` do semantic retrieval on our index, and what does it need? | "Grounding" should be more than keyword match. | Add a `semantic_text` field (`content_semantic`) using the default inference endpoint; Serverless ships `.elser-2-elasticsearch`. Update mapping + seed. |
| S4.7 | Does the scoped API key (`read` on one index + Agent Builder read privileges) actually let MCP `initialize` and `platform.core.search` succeed? | The README's role descriptor is untested. | Probably needs more Kibana privileges than listed. |
| S4.8 | Latency of native search, gateway search, each hook, and discovery fan-out. | Spike 02 saw repeated `/access` calls including a large catalog. Agent Builder search can also involve a model call. Tool latency and hook timeout are separate budgets. | Measure each stage; verify explicit hook timeout/failure settings and an outage drill. |
| S4.9 | Fresh-trial path: signup → provision → seed → native search → MCP credential/URL — how long, what friction (card, email verification, provisioning wait, default LLM connector)? Then measure Arcade signup → registration → the same Mastra agent's first cited result. | Each partner has 55 minutes including teaching and setup; Module 3 owns the connection. Record elapsed time, manual steps, retries, and assistance per owner. Rehearse expanding that gateway to the full approval workflow. | Unknown until measured. Improve setup tooling and rehearse again if it consumes the budget; keep the full workflow and equal partner times. Record fallback use as degraded. |

Output: `docs/spikes/04-elastic-agent-builder-mcp.md` with the measured toolkit name, wire
tool names, auth path, catalog list, result payload, timing, and a redacted environment example.
Keep working credentials local and out of the report. The README and
`elastic/README.md` get rewritten from that, not from docs.

### How attendees will actually add Elastic MCP (the procedure)

What is scriptable and what is clicks, from the Arcade OpenAPI spec (`/v1/swagger`, checked
2026-09-08) and the docs:

| Step | Section owner | Where / implementation status |
|---|---|---|
| Create Elastic Serverless project | Elastic, Module 2 | Elastic signup and project UI; rehearse on a fresh account |
| Seed fixture and prove native retrieval | Elastic, Module 2 | `bun run elastic:seed` exists; search/aggregation in Elastic |
| Mint read-only MCP API key and copy Kibana MCP URL | Elastic, Module 2 | Documented Elastic API/UI; proposed `elastic:key` helper is not implemented |
| Store MCP key as an Arcade secret | Arcade, Module 3 | Arcade secret configuration; guide needs live verification |
| Register Remote MCP server (URL + custom header) | Arcade, Module 3 | Dashboard-only in the spec/CLI inspected; capture screenshots during Spike 04 |
| Curate an Elastic-only gateway and connect the existing Mastra agent | Arcade, Module 3, first checkpoint | Gateway API/client exist; proposed helper and Elastic-only agent stage are not implemented |
| Ask the saved Northwind question; compare citations with Module 2 | Arcade, Module 3, first checkpoint | Verify real tool calls and source IDs against the clean fixture; record time and connection changes |
| Deploy public services and configure persona OAuth | Arcade, Module 3, action setup | Render blueprint exists; guided launcher and checkpoints still to complete |
| Deploy Lead and Approvals toolkits and authorize Lead/Slack | Arcade, Module 3, action setup | `arcade deploy`; Approvals implementation still required; keep action tools out of the gateway until controls are active |
| Register, activate, and check fail-closed hooks | Arcade, Module 3 | Hooks API exists; proposed `arcade:hooks` helper is not implemented |
| Expand the same gateway and verify the full approval/continuation loop | Arcade, Module 3 | Rediscovery must expose only the authorized catalog; persisted continuation, UI, and full live acceptance are not implemented |

Remote registration is an Arcade-owned dashboard step. Do not claim the whole setup is
automated: signup, hosting, and OAuth also require rehearsed user actions. Tool curation
happens in the gateway, so the proposed gateway helper should select the measured tools
consistently for every attendee.

Toolkit naming caveat carried from spike 02: Arcade's docs say tools are addressed as
`{server-id}.{tool}`; measured behaviour is a normalised `serverInfo.name`. S4.1 settles which
the policy file uses. Until then, `doctor` reads the name off the wire and the policy loader
refuses to start on a mismatch.

### Design decision — governed retrieval vs Mastra memory

The brief's Elastic module ("hybrid search and semantic recall as agent memory") comes from Elastic's
Mastra integration, which is `@mastra/elasticsearch` as a **vector store the agent talks to
directly**. That contradicts DESIGN.md ("the agent does not receive `ELASTICSEARCH_URL`").
Two different things are being conflated:

- **Business-data retrieval** (account context, prior ACV, intent signals) → Elastic Agent
  Builder MCP through the Arcade gateway. Governed, audited, redactable. This is the core of
  Module 3 and the capstone.
- **Agent memory** (conversation recall) → Mastra Memory on `@mastra/elasticsearch`. Agent-
  owned state, not a tool call, so it cannot pass through a tool gateway.

Keep native retrieval as Module 2's core and governed MCP as Module 3's integration.
Memory is an optional follow-on outside the timed core, on a **separate index and separate key**, with the boundary
said out loud on stage: "memory is the agent's own notebook; account data is someone else's
system, and that is what needs the gateway." Confirm with the Elastic speaker — it is their
module.

### Elastic evidence across the sections

1. **Module 2, Elastic:** sign up, provision, seed, and inspect the index. Run native search
   for Northwind; show the four source events and their IDs.
2. **Module 2, Elastic:** aggregate product-usage accounts over the explicit fixture window
   `2026-08-20` through `2026-09-01`. The current events are in August, so "last 14 days"
   relative to October 8 is an empty query. Do not claim an open-lead count without joining
   the lead system's status data.
3. **Module 2 handoff:** obtain the Kibana MCP URL and separate scoped read-only credential.
   Retain the setup write key through the later re-seed/reset exercises; revoke afterwards.
4. **Module 3, Arcade:** register the MCP server, observe wire names, curate an Elastic-only
   gateway, and connect the existing Mastra agent. Ask the saved Northwind evidence question
   and compare citations with Module 2 before adding action systems.
5. **Module 3, Arcade:** enable and verify the controls, then add the governed Elastic fixture
   variant and Lead/Approvals to the same gateway. Complete research, denial, Slack request,
   authenticated approval, and resumed action. Inspect filtered Elastic/Lead results at the
   Mastra model boundary, using the measured payload shapes.
6. **Capstone:** add an enterprise-contract event, ask again, and observe the cited change
   from routing to follow-up. Restore the governed eight-event fixture and baseline action
   state before the control checks. Reset must remove the added event; re-indexing the
   original IDs alone does not do so. Restore clean data before starting a fresh workshop.

### Fallback

If an attendee cannot get a trial provisioned (signup friction, corporate email blocks, day-of
outage), Arcade runs one shared **read-only** Elastic MCP over the same fixture and hands out a
key. The fixture contains no real people, so the "no shared cluster" rule (D5) can bend for
this degraded mode. Their gateway is still their own, so governance stays per-attendee.
The shared credential cannot support participant writes. Keep its fixture clean throughout
the workshop so late-arriving connections do not receive the adversarial variant before
their filters are active. A presenter demonstrates evidence changes and the adversarial
Elastic variant on their own deployment. Record those attendee checks as degraded. Attendees
can still complete retrieval and their own Lead/Slack approval and governance exercises.

## 9. Numbers are ours to pick

The $50K / $95K thresholds are inherited from upstream's loan amounts. Nothing depends on
them. Choose values that make three things unmistakable on a projector:

1. The gap between authority and request is obvious at a glance.
2. Riley is the *minimum-sufficient* approver and Morgan is visibly not bothered.
3. One live policy edit (raise Dana above the lead) flips the outcome, and lowering it flips
   it back.

Optional twist that makes Elastic consequential *and* reinforces D2: the inbound form
understates the deal (say "$30K, small team") while Elastic's prior ACV estimate and usage
say enterprise. The authoritative ACV on the lead record is the higher number, so the
model's lowball never reaches the policy check. Before releasing partner copy, settle any
number change and reconcile `leads.json`, DESIGN.md, worksheets, and speaker abstracts. The
Elastic fixture's prior estimate is an $85K–$110K range supporting the $95K record value;
it does not need to duplicate that point value. Keep those facts consistent if they change.

## 10. Immediate next actions (this week)

1. **Spike 04 (§8)** — stand up one Serverless project, register Agent Builder MCP in
   Arcade, answer S4.1–S4.9. Blocks the policy file, fixture, and measured module setup guides.
2. Add `upstream` remote and record base SHA in DESIGN.md.
3. Implement P0 hooks (`/access`, `/pre`, `/post`) with the D2 authoritative-ACV lookup.
4. Implement approvals toolkit against the spike 03 Slack pattern.
5. Build the per-attendee agent teaching stages, first-connection checkpoint, and guided Arcade
   launcher; implement persisted approval continuation and its visible end-to-end trace.
6. Write local contract tests and record separate real-service acceptance evidence.
7. Prepare reconciled copy (§6) for Partiful and partner speaker abstracts.
