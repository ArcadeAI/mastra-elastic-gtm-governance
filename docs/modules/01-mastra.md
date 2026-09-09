# Module 1 — Mastra: start the Northwind journey

**Owner:** Mastra presenter. **Budget:** 55 minutes, including signup and setup.

**Guide status:** the supplied-input and staged agent paths are implemented and locally
tested. Fresh-account Mastra signup and the 55-minute teaching path still need rehearsal.

## Your result

Your Mastra project runs the agent that will later research and route Northwind Robotics.
Start with a sanitized supplied lead for `LD-2291` and ask:

> What evidence supports qualifying Northwind, and what is missing?

The agent separates what the lead tells you from the evidence still needed. Save this
question and run: Elastic will supply that evidence, and Arcade will connect it to this
same agent before adding the full Slack approval loop.

## Build together

1. Sign up for Mastra and create your project with the presenter. Set up GitHub access and
   open this repository. Run the starter locally using the commands below; the Render
   deployment is introduced during the Arcade section.
2. Configure the workshop model credential. Keep it in local environment configuration or
   the project's secret settings; do not commit or paste it into chat.
3. Run the starter in supplied-input mode on the sanitized Northwind lead. Ask the question
   above and inspect the response. This mode uses only the supplied text; live account
   retrieval and routing arrive later.
4. Change one instruction, such as requiring separate facts and unanswered questions. Run
   the same sample again and inspect the result in the Mastra project. Save the question,
   the resulting run, and its evidence gaps for the next sections.

## Checkpoint and handoff

You have a Mastra account/project, a successful Northwind response, and a saved run you can
inspect. This checkpoint must pass with Arcade and Elastic credentials absent. The answer
describes the sanitized supplied input and identifies missing evidence; it does not claim
to have retrieved or cited a live business system.

Keep this project and question for [Module 2 — Elastic](02-elastic.md). You investigate the
evidence in Elastic's own interface next. In Module 3, Arcade connects that evidence to the
same Mastra agent, then expands its gateway with the tools for routing and human approval.

## Run and inspect

From the repository root:

```sh
bun install --frozen-lockfile
cp .env.example .env
# Set MODEL_ID and the matching provider key in .env.
bun run doctor --stage supplied
bun run dev:web
```

Open `http://localhost:3000`. Select **Build your agent**, enter the saved question, and
select **Run your agent**. No identity-service login is required at this stage.
**Inspect available tools** returns an empty list, as expected for supplied input.
The supplied sample lives in `apps/web/lib/agent-runtime.ts`.

A model configuration check reports configured values, not a successful model response.
Keep the actual response as the checkpoint. If the provider rejects the request, check the
matching API key and model ID, then rerun the same question.

Use Node 22 for the deployed web service and Bun 1.3.14 for repository commands. The
production build runs `bun run --cwd apps/web build`. A fresh-account rehearsal must still
confirm signup, model-credential distribution, OS setup, and elapsed time.

References: [Mastra getting started](https://mastra.ai/docs),
[Mastra platform](https://mastra.ai/docs/mastra-platform/overview).
