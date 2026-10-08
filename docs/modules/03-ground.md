# Module 3 — Ground it, governed (Elastic)

**Start from:** where module 2 left off, with modules 1 and 2 done. There is nothing to check
out: the Elastic module has been in the code since module 1, switched off. **Joining late?**
`git checkout module-3-ground` gives you the code; see "If you are behind". **Owner:** Elastic.
**45 minutes.**

You leave with the deal book indexed in Elasticsearch, the agent searching it by keyword
and by meaning and running aggregations from chat, and every one of those results passing
through the same three hooks a write does.

## What you build

1. Put Alice back where module 3 needs her. Module 2 ends by raising her clearance; above
   250,000 she sees customer identifiers, and the search redaction this module shows never
   fires for her. Set her back, and check the cast:

       bun run users set-clearance <alice's email> 50000
       bun run users list

   Alice at 50,000 and a user with role `cro` (Michael): the seed in step 4 runs as him.
2. An Elasticsearch Serverless project ([sign up](https://ela.st/arcade)), and an API key
   scoped to `deal-files*`. If you started the sign-up at module 2's handoff, the project is
   ready. `elastic/README.md` → Setup has the exact key request, and what Serverless leaves
   out. Leave `ELASTIC_INFERENCE_ID` blank: `semantic_text` then uses the project's default,
   `.jina-embeddings-v5-text-small` on the Elastic Inference Service.
3. Four lines in `.env`:

       ELASTIC_MODULE=on
       ELASTICSEARCH_URL=<your project's Elasticsearch endpoint, with :443>
       ELASTICSEARCH_API_KEY=<the encoded value the key request returned>
       ELASTIC_SEED_USER=<Michael's email>

   Then `bun run setup-arcade <APP_PUBLIC_HOST>` again. It uploads the two Elasticsearch
   secrets to your Arcade project, and adds the 26 Elasticsearch tools to the gateway modules
   1 and 2 made, keeping its six and its User Source, and reads it back. Nothing to deploy:
   the tools shipped in module 1's one `arcade deploy` and have sat idle without a cluster to
   call. Restart the app (`bun run dev`, or `bun run up`). No new gateway, no new
   authorization. (You can set the two secrets in the Arcade dashboard instead; if you do,
   check the project switcher shows the project `arcade whoami` names, not "Default project".)
4. `bun run seed:elastic`: the eight deals into `deal-files`, through Arcade, as Michael.
   A refusal here is act 1 working — nobody else can see `ElasticCreateIndex`.
5. As Alice:
   > Which requests mention procurement?

   > Which accounts did the deal desk think were carried by a single team or product?

   > Total discount requested by status.

   > Use ES|QL to show me the ten most recent requests.

   Keyword search finds the word; semantic search on `crm_notes_semantic` (Jina embeddings)
   finds the meaning, and ranks `DL-2296`, *"Product-led growth carries the account"*, first;
   ES|QL answers the aggregate; and an ES|QL query with no `KEEP` clause is refused at
   `/hooks/pre` until the model adds one, which it does on the retry. (A model that writes
   the `KEEP` first time, as it often does once it knows the fields, is never refused: the
   rule checked and had nothing to object to.) Which search tool the agent picks varies from
   run to run; every one of them goes through the same rules.

## What to look at

- `elastic/seed.ts` → `MAPPINGS`: `copy_to` writes each CRM note once and indexes it twice,
  as BM25 text and as a `semantic_text` field that names no model.
- `mcp/deal_desk/elasticsearch.py`: each of the 26 tools is one Elasticsearch REST call.
- `gate/policies/governance.json` → the `$TOOLKIT` `Elastic…` rules: nine access rules on the
  write tools, three pre rules on ES|QL and aggregations, two post rules on `hits[].source`.
  Nothing in `gate/engine` changed for retrieval: it needed no new primitive, only rules.
- `app-test/control-plane/elastic-post.test.ts`: the four acts over a search result,
  measured against the seeded rules.

## Checkpoint

Acts 3 and 4 fire on a search hit for DL-2291: identifiers masked for Alice, intact for
Charlie, the pasted note gone for everyone.

## If you are behind

`git checkout module-3-ground` gives you the code. Then re-run
`bun run setup-arcade <APP_PUBLIC_HOST>`, which checks every step and fills in only what is
missing; check `bun run users list` as in step 1; and restart the app. The index needs your
own cluster; a TA can lend a read-only key to a shared one for the rest of the session, but
seeding is yours.

## Handoff

To the capstone, when every laptop has the four search prompts answering through the hooks.
