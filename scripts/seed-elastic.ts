/**
 * `bun run seed:elastic` — the deal book into Elasticsearch, through Arcade.
 *
 *     bun run seed:elastic                  # create the index if missing, write the eight loans
 *     bun run seed:elastic --reset          # delete the index first, then the above
 *
 * ## Through Arcade, not through an Elasticsearch client
 *
 * There is no `@elastic/elasticsearch` dependency in this repo and no
 * Elasticsearch credential on this machine, on purpose. The cluster is reached
 * the way the agent reaches it: the Arcade Elasticsearch toolkit, whose two
 * secrets (`ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`) live in the Arcade
 * dashboard. This script executes the toolkit's own `CreateIndex`,
 * `BulkIndexDocuments` and `CountDocuments` tools over Arcade's tool-execution
 * API — the same call `lib/arcade.ts` makes when a person presses
 * Approve — so the seed goes through `/access`, `/pre` and `/post` like every
 * other call. That is why it runs **as the chief revenue officer**: the nine
 * write tools are hidden from every other role
 * (`access.only-the-cco-writes-the-index.*`), and a seed that ran as someone
 * who cannot see `CreateIndex` would be refused, which is the control working.
 *
 * ## What goes in
 *
 * `lib/loans/fixtures/loans.json`, one document per loan, `_id` the
 * loan id, minus the `decisions` history (a list of records is a poor fit for
 * a flat search document; `status` already carries the outcome). The customer
 * identifiers and the CRM notes go in **unredacted** — the index is a
 * second copy of the deal book, and redacting on the way in would leave
 * nothing for `/post` to demonstrate over retrieval. `DL-2291`'s planted
 * instruction is in there too, for the same reason.
 *
 * `crm_notes` is `copy_to`'d into `crm_notes_semantic`, a
 * `semantic_text` field on `ELASTIC_INFERENCE_ID` (ELSER by default), so the
 * notes are searchable by meaning with no embedding step here. Everything an
 * aggregation or ES|QL would group on is `keyword` or numeric.
 *
 * ## Idempotent
 *
 * `CreateIndex` on an index that exists is reported and skipped; the bulk
 * write replaces documents by id. Between takes nothing needs resetting —
 * the agent's Elastic tools are reads for every persona but the CCO. `--reset`
 * exists for a mapping change, which Elasticsearch cannot apply in place.
 */
import loansFixture from "../lib/loans/fixtures/loans.json" with { type: "json" };

const ARCADE_API_URL = (process.env.ARCADE_API_URL?.trim() || "https://api.arcade.dev").replace(/\/+$/, "");
const ARCADE_API_KEY = process.env.ARCADE_API_KEY?.trim() ?? "";
const TOOLKIT = process.env.ARCADE_ELASTIC_TOOLKIT?.trim() || "Elasticsearch";
const INDEX = process.env.ELASTIC_INDEX?.trim() || "deal-files";
const INFERENCE_ID = process.env.ELASTIC_INFERENCE_ID?.trim() || ".elser-2-elasticsearch";
/**
 * Who the seed runs as: `ELASTIC_SEED_USER`, the email of the person you added
 * with `bun run users` under the role `cro`. The CCO, because
 * nobody else can see the write tools. Required: there is no seeded cast in
 * this template, so there is no address to fall back to.
 */
const USER_ID = (process.env.ELASTIC_SEED_USER?.trim() ?? "").toLowerCase();

const RESET = process.argv.includes("--reset");

/** The mapping. Field types cannot change after the first write, hence `--reset`. */
export const MAPPINGS = {
  properties: {
    deal_id: { type: "keyword" },
    account_name: { type: "text", fields: { keyword: { type: "keyword" } } },
    amount: { type: "long" },
    status: { type: "keyword" },
    purpose: { type: "text" },
    requested_at: { type: "date" },
    credit_score: { type: "integer" },
    arr: { type: "long" },
    years_as_customer: { type: "integer" },
    bank_account_number: { type: "keyword" },
    tax_id: { type: "keyword" },
    crm_notes: { type: "text", copy_to: "crm_notes_semantic" },
    crm_notes_semantic: { type: "semantic_text", inference_id: INFERENCE_ID },
  },
} as const;

interface Deals {
  deal_id: string;
  decisions?: unknown;
  [key: string]: unknown;
}

/** The fixture's loans as search documents: `_id` set, `decisions` dropped. */
export function toDocuments(fixture: { loans: Deals[] }): Record<string, unknown>[] {
  return fixture.loans.map(({ decisions: _decisions, ...loan }) => ({ _id: loan.deal_id, ...loan }));
}

interface ExecuteResponse {
  success?: boolean;
  error?: { message?: string; code?: string };
  output?: { value?: unknown; error?: { message?: string; code?: string } };
}

/** One tool, executed as `USER_ID`, the way `lib/arcade.ts` does it. */
async function execute(tool: string, input: Record<string, unknown>): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const response = await fetch(`${ARCADE_API_URL}/v1/tools/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ARCADE_API_KEY}` },
    body: JSON.stringify({ tool_name: `${TOOLKIT}.${tool}`, input, user_id: USER_ID }),
  });
  let body: ExecuteResponse;
  try {
    body = (await response.json()) as ExecuteResponse;
  } catch {
    return { ok: false, message: `Arcade answered ${response.status} with something that was not JSON.` };
  }
  const error = body.output?.error ?? body.error;
  if (body.success === true && body.output?.error === undefined) return { ok: true, value: body.output?.value };
  return { ok: false, message: error?.message ?? `Arcade answered ${response.status}.` };
}

function fail(message: string): never {
  console.error(`seed:elastic: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (ARCADE_API_KEY === "") fail("ARCADE_API_KEY is unset; the seed executes tools through Arcade and carries no other credential.");
  if (USER_ID === "") fail("ELASTIC_SEED_USER is unset; set it to the email of the chief revenue officer you added with `bun run users`, the one role that can see the index's write tools.");

  console.log(`seed:elastic: ${TOOLKIT}.* via ${ARCADE_API_URL} as ${USER_ID}, index "${INDEX}"`);

  if (RESET) {
    const deleted = await execute("DeleteIndex", { index: INDEX });
    console.log(deleted.ok ? `  deleted "${INDEX}"` : `  delete skipped: ${deleted.message}`);
  }

  const created = await execute("CreateIndex", { index: INDEX, mappings: JSON.stringify(MAPPINGS) });
  if (created.ok) console.log(`  created "${INDEX}" with crm_notes_semantic on ${INFERENCE_ID}`);
  else if (/already exists|resource_already_exists/i.test(created.message)) console.log(`  "${INDEX}" exists; keeping its mapping (use --reset to rebuild)`);
  else fail(`CreateIndex refused: ${created.message}`);

  const documents = toDocuments(loansFixture as unknown as { loans: Deals[] });
  const written = await execute("BulkIndexDocuments", { index: INDEX, documents: JSON.stringify(documents), refresh: true });
  if (!written.ok) fail(`BulkIndexDocuments refused: ${written.message}`);
  const report = (written.value ?? {}) as { indexed?: number; failed?: number; errors?: unknown[] };
  console.log(`  wrote ${report.indexed ?? documents.length} documents, ${report.failed ?? 0} failed`);
  if ((report.failed ?? 0) > 0) fail(`partial write: ${JSON.stringify(report.errors ?? [])}`);

  const counted = await execute("CountDocuments", { index: INDEX });
  if (!counted.ok) fail(`CountDocuments refused: ${counted.message}`);
  const count = (counted.value as { count?: number } | undefined)?.count;
  if (count !== documents.length) fail(`expected ${documents.length} documents in "${INDEX}", counted ${String(count)}`);
  console.log(`  ${count} documents in "${INDEX}" — done`);
}

if (import.meta.main) await main();
