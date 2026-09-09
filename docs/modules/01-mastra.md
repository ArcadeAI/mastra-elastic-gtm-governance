# Module 1: Mastra, start the Northwind journey

**Owner:** Mastra presenter. **Budget:** 55 minutes, including signup and setup.

**Guide status:** this worksheet uses the at-risk renewal revision; record current results.
Earlier workshop tests do not certify this revision. Fresh-account Mastra signup and the 55-minute teaching path still need rehearsal.
Use [Testing](../TESTING.md) to record the result.

## Your result

Your Mastra project runs the agent that will later research and prepare Northwind's renewal offer.
It will also draft a customer follow-up grounded in the evidence, without inventing a fix
date or a cause for declining usage.
Start with a sanitized supplied account for `ACC-2291` and ask:

> What puts Northwind's renewal at risk, and what should we verify before offering the requested 30% discount?

The agent separates what the supplied request tells you from the evidence still needed. Save this
question and run: Elastic will supply that evidence, and Arcade will connect it to this
same agent before adding the full Slack approval loop.

## Build together

1. Sign up for Mastra and create your project with the presenter. Set up GitHub access and
   open this repository. Run the starter locally using the commands below; the Render
   deployment is introduced during the Arcade section.
2. Configure the workshop model credential. Keep it in local environment configuration or
   the project's secret settings; do not commit or paste it into chat.
3. Run the starter in supplied-input mode on the sanitized Northwind account. Ask the question
   above and inspect the response. This mode uses only the supplied text; live account
   retrieval and offer creation arrive later.
4. Open `apps/web/lib/lead-agent.ts` and change the supplied-stage instructions, such as
   requiring separate facts and unanswered questions. Run the same sample again in the
   workshop UI. Save the question, answer, and evidence gaps in your own notes for the next
   sections. This local UI does not automatically upload runs to Mastra Cloud.

## Checkpoint and handoff

You have a Mastra account/project, a successful Northwind response in the local workshop
UI, and a copy of that answer in your notes. This checkpoint must pass with Arcade and
Elastic credentials absent. The answer
describes the sanitized supplied input and identifies missing evidence; it does not claim
to have retrieved or cited a live business system.

Keep this project and question for [Module 2 — Elastic](02-elastic.md). You investigate the
evidence in Elastic's own interface next. In Module 3, Arcade connects that evidence to the
same Mastra agent, then expands its gateway with the tools for discount offers and human approval.

## Run and inspect

From the repository root:

```sh
bun install --frozen-lockfile
test -f .env || cp .env.example .env
# Set MODEL_ID and the matching provider key in .env.
bun run doctor --stage supplied
bun run dev:web
```

Open `http://localhost:3000`. Select **Build your agent**, enter the saved question, and
select **Run your agent**. No identity-service login is required at this stage.
**Inspect available tools** returns an empty list, as expected for supplied input.
The supplied sample and editable agent instructions live in `apps/web/lib/lead-agent.ts`.

A model configuration check reports configured values, not a successful model response.
Keep the actual response as the checkpoint. If the provider rejects the request, check the
matching API key and model ID, then rerun the same question.

Use Node 22 for the deployed web service and Bun 1.3.14 for repository commands. Run the
production build with Node 22 active using `bun run --cwd apps/web build`. A fresh-account
rehearsal must still confirm signup, model-credential distribution, OS setup, and elapsed time.

References: [Mastra getting started](https://mastra.ai/docs),
[Mastra platform](https://mastra.ai/docs/mastra-platform/overview).
