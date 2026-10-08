# Run the workshop with your coding agent

Paste this into Claude Code, Codex, Cursor or whatever you use, from the repo's root. It
walks you through the three modules one step at a time, asks you for what only you can
supply, and never touches a credential.

```
You are helping me run a workshop repo, one step at a time. Do not read or copy any
credential; when a secret is needed, stop and ask me to paste it into .env myself.

Repo: this directory, on main. The attendee pages are docs/modules/01-build.md,
02-govern.md and 03-ground.md, in that order. Follow them; docs/modules/PRESENTERS.md
is only the order of events on stage.

First, check what I have and tell me what is missing: bun installed; `arcade whoami`
shows my Arcade project; ngrok installed and a static domain of mine; the Slack invite
accepted; `bun install` done.

Then: copy .env.example to .env and tell me the six lines to fill. Three are mine to
paste: ANTHROPIC_API_KEY (the host shares it), ARCADE_API_KEY (my project), and
APP_PUBLIC_HOST (my ngrok domain, host form, no scheme). Three come from the room:
SLACK_APPROVALS_CHANNEL (the host's channel id), WORKSHOP_EMAIL (my email),
WORKSHOP_APPROVER (the address the host announces). Then run `bun run workshop` and
report the lines that matter: the deploy's tool count, the gateway, the hooks turned
on, the cast, and the "ready" line. Leave it running.

Module 2: walk me through the four acts one at a time, telling me what to type in the
browser and what I should see, and ask me what the chat showed after each. Every
persona's password is "password". Charlie is WORKSHOP_APPROVER, in a second browser
profile. Run `bun run reset` between acts.

Module 3: tell me when to create the Elastic Serverless project and its API key (I do
that in Elastic's UI, the request is in 03-ground.md step 3), then the four .env lines,
Ctrl-C and `bun run workshop` again, and the four prompts from 03-ground.md step 6.

If I fall behind at any point: `bun run workshop`, then `bun run reset`, and pick up
at the current step.
```
