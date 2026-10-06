# Module 3 — Ground it, governed (Elastic)

**Start from:** `git checkout module-3-ground`, with modules 1 and 2 done. **Owner:** Elastic. **45 minutes.**

You leave with the deal book indexed in Elasticsearch, the agent searching it by keyword
and by meaning and running aggregations from chat, and every one of those results passing
through the same three hooks a write does.

## What you build

1. An Elasticsearch Serverless project ([sign up](https://ela.st/arcade)), and an API key scoped to `deal-files*`.
   `docs/ELASTIC.md` → Setup has the exact key request, and what Serverless leaves out.
   Leave `ELASTIC_INFERENCE_ID` blank: `semantic_text` then uses the project's default,
   `.jina-embeddings-v5-text-small` on the Elastic Inference Service.
2. The Elasticsearch toolkit on your project: `cd tools/elasticsearch && arcade deploy`, with `ELASTICSEARCH_URL` and
   `ELASTICSEARCH_API_KEY` as its secrets in the Arcade dashboard.
3. In `.env`: `ARCADE_ELASTIC_TOOLKIT=Elasticsearch` and `ELASTIC_SEED_USER=<Michael's email>`.
   An existing gateway is not edited, so blank `ARCADE_GATEWAY_ID` and run
   `bun run setup-arcade <APP_PUBLIC_HOST> --gateway <a-new-slug>`: the new gateway carries
   the 26 `Elasticsearch.*` tools with the six deal tools. Restart `bun run dev` and authorize it once.
4. `bun run seed:elastic`: the eight deals into `deal-files`, through Arcade, as Michael.
   A refusal here is act 1 working — nobody else can see `CreateIndex`.
5. As Alice:
   > Which requests mention procurement?

   > Which accounts did the deal desk think were carried by a single team or product?

   > Total discount requested by status.

   > Show me the ten most recent requests.

   Keyword search finds the word; semantic search on `crm_notes_semantic` (Jina embeddings) finds the meaning;
   ES|QL answers the aggregate; and the bare "ten most recent" is refused at `/hooks/pre`
   until the model adds a `KEEP`, which it does on the retry.

## What to look at

- The diff from `start` to `module-3-ground`. Nothing under `packages/` moved: retrieval
  needed no new primitive, only rules. `git diff start module-3-ground --stat`.
- `governance.json` → the `$ELASTIC` rules: nine access rules on the write tools, three
  pre rules on ES|QL and aggregations, two post rules on `hits[].source`.
- `app-test/control-plane/elastic-post.test.ts`: the four acts over a search result,
  measured against the seeded rules.

## Checkpoint

Acts 3 and 4 fire on a search hit for DL-2291: identifiers masked for Alice, intact for
Charlie, the pasted note gone for everyone.

## If you are behind

`git checkout module-3-ground` gives you the code. The index needs your own cluster; a TA
can lend a read-only key to a shared one for the rest of the session, but seeding is yours.
