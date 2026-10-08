# Before the workshop: setup

**Setup** · [Module 1 · Build](./01-build.md) · [Module 2 · Govern](./02-govern.md) · [Module 3 · Ground](./03-ground.md) · [Capstone](./04-capstone.md) · [Presenters](./PRESENTERS.md) · [Agent prompt](./AGENT-PROMPT.md)

Do this before you arrive. It is about twenty minutes, most of it signups, and every
account is yours. Use **one email for everything**: the Slack lookup and your Arcade project
have to agree on who you are.

## 1. Tools on your laptop

| Tool | Install | Check |
|---|---|---|
| [Bun](https://bun.sh) | `curl -fsSL https://bun.sh/install \| bash` | `bun --version` |
| [uv](https://docs.astral.sh/uv/) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `uv --version` |
| Arcade CLI | `uv tool install arcade-mcp` | `arcade --version` |
| [ngrok](https://ngrok.com/download) | `brew install ngrok` (or the download) | `ngrok version` |
| git | you have it | `git --version` |

No Python setup of your own: the Arcade CLI brings what the one deploy needs. Already have
the Arcade CLI? Run `arcade update` first.

## 2. Accounts, one email

1. **Arcade.** Sign up at [arcade.dev/free](https://arcade.dev/free), create a
   project of your own (not the default), create an API key in it. Then in a terminal:

       arcade login
       arcade project list
       arcade project set <that project's id>
       arcade whoami          # shows your email, your org and that project

   If your account has more than one org, `arcade org set <org_id>` first. The email
   `arcade whoami` shows has to be the one you use everywhere else; if the CLI is still
   signed in as another account, `arcade logout && arcade login`.
2. **ngrok.** Sign up, add your authtoken (`ngrok config add-authtoken …`), and claim your
   free static domain under *Domains*. Keep its host, like `my-name.ngrok-free.app`.
3. **Slack.** Accept the host's invite to the workshop workspace with the same email. You
   should land in `#deal-desk-approvals`. If you did not, join it.
   **Cannot join?** Put `SLACK_NOTICE=off` in `.env` before the first `bun run workshop`.
   Everything runs; the escalation in module 2 then sends no Slack message, and the approval
   link is on the chat card instead.
4. **Elastic** (module 3, you can do it the morning of). Sign up for
   [Elastic Cloud Serverless](https://ela.st/arcade). The project itself is created in
   module 3, so stop at the account.

The Anthropic key is the host's, shared in the room.

## 3. The repo

    git clone https://github.com/ArcadeAI/mastra-elastic-gtm-governance
    cd mastra-elastic-gtm-governance
    bun install
    cp .env.example .env

Six lines in `.env`:

| Line | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | the host, on a slide |
| `ARCADE_API_KEY` | your Arcade project |
| `APP_PUBLIC_HOST` | your ngrok host, no `https://` |
| `SLACK_APPROVALS_CHANNEL` | the host, on a slide |
| `WORKSHOP_EMAIL` | you, the same email as everywhere above |
| `WORKSHOP_APPROVER` | the host, on a slide |
| `SLACK_NOTICE=off` | only if you could not join the Slack workspace |

The first three are blank at the top of `.env`. The rest ship commented out further down,
under *Optional*: delete the leading `# ` on each line you fill in, or its value is ignored.

Then one command, and you are at module 1 step 4:

    bun run workshop

The first run deploys and takes about four minutes. It prints a URL; open it, click through
ngrok's one-time page, sign in with your email and the password `password`, and authorize the
gateway when asked. The first time the agent calls a deal tool, it asks once more, for the app's
own sign-in: authorize it, then use **Continue**. Every person you sign in as does both, once.
That is the whole setup.

## 4. If something is off

| It says | Do |
|---|---|
| `arcade whoami` shows the wrong project | `arcade project set <id>` |
| `workshop: fill these in .env first: …` | fill the named lines |
| `ERR_NGROK_334 … already online` | an older tunnel of yours is up: `pkill -f "ngrok http"` |
| the deploy fails | run `bun run workshop` again; it resumes from what exists |
| the sign-in page says the password did not match | it is `password` unless you set `WORKSHOP_PASSWORD` |
| `bun install` ends with `Failed to install N packages` | run `bun install` again; it fetches only what is missing |
| an `arcade` command says `Failed to refresh token … 400 Bad Request`, while `arcade login` says you are already logged in | the saved session is stale: `arcade logout && arcade login` |
| `Port 3000 is already in use` | another app has it: uncomment `PORT=` in `.env`, set it to `3001`, and run `bun run workshop` again |
| `bun run reset` says `RESET_TOKEN is unset` | your `.env` predates the workshop writing one: run `bun run workshop` again, which writes it and restarts the app with it, then `bun run reset` |
| the app logs `authorization challenge requires URL elicitation` | expected, not a failure: a tool needs an authorization this person has not given yet, and the chat shows **Authorize** and **Continue** |
| the chat says *tool access policy service could not be reached*, the browser shows `MCPClient errored connecting to MCP server`, or the app logs `access FAILED CLOSED … hook budget` | a slow connection: Arcade's call to your laptop through the tunnel took too long, and the hook refuses rather than guess. Reload, or send the message again. On a phone hotspot, expect it now and then |

Behind at any point in the day: `bun run workshop`, then `bun run reset`.

Catching up to a module's tag: `git fetch --tags --force`, `git checkout <tag>`, `bun install`,
`bun run workshop`, then `bun run reset`, in that order.

Working with a coding agent? [`AGENT-PROMPT.md`](./AGENT-PROMPT.md) walks you through all of it.

---

**Next:** [Module 1 · Build](./01-build.md)
