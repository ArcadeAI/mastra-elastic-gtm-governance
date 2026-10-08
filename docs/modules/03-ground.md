# Module 3 — Ground it, governed (Elastic)

[Setup](./00-setup.md) · [Module 1 · Build](./01-build.md) · [Module 2 · Govern](./02-govern.md) · **Module 3 · Ground** · [Capstone](./04-capstone.md) · [Presenters](./PRESENTERS.md) · [Agent prompt](./AGENT-PROMPT.md)

**Start from:** where module 2 left off, with modules 1 and 2 done. There is nothing to check
out: the Elastic module has been in the code since module 1, switched off. **Joining late?**
`git checkout module-3-ground` gives you the code; see "If you are behind". **Owner:** Elastic.
**45 minutes.**

You leave with the deal book indexed in Elasticsearch, the agent searching it by keyword
and by meaning and running aggregations from chat, and every one of those results passing
through the same three hooks a write does.

## The short way

Steps 2 and 3 below are Elastic's: the project and the key. Then four lines in `.env`
(`ELASTIC_MODULE=on`, `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`, `ELASTIC_SEED_USER`), and:

    bun run workshop

It uploads the secrets, adds the 26 tools to your gateway, restarts the app and seeds the
index. Then step 1 if Alice's clearance was raised, and the prompts in step 6.

## What you build

1. Put Alice back where module 3 needs her. Module 2 ends by raising her clearance; above
   250,000 she sees customer identifiers, and the search redaction this module shows never
   fires for her. Set her back, and check the cast:

       bun run users set-clearance <alice's email> 50000
       bun run users list

   Alice at 50,000 and a user with role `cro` (Michael): the seed in step 5 runs as him.

   **Behind?** No Michael? The module 2 seed line adds him and keeps everyone else:
   `bun run users seed-demo --alice <your-email> --charlie <the host's approver email> --bob bob@example.com --michael michael@example.com --password <yours>`.
2. An Elasticsearch Serverless project ([sign up](https://ela.st/arcade)), the Elasticsearch
   / search use case. If you started the sign-up at module 2's handoff, the project is ready.
   Copy its **Elasticsearch endpoint** (not the Kibana URL): it is `ELASTICSEARCH_URL` in
   step 4. `elastic/README.md` → Setup says what Serverless leaves out.
3. A least-privilege API key. In Kibana → Dev Tools, run:

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

   Copy the `encoded` value from the response: it is `ELASTICSEARCH_API_KEY` in step 4. The
   key can touch the `deal-files*` indices and nothing else, which is the boundary the hooks
   sit on top of.
4. Four lines in `.env`:

       ELASTIC_MODULE=on
       ELASTICSEARCH_URL=<the endpoint from step 2, with :443>
       ELASTICSEARCH_API_KEY=<the encoded value from step 3>
       ELASTIC_SEED_USER=<Michael's email>

   Then `bun run setup-arcade <APP_PUBLIC_HOST>` again. It uploads the two Elasticsearch
   secrets to your Arcade project, and adds the 26 Elasticsearch tools to the gateway modules
   1 and 2 made, keeping its six and its User Source, and reads it back. Nothing to deploy:
   the tools shipped in module 1's one `arcade deploy` and have sat idle without a cluster to
   call. Restart the app (`bun run dev`, or `bun run up`). No new gateway, no new
   authorization. (You can set the two secrets in the Arcade dashboard instead; if you do,
   check the project switcher shows the project `arcade whoami` names, not "Default project".)
   Leave `ELASTIC_INFERENCE_ID` unset: `semantic_text` then uses the project's default,
   `.jina-embeddings-v5-text-small` on the Elastic Inference Service.

   **Behind?** Run `bun run setup-arcade <APP_PUBLIC_HOST>` again; it is the whole step. If
   the agent later says it has no search tool, the gateway was not updated: look for
   *added the 26 Elasticsearch tools* in its output, or add them in the dashboard with the
   hooks disabled, as the warning says.
5. `bun run seed:elastic`: the eight deals into `deal-files`, through Arcade, as Michael.
   A refusal here is act 1 working — nobody else can see `ElasticCreateIndex`.

   **Behind?** `bun run seed:elastic` again is safe: it keeps the index and rewrites the eight
   documents. `--reset` rebuilds the index. `bun run reset` never touches Elasticsearch.
6. As Alice:
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

`git fetch --tags --force && git checkout module-3-ground` gives you the code (a plain fetch
keeps an old tag). Then re-run
`bun run setup-arcade <APP_PUBLIC_HOST>`, which checks every step and fills in only what is
missing; check `bun run users list` as in step 1; and restart the app. The index needs your
own cluster; a TA can lend a read-only key to a shared one for the rest of the session, but
seeding is yours.

## Handoff

To the capstone, when every laptop has the four search prompts answering through the hooks.

---

**Next:** [Capstone](./04-capstone.md)
