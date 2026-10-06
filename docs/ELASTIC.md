# The Elastic module — ground it, governed

The third partner module of the MCP4GTM workshop, on top of the template as it is.
Nothing about the business domain changes: the deal book gets a second, searchable copy in
Elasticsearch, and the agent reaches it **over MCP through the same Arcade gateway** the
deal tools are on, so every search result goes through `/access`, `/pre` and `/post`
exactly as `GetDeal` does.

Read `DESIGN.md` first. This document assumes its vocabulary.

---

## The one decision

**Elasticsearch is reached through the Arcade Elasticsearch toolkit on the workshop
gateway, not through `@mastra/elasticsearch`.**

Elastic's own Mastra example ([`elastic/mastra-elasticsearch-example`](https://github.com/elastic/mastra-elasticsearch-example))
wires `ElasticSearchVector` and `createVectorQueryTool` straight into the agent. That is
the right shape for a RAG tutorial and the wrong shape for this workshop, for one reason:
a tool the agent holds directly is a tool no hook sees. The thesis is that the controls
live outside the model, and a vector store the agent queries in-process is inside it.

So the integration is the template's existing integration, extended by one toolkit:

    this browser's session → gateway token → Mastra MCPClient (static bearer)
      → api.arcade.dev/mcp/{gateway} → /access, /pre → Elasticsearch toolkit → your cluster
                                       → /post ← the search result

MCP twice, in fact: Mastra speaks MCP to the gateway, and the toolkit itself is an
`arcade-mcp` server (`MCPApp(name="DealDesk")`, 26 tools — keyword, semantic,
vector and hybrid search, aggregations, ES|QL, and index writes).

The alternative that stays honest to the thesis is Elastic's **native Agent Builder MCP
endpoint** (`{KIBANA_URL}/api/agent_builder/mcp`) registered on the gateway as a Remote
MCP server. It is also governed, and it is Elastic's product rather than ours. It is not
the default here because its tool names are discovered per deployment rather than fixed,
and this repo's whole discipline is that a rule keyed on a name nobody measured matches
nothing. If Elastic's presenter prefers it, the swap is `docs/DOMAIN-SWAP.md`'s seam 2 in
miniature: re-measure the catalogue, keep every rule.

---

## What it adds, file by file

| | |
|---|---|
| `ELASTIC_MODULE` | `on` lists the 26 Elasticsearch tools on the gateway and tells the prompt the index exists. **Blank means off** and the agent's surface is the six deal and approvals tools. The tools are deployed either way, in the one server. |
| `ELASTIC_INDEX`, `ELASTIC_INFERENCE_ID` | The index the seed writes, the inference endpoint its `semantic_text` field embeds with. |
| `scripts/seed-elastic.ts` | The deal book into the index, **through Arcade's tool-execution API** as the chief revenue officer. No Elasticsearch client, no cluster credential on your machine. |
| `lib/control-plane/fixtures/governance.json` | The `$TOOLKIT` catalogue (26 tools, argument lists from the toolkit source) and 14 rules — see below. |
| `lib/agent/agent.ts` → `elasticFacts` | Six sentences of facts about the index, appended to the prompt only when the module is on. No behaviour, per the file's header. |
| `app-test/control-plane/elastic-post.test.ts` | The acts, over HTTP, against the seeded rules and `DL-2291` byte for byte. |

Nothing under `packages/` changed. That is the claim the module makes and the test
`packages/governance-core`'s own no-app-dependencies test keeps: retrieval needed no new
primitive.

### The rules

The same three controls the deal-book rules are, keyed on retrieval instead of a write.

| Act | Rule | What it does |
|---|---|---|
| 1 | `access.only-the-cco-writes-the-index.*` (×9) | `IndexDocument`, `BulkIndexDocuments`, `UpdateDocument`, `DeleteDocument`, `DeleteDocumentsByQuery`, `CreateIndex`, `ReindexDocuments`, `DeleteIndex`, `RefreshIndex` are absent from `tools/list` for the account executive, the analyst and the VP. The CCO sees them; the seed runs as the CCO. |
| 3 | `post.redact-identifiers-in-search-results` | `hits[].source.bank_account_number` and `tax_id` masked on every search tool, `source.*` on `GetDocument`, for clearance under 250,000. |
| 3 | `pre.esql-must-keep-named-columns`, `pre.esql-names-no-identifier-column`, `pre.aggregate-not-over-identifiers` | ES|QL rows and aggregation buckets have no field path to mask, so under the bar a query with neither `KEEP` nor `STATS`, a query naming an identifier column, or an aggregation over one is refused at `/pre` — with the fix in the denial, in the wire spelling (`DealDesk_RunEsqlQuery with query=…`). |
| 4 | `post.strip-injected-instructions-from-search-results` | The same six patterns as the deal book's rule, byte for byte, on every Elastic tool's output, for everyone. `DL-2291`'s note is the same note whether it came from the deal book or the index. |

Two consequences of the second rule pair worth saying out loud: a `/post` rule's
`match.tool` may be `*`, which is how one rule covers nine search shapes; and the on-stage
disarm is now **both** injection rules —

    sqlite3 governance.db "UPDATE output_rules SET enabled = 0 \
      WHERE id LIKE 'post.strip-injected-instructions%'"

— or `/health` keeps reporting `armed`, correctly, because the index copy would still be
scanned.

---

## Setup

### 1. An Elasticsearch Serverless project

The workshop runs on **Elasticsearch Serverless** only. [Sign up for Elastic Cloud](https://ela.st/arcade) and
create a Serverless project (the
Elasticsearch / search use case) and note the **Elasticsearch endpoint** (not the Kibana
URL).

Leave `ELASTIC_INFERENCE_ID` blank. The seed then maps `crm_notes_semantic` as a
`semantic_text` field with no `inference_id`, and Serverless fills in its default:
**`.jina-embeddings-v5-text-small`**, a dense, multilingual embedding model hosted on the
Elastic Inference Service (EIS). There is no model to deploy, no ML node to warm up and
no third-party embedding key. ELSER is still on Serverless as `.elser-2-elastic` if you
want to pin it; `DealDesk_ListInferenceEndpoints` through the gateway lists what the
project has.

#### What Serverless does not have

Elastic manages the cluster, so the cluster-level APIs are not available: every
`_cluster/*` and `_nodes/*` call, most `_cat/*` calls (`_cat/indices` and `_cat/aliases`
remain), index stats, snapshots, open/close and force merge. Three of the toolkit's 26
tools call those and will answer with Elasticsearch's own "not available when running in
serverless mode" error: **`GetClusterHealth`**, **`GetShards`** and **`GetIndexStats`**.
None of the module's prompts need them. Everything the module uses (search, semantic and
hybrid search, aggregations, ES|QL, index create/delete, bulk writes, refresh, mappings
and inference endpoints) is available.

Mint an API key scoped to the workshop index. In Kibana Dev Tools:

```json
POST /_security/api_key
{
  "name": "mcp4gtm-workshop",
  "role_descriptors": {
    "deal-files": {
      "indices": [{ "names": ["deal-files*"], "privileges": ["manage", "read", "write", "view_index_metadata"] }],
      "cluster": ["manage_inference"]
    }
  }
}
```

`manage` on the index is what `CreateIndex` and `DeleteIndex` need; `manage_inference`
lets `ListInferenceEndpoints` answer. There is no `monitor`: its only use here was
`GetClusterHealth`, which Serverless does not serve. Index-level
privileges are the real boundary. The hooks sit on top of them, not in place of them.

### 2. The toolkit on your gateway

The toolkit is in this repo, at `mcp/deal_desk/elasticsearch.py`: an `arcade-mcp`
toolkit like its siblings `loan` and `approvals`, calling the Elasticsearch REST API. It
is not in Arcade's catalog. It ships in the same `arcade deploy` as the other two,
`mcp` (`deal_desk/__init__.py` files all three under their own names in one
server), so `setup-arcade` already deployed it in module 1 and there is one deployment
in the project, not three. Its tools fail until the secrets below exist, and nothing
lists them on a gateway until step 3.

In the Arcade dashboard, with **the same project selected** as the one `arcade
whoami` shows (a new account also has a "Default project", and secrets saved there are
invisible to this one), add its two secrets:

| Secret | Value |
|---|---|
| `ELASTICSEARCH_URL` | the Serverless project's Elasticsearch endpoint, with `:443` |
| `ELASTICSEARCH_API_KEY` | the `encoded` value the key request returned |

Then put it on the gateway. `bun run setup-arcade` does this when
`ELASTIC_MODULE` is set in `.env` (step 3) **and it creates the gateway**: the tool
filter carries the 26 Elasticsearch tools alongside the six deal and approvals tools, all `DealDesk.*`.
A gateway that already exists is never edited, only checked, and the read-back names
the missing tools as a warning. If you ran modules 1 and 2 first, either add the 26
tools to that gateway in the dashboard, or blank `ARCADE_GATEWAY_ID` in `.env` and run
`bun run setup-arcade <APP_PUBLIC_HOST> --gateway <a-new-slug>`, which creates a second
gateway with all 32; restart `bun run dev` and authorize the new gateway once.

Every wire name is `DealDesk_<Tool>`: one server, one toolkit, the same prefix as the
deal tools. `ARCADE_TOOLKIT` is the one name to change if yours differs.

### 3. Turn it on

In `.env`:

    ELASTIC_MODULE=on
    ELASTIC_INDEX=deal-files

The control plane keys the `$TOOLKIT` rules on the name and defaults to `Elasticsearch`, so
the rules exist whether or not the toolkit does. The app reads it as the allow-list's third
entry, and blank is off.

### 4. Seed the index

    bun run seed:elastic            # create deal-files if missing, write the eight deals
    bun run seed:elastic --reset    # delete it first — for a mapping change

Runs as the chief revenue officer, `ELASTIC_SEED_USER` in `.env`: the email you added with
`bun run users` under role `cro` through Arcade — the person you added with `bun run users` under
role `cro`, and says what it did:

    seed:elastic: Elasticsearch.* via https://api.arcade.dev as michael@bank.example, index "deal-files"
      created "deal-files" with crm_notes_semantic on the project's default inference endpoint
      wrote 8 documents, 0 failed
      8 documents in "deal-files" — done

A refusal here is the control working — run it as anyone else and `CreateIndex` is not
in their list. The documents go in **unredacted**, identifiers and planted note included:
the index is a copy of the deal book, and redacting on the way in would leave nothing
for `/post` to demonstrate.

`ListIndices` will report more than eight documents for the index — `semantic_text`
stores chunk sub-documents alongside each deal. `CountDocuments` reports eight. Do not
put the raw number on a slide.

---

## The module, on stage

The prompts below were written against the fixture, not measured live; measure them at
the dry run and replace this sentence with what you saw, the way `RUNBOOK.md` §2 does for
the four acts.

**Keyword misses, meaning finds.** As Alice:

> Which requests mention procurement?

`DealDesk_SearchByText` on `crm_notes` finds `DL-2291` — the word is in the note.
Then:

> Which accounts did the deal desk think were carried by a single team or product?

No CRM note says "carried by a single team". `DealDesk_SemanticSearch` on
`crm_notes_semantic` (or `HybridSearch`) returns `DL-2296` — *"Product-led growth carries
the account"* — and `DL-2295`, *"one business unit is 41% of usage"*. Keyword search finds
words; the semantic field finds what the reviewer meant.

**Act 3, over retrieval.** The panel shows `post.redact-identifiers-in-search-results`
firing on the hit: `bank_account_number` and `tax_id` are `[REDACTED]` in what Dana's
model read. Sign in as Riley and ask the same thing: intact.

**Act 4, over retrieval.** Any search that returns `DL-2291` — the two above do — shows
`post.strip-injected-instructions-from-search-results` and `pattern.injected-instruction`
on the panel, and the model's reply carries the renewal date and the open SCIM case and
nothing after the paste marker. Same note, same rule shape, different tool.

**Analytics from chat.** As Dana:

> Total discount requested by status, and the average credit score of what's pending.

`DealDesk_RunEsqlQuery`, `FROM deal-files | STATS … BY status` — allowed, `STATS`
returns aggregates. Then the control:

> Show me the ten most recent requests.

The model's first attempt is usually `FROM deal-files | SORT requested_at DESC | LIMIT 10`,
which returns every column. `pre.esql-must-keep-named-columns` refuses it and the denial
tells the model to add a `KEEP`; the retry carries `KEEP deal_id, account_name, amount,
status, requested_at` and succeeds. That is act 2's mechanism — deny, instruct, retry —
on a read, with no approval in the loop because nothing needs one.

**The write tools, for the back of the room.** As Sam, ask the agent to delete the index.
It cannot: `DealDesk_DeleteIndex` is not in Sam's tool list, and the panel's access
listing shows the nine hidden entries. As Morgan it is visible, and the toolkit's own
guard refuses a wildcard pattern — two layers, and the demo says which is which.

---

## Getting back to a clean state

Nothing to do between takes: every persona but the CCO holds read tools only, so a take
cannot change the index. `bun run reset` is unchanged and does not touch Elasticsearch.
`bun run seed:elastic --reset` is for a mapping change, which Elasticsearch cannot apply
in place.

## What is not measured yet

- The live `tools/list` for a gateway carrying all three toolkits. The count in
  `DESIGN.md` → Tool surface is eight plus 26 by derivation; measure it at the dry run.
- The prompts above, against the real model. The hooks are measured
  (`app-test/control-plane/elastic-post.test.ts`); which tool Claude reaches for on each prompt
  is not.
- How the default `.jina-embeddings-v5-text-small` endpoint ranks the semantic prompts
  above compared with ELSER, against which they were first written. Rehearse both and
  replace the expected hits below with what you saw.
