# Module 3 — Ground it, governed (Elastic)

**Start from:** `git checkout module-3-ground`, with modules 1 and 2 done. **Owner:** Elastic. **45 minutes.**

You leave with the deal book indexed in Elasticsearch, the agent searching it by keyword
and by meaning and running aggregations from chat, and every one of those results passing
through the same three hooks a write does.

## What you build

1. An Elasticsearch Serverless project ([sign up](https://ela.st/arcade)), and an API key scoped to `deal-files*`.
   `elastic/README.md` → Setup has the exact key request, and what Serverless leaves out.
   Leave `ELASTIC_INFERENCE_ID` blank: `semantic_text` then uses the project's default,
   `.jina-embeddings-v5-text-small` on the Elastic Inference Service.
2. Its two secrets on your Arcade project, in the dashboard: `ELASTICSEARCH_URL` and
   `ELASTICSEARCH_API_KEY`. Nothing to deploy: the Elasticsearch tools shipped in module 1's
   one `arcade deploy`, and have sat idle without a cluster to call.
3. In `.env`: `ELASTIC_MODULE=on` and `ELASTIC_SEED_USER=<Michael's email>`, then
   `bun run setup-arcade <APP_PUBLIC_HOST>` again. It adds the 26 Elasticsearch tools to the
   gateway modules 1 and 2 made, keeping its six and its User Source, and reads it back.
   Restart `bun run dev`. No new gateway, no new authorization.
4. `bun run seed:elastic`: the eight deals into `deal-files`, through Arcade, as Michael.
   A refusal here is act 1 working — nobody else can see `ElasticCreateIndex`.
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
- `governance.json` → the `$TOOLKIT` rules: nine access rules on the write tools, three
  pre rules on ES|QL and aggregations, two post rules on `hits[].source`.
- `app-test/control-plane/elastic-post.test.ts`: the four acts over a search result,
  measured against the seeded rules.

## Checkpoint

Acts 3 and 4 fire on a search hit for DL-2291: identifiers masked for Alice, intact for
Charlie, the pasted note gone for everyone.

## If you are behind

`git checkout module-3-ground` gives you the code. The index needs your own cluster; a TA
can lend a read-only key to a shared one for the rest of the session, but seeding is yours.
