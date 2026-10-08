# Before the workshop: setup

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

No Python setup of your own: the Arcade CLI brings what the one deploy needs.

## 2. Accounts, one email

1. **Arcade.** Sign up at [api.arcade.dev](https://api.arcade.dev/dashboard), create a
   project of your own (not the default), create an API key in it. Then in a terminal:

       arcade login
       arcade project list
       arcade project set <that project's id>
       arcade whoami          # shows your org and that project

   If your account has more than one org, `arcade org set <org_id>` first.
2. **ngrok.** Sign up, add your authtoken (`ngrok config add-authtoken …`), and claim your
   free static domain under *Domains*. Keep its host, like `my-name.ngrok-free.app`.
3. **Slack.** Accept the host's invite to the workshop workspace with the same email. You
   should land in `#deal-desk-approvals`. If you did not, join it.
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

Then one command, and you are at module 1 step 4:

    bun run workshop

The first run deploys and takes about four minutes. It prints a URL; open it, click through
ngrok's one-time page, sign in with your email and the password `password`, and authorize the
gateway when asked. That is the whole setup.

## 4. If something is off

| It says | Do |
|---|---|
| `arcade whoami` shows the wrong project | `arcade project set <id>` |
| `workshop: fill these in .env first: …` | fill the named lines |
| `ERR_NGROK_334 … already online` | an older tunnel of yours is up: `pkill -f "ngrok http"` |
| the deploy fails | run `bun run workshop` again; it resumes from what exists |
| the sign-in page says the password did not match | it is `password` unless you set `WORKSHOP_PASSWORD` |

Behind at any point in the day: `bun run workshop`, then `bun run reset`.

Working with a coding agent? [`AGENT-PROMPT.md`](./AGENT-PROMPT.md) walks you through all of it.
