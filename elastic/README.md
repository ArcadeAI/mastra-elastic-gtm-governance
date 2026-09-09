# Module 2: Elastic, build the account context

**Guide status:** the fixture now describes discount evidence. Record current seed/read
results for this revision; earlier fixture tests do not certify it. The account/key
instructions follow Elastic's documentation. A fresh-account native search and
Elastic → Arcade → Mastra run still need live rehearsal. Use [Testing](../docs/TESTING.md).

Complete this section **at the workshop**, with the Elastic presenter. Every participant
uses their own Elastic deployment. Start with the working Mastra agent from Module 1;
this section teaches Elastic in its own interface before connecting it to that agent.

**Budget:** 55 minutes, including signup and provisioning.

**Finish with:** evidence for the same Northwind question you asked in Mastra, saved source
event IDs, and an MCP URL plus a separate read-only credential ready for Module 3. The Arcade
presenter owns connecting the gateway to your agent, then adding the governed discount offer and
Slack approval/read-back loop.

## 1. Sign up and create your Elastic project

1. [Sign up for Elastic Cloud](https://cloud.elastic.co/) or sign in to your own account.
2. Create your Elasticsearch Serverless project while the presenter introduces the fixture.
3. Open Kibana and locate Agent Builder. Record both your Elasticsearch endpoint (for
   loading data) and Kibana URL (for Agent Builder and MCP); these are different endpoints.

Elastic's native Agent Builder MCP server provides search. The normal path uses your own
deployment; [Module 2's fallback](../docs/modules/02-elastic.md#if-provisioning-fails) covers
provisioning failures. There is no custom Elasticsearch toolkit. Elastic documents native MCP for Serverless
and Elastic Stack 9.3 or later in its [MCP reference](https://www.elastic.co/docs/solutions/search/agent-builder/mcp-server).

## 2. Load the workshop context

In Kibana Dev Tools, create a short-lived setup key scoped to the dedicated fixture index:

```json
POST /_security/api_key
{
  "name": "gtm-workshop-setup",
  "expiration": "1d",
  "role_descriptors": {
    "fixture-setup": {
      "indices": [{
        "names": ["gtm-account-context"],
        "privileges": ["manage", "read", "write"]
      }]
    }
  }
}
```

The loader creates the index, writes documents, refreshes, and reads them back; reset also
deletes documents. Index-scoped `manage` permits setup/refresh operations, while `read` and
`write` cover fixture data. Keep this credential for operator exercises only.
[Elastic privilege reference](https://www.elastic.co/docs/reference/elasticsearch/security-privileges).
Copy the returned **encoded** key privately into your local `.env`:

```sh
ELASTICSEARCH_URL=https://your-elasticsearch-endpoint
ELASTIC_API_KEY=your-setup-key
ELASTIC_GTM_INDEX=gtm-account-context
```

Load the deterministic fixture:

```sh
bun run workshop seed --variant clean
```

Expect JSON with `status: "seeded"`, `variant: "clean"`, and `count: 8`. The command reads
the indexed documents back and checks their exact IDs, timestamps, and content. The fixture contains
eight events across five accounts, including four events for Northwind Robotics.

Use this clean synthetic baseline through the first integration. Privacy and adversarial
variants are introduced later in the Arcade section after the output filters are active.

The command is safe to rerun: fixture documents use stable event IDs and are replaced in
place. It does not delete additional documents you create during exercises; those cause
the exact-baseline check to fail. Keep the setup
key available through the later evidence-editing and capstone reset exercises, then revoke
it after the workshop exercises are complete. Do not use this write-capable key for the
agent's runtime MCP connection.

After the Arcade presenter has activated the verified denial and output filters, load the
governed variant:

```sh
bun run workshop seed --variant governed
```

It preserves all eight event IDs and timestamps, adding the synthetic activation token and
known instruction marker to the existing Northwind budget record. The clean variant
contains neither marker. Governed seeding requires `HOOKS_PUBLIC_HOST` and the server-side
`WORKSHOP_OPERATOR_TOKEN`; it refuses an inactive policy.

After the capstone, restore the complete exercise:

```sh
bun run workshop reset --variant clean
```

This clears exercise state through each service's own reset endpoint, preserves both IdP
OAuth clients, deletes native agent snapshots through the storage owner, restores the
account fixture and clears draft offers and decisions, and replaces **all documents in the configured
workshop index** with the eight clean events. Use a dedicated index. Elasticsearch's
[delete-by-query API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-delete-by-query)
requires `read` plus `delete` or `write` privileges; reset refreshes before verifying the
restored fixture. An unavailable owner produces an explicit incomplete reset. Full command
configuration and evidence limits are in [scripts/README.md](../scripts/README.md).

## 3. Retrieve and inspect the evidence in Elastic

Use Agent Builder in Kibana to investigate the same question saved in Module 1:

> What evidence supports Northwind's requested 30% renewal discount, and what still needs checking?

Give the native search the account and index context: Northwind Robotics (`ACC-2291`) in
`gtm-account-context`. Ask for source event IDs alongside every supported claim.

Inspect the four Northwind events and compare the answer with their `content` fields.
You should find adoption, renewal history, an unverified competitor comparison and the
buyer's stated budget. The list price is $12,000; a requested 30% discount implies $8,400.
The $9,000 competitor quote may exclude product capabilities and the budget cap is not yet
confirmed. Save the native answer and at least two supporting IDs, such as
`evt-northwind-003` for the budget request and `evt-northwind-004` for renewal/list price. Compare what you now know with the gaps in the Mastra starter's answer.
After the Arcade connection in Module 3, that same agent will answer the same question with
citations to at least two of the events you inspected here.

Next, try an aggregation:

> In `gtm-account-context`, count events by company and by event type from
> `2026-08-20T00:00:00Z` inclusive to `2026-09-01T00:00:00Z` exclusive.

The unchanged fixture has eight events: four for Northwind and one for each of the other
four companies. Each of the four event types has two events. Use this fixed window because
the fixture timestamps run from August 23–31, 2026; a live "last 14 days" filter will not
include them on the workshop date.

**Checkpoint:** you can retrieve Northwind's source events, save a cited answer to the
shared question, and explain the aggregation inside Elastic. You do not need an Arcade
account or gateway to complete this checkpoint.

## 4. Copy the native MCP URL

Elastic exposes Agent Builder at:

```text
{KIBANA_URL}/api/agent_builder/mcp
```

For a custom Kibana space:

```text
{KIBANA_URL}/s/{SPACE_NAME}/api/agent_builder/mcp
```

Copy the exact URL from **Agent Builder → Tools** when possible.

## 5. Give MCP read-only access

For the workshop, create a separate API key for the MCP connection. It should be able to
read only the fixture index and use Agent Builder:

```json
POST /_security/api_key
{
  "name": "gtm-workshop-mcp",
  "expiration": "1d",
  "role_descriptors": {
    "mcp-access": {
      "cluster": ["monitor_inference"],
      "indices": [
        {
          "names": ["gtm-account-context"],
          "privileges": ["read", "view_index_metadata"]
        }
      ],
      "applications": [
        {
          "application": "kibana-.kibana",
          "privileges": ["feature_agentBuilder.read", "feature_actions.read"],
          "resources": ["space:default"]
        }
      ]
    }
  }
}
```

The example targets the default Kibana space; use the matching space resource if your
project uses a different space. Keep the returned encoded API key private and separate
from the setup key. Module 3 covers storing and using this credential for the connection.

Serverless participants may use OAuth 2.1 instead. The workshop uses the API-key path.

## Check the native MCP connection

Save `ELASTIC_MCP_URL` and `ELASTIC_MCP_API_KEY` in `.env`. Run this from the repository
root after `bun install --frozen-lockfile`. It lists tool names and schemas directly from
Elastic without invoking a model or tool, and prints no key:

```sh
bun -e '
const { createRequire } = await import("node:module");
const require = createRequire(process.cwd() + "/apps/web/package.json");
const { MCPClient } = require("@mastra/mcp");
if (!process.env.ELASTIC_MCP_URL || !process.env.ELASTIC_MCP_API_KEY) {
  throw new Error("Set ELASTIC_MCP_URL and ELASTIC_MCP_API_KEY in .env");
}
const url = new URL(process.env.ELASTIC_MCP_URL);
const client = new MCPClient({ servers: { elastic: {
  url, allowedHosts: [url.host], forwardInstructions: false,
  requestInit: { headers: { Authorization: `ApiKey ${process.env.ELASTIC_MCP_API_KEY}` } }
} }, timeout: 15000 });
try {
  const result = await client.listToolDefinitionsWithErrors({ perServerTimeoutMs: 12000 });
  if (Object.keys(result.errors ?? {}).length) throw new Error("Native MCP discovery failed; check URL, key, space and privileges.");
  const definitions = Object.values(result.definitions.elastic ?? {});
  if (!definitions.length) throw new Error("Native MCP returned no tools.");
  console.log(JSON.stringify(definitions.map(({ name, inputSchema }) => ({ name, inputSchema })), null, 2));
} finally { await client.disconnect(); }
'
```

**Checkpoint:** the MCP inventory returns search tools, and your earlier native Agent
Builder query retrieves the actual Northwind events. Inventory alone does not prove a
successful search. A 401/403 or empty inventory means check the encoded key, space resource,
Agent Builder privileges, and expiry before the Arcade handoff. Retain the names and input
schemas for comparison with Arcade's later inventory.

## Handoff to Module 3: Arcade

Bring these to [Module 3: Arcade](../docs/modules/03-arcade.md):

- Your saved Northwind question, native search result with at least two source event IDs,
  and the `gtm-account-context` index name.
- Your Agent Builder MCP URL, including the space path if applicable.
- Your separate read-only MCP API key, kept private.

The Arcade presenter takes over for signup, remote MCP registration, credential storage,
tool selection, and connecting the gateway to Mastra. The agent will use Elastic's native
search through that gateway without receiving your Elasticsearch credentials. Your first
integrated result is the same evidence-backed answer; the same gateway then grows to include
the Sales toolkit for the discount approval and offer read-back journey. Approval requests, self-DMs, and
authenticated decisions run in the workshop app and hooks.

**Readiness caveat:** the documented API-key path still needs a live Elastic → Arcade →
Mastra interoperability check on fresh accounts. A successful native Elastic search does
not establish that the gateway connection has passed that check.

Official references:

- [Elastic Agent Builder MCP server](https://www.elastic.co/docs/solutions/search/agent-builder/mcp-server)
- [API-key authentication](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server-api-keys)
- [Built-in tools reference](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/tools/builtin-tools-reference)
