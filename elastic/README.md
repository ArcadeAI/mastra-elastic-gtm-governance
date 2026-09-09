# Module 2: Elastic — build the account context

**Guide status:** draft. The fixture loader exists, but signup, the scoped key privileges,
native MCP authentication/search, and the gateway handoff still require Spike 04's measured
fresh-account walkthrough. The API examples below are sourced from documentation.

Complete this section **at the workshop**, with the Elastic presenter. Every participant
uses their own Elastic deployment. Start with the working Mastra agent from Module 1;
this section teaches Elastic in its own interface before connecting it to that agent.

**Budget:** 55 minutes, including signup and provisioning.

**Finish with:** evidence for the same Northwind question you asked in Mastra, saved source
event IDs, and an MCP URL plus a separate read-only credential ready for Module 3. The Arcade
presenter owns connecting the gateway to your agent, then adding the governed route and
Slack approval loop.

## 1. Sign up and create your Elastic project

1. [Sign up for Elastic Cloud](https://cloud.elastic.co/) or sign in to your own account.
2. Create your Elasticsearch Serverless project while the presenter introduces the fixture.
3. Open Kibana and locate Agent Builder. Record both your Elasticsearch endpoint (for
   loading data) and Kibana URL (for Agent Builder and MCP); these are different endpoints.

Elastic's native Agent Builder MCP server provides search. The normal path uses your own
deployment; [Module 2's fallback](../docs/modules/02-elastic.md#if-provisioning-fails) covers
provisioning failures. There is no custom Elasticsearch toolkit. Agent Builder MCP is generally available
on Elastic Cloud Serverless and Elastic Stack 9.3 or later.

## 2. Load the workshop context

Create a short-lived setup key that can create, read, and write only
`gtm-account-context`, then set these values in your local `.env` file:

```sh
ELASTICSEARCH_URL=https://your-elasticsearch-endpoint
ELASTIC_API_KEY=your-setup-key
ELASTIC_GTM_INDEX=gtm-account-context
```

Load the deterministic fixture:

```sh
bun scripts/workshop.ts seed --variant clean
```

Expect JSON with `status: "seeded"`, `variant: "clean"`, and `count: 8`. The command reads
the indexed documents back and checks their exact IDs, timestamps, and content. The fixture contains
eight events across five leads, including four events for Northwind Robotics.

Use this clean synthetic baseline through the first integration. Privacy and adversarial
variants are introduced later in the Arcade section after the output filters are active.

The command is safe to rerun: fixture documents use stable event IDs and are replaced in
place. It does not delete additional documents you create during exercises; those cause
the exact-baseline check to fail. The legacy `bun run elastic:seed` remains an upsert-only
loader and prints its original count message. Keep the setup
key available through the later evidence-editing and capstone reset exercises, then revoke
it after the workshop exercises are complete. Do not use this write-capable key for the
agent's runtime MCP connection.

After the Arcade presenter has activated the verified denial and output filters, load the
governed variant:

```sh
bun scripts/workshop.ts seed --variant governed
```

It preserves all eight event IDs and timestamps, adding the synthetic personal phone and
known instruction marker to the existing Northwind security record. The clean variant
contains neither marker. Governed seeding requires `HOOKS_PUBLIC_HOST` and the server-side
`WORKSHOP_OPERATOR_TOKEN`; it refuses an inactive policy.

After the capstone, restore the complete exercise:

```sh
bun scripts/workshop.ts reset --variant clean
```

This clears exercise state through each service's own reset endpoint, preserves both IdP
OAuth clients, deletes native agent snapshots through the storage owner, restores the nine
lead records and six historical decisions, and replaces **all documents in the configured
workshop index** with the eight clean events. Use a dedicated index. Elasticsearch's
[delete-by-query API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-delete-by-query)
requires `read` plus `delete` or `write` privileges; reset refreshes before verifying the
restored fixture. An unavailable owner produces an explicit incomplete reset. Full command
configuration and evidence limits are in [scripts/README.md](../scripts/README.md).

## 3. Retrieve and inspect the evidence in Elastic

Use Agent Builder in Kibana to investigate the same question saved in Module 1:

> What evidence supports qualifying Northwind, and what is missing?

Give the native search the account and index context: Northwind Robotics (`LD-2291`) in
`gtm-account-context`. Ask for source event IDs alongside every supported claim.

Inspect the four Northwind events and compare the answer with their `content` fields.
You should find trial activity, enterprise documentation visits, security and residency
questions, and the prior expansion estimate. Save the native answer and at least two
supporting IDs, such as `evt-northwind-001` for trial activity and `evt-northwind-003` for
security questions. Compare what you now know with the gaps in the Mastra starter's answer.
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
the Lead and Approvals tools for the full human approval journey.

**Readiness caveat:** the documented API-key path still needs a live Elastic → Arcade →
Mastra interoperability check on fresh accounts. A successful native Elastic search does
not establish that the gateway connection has passed that check.

Official references:

- [Elastic Agent Builder MCP server](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server)
- [API-key authentication](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server-api-keys)
- [Built-in tools reference](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/tools/builtin-tools-reference)
