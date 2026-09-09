# Coming to the workshop

Bring a laptop, charger, access to email for verification, and permission to install
software. Onsite and remote attendees follow the same **Mastra → Elastic → Arcade**
sequence, with **55 minutes per partner including signup and setup**, followed by a
20-minute capstone.

You will sign up for Mastra in its section, create your Elastic project in the Elastic
section, and create your Arcade project and gateway in the Arcade section. No partner
account, completed deployment, or API key is required before arrival.

## Tools

Optional downloads can save time. The commands in this repo use a Bash-compatible shell
and the following toolchain:

| Tool | When used | Installation reference |
|---|---|---|
| Git | Clone/fork the workshop in the Mastra section | [Git](https://git-scm.com/downloads) |
| Bun 1.3.14 | Install dependencies and run workshop commands | [Bun](https://bun.sh/docs/installation) |
| Node 22 | Build and serve the web app | [Node](https://nodejs.org/en/download) |
| Python 3.11+ and uv | Deploy the single Sales toolkit in the Arcade section | [uv](https://docs.astral.sh/uv/getting-started/installation/) |

The complete Windows path has not been rehearsed. Windows attendees should use the
[Arcade Windows setup guide](https://docs.arcade.dev/en/get-started/setup/windows-environment)
with a TA; shell syntax in this repo may need adaptation. Record the operating system and
any setup help during the [fresh-account rehearsal](TESTING.md).

## Accounts and costs

You need GitHub access for your fork and Render access for your four supporting services.
Those are introduced with the relevant workshop steps. The model also needs a provider
credential; Mastra signup alone does not supply one. The organizer must confirm model-key
or credit distribution before the event.

The default Arcade path deploys one custom toolkit, **Sales**. Elastic uses its native
Remote MCP server, and the app handles approval requests and decisions. This reduces the
custom deployment count; it does not make model usage, Elastic, or Render hosting free.
Review the services and billing shown by each provider during setup. The checked-in Render
configuration uses paid compute and persistent disks.

Thierry supplies the workshop Slack workspace and invite. Join with your existing Slack
account. Dana uses your Arcade account email; Riley is a separate seeded demo identity.
You can request as Dana and approve as Riley without another person or extra email inbox.
The approval notification arrives in your own Slack self-DM.

## Start here

1. [Mastra: build your first agent](modules/01-mastra.md).
2. [Elastic: prepare the account evidence](modules/02-elastic.md).
3. [Arcade: connect and govern](modules/03-arcade.md).
4. [Capstone: inspect the full workflow](modules/04-capstone.md).

The organizer must publish the Slack invite, model-credential arrangement, and remote
support link before delivery. The [testing guide](TESTING.md) is the rehearsal checklist.
