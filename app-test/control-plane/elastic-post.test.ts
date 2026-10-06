/**
 * The Elastic module's three controls, over HTTP, against the real control
 * plane and the fixture as it seeds — the same way `post-redaction.test.ts`
 * proves the deal book's.
 *
 * The claim under test is the one `elastic/README.md` makes: retrieval goes
 * through the same hooks a write does, so the four acts hold over a search
 * result without a single Elastic-specific line in `packages/`. Each test
 * here is one of those acts, on the payload shape the Arcade Elasticsearch
 * toolkit actually returns (`hits[].source`, measured off its `models.py`),
 * carrying `DL-2291` byte for byte from `apps/loan-app`'s fixture.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";

import { AccessHookResult, PostHookResult, PreHookResult } from "@cg/policy-schema";

import type { HooksConfig } from "../../gate/service/config.ts";
import { createPolicyCache, type PolicyCache } from "../../gate/service/policy-cache.ts";
import { openGovernance } from "../../gate/service/policy-store.ts";
import { createServer } from "../../gate/service/server.ts";
import { loanFixture } from "./loan-fixture.ts";
import { seedDemoSubjects } from "../demo-cast.ts";

const SECRET = "test-secret";
const DANA = "alice@bank.example";
const SAM = "bob@bank.example";
const RILEY = "charlie@bank.example";
const MORGAN = "michael@bank.example";
const ELASTIC = "DealDesk";
const INDEX = "deal-files";

const config: HooksConfig = {
  port: 0,
  dbPath: ":memory:",
  signingSecret: SECRET,
  approvalsStoreToken: "test-store-token",
  toolkit: ELASTIC,
  deadlineMs: 2500,
  policyPollMs: 10,
  grantTtlSeconds: 900,
  injectionDetection: "armed",
  resetToken: "",
};

const LOAN = loanFixture("DL-2291");
const PASTE_MARKER = "\n\n--- pasted from deal review thread ---";
const LEGITIMATE_NOTE = LOAN.crm_notes.split(PASTE_MARKER)[0] as string;

/** What `DealDesk_ElasticHybridSearch` returns for a hit on DL-2291, as the seed indexes it. */
const document = () => {
  const { decisions: _decisions, ...loan } = LOAN as typeof LOAN & { decisions?: unknown };
  return loan;
};
const searchResult = () => ({
  index: INDEX,
  total_hits: 1,
  returned_hits: 1,
  hits: [{ id: LOAN.deal_id, score: 12.3, source: document() }],
});

let db: Database;
let cache: PolicyCache;
let server: ReturnType<typeof createServer>;
let base: string;
let execution = 0;

beforeAll(() => {
  db = openGovernance(":memory:", config);
  seedDemoSubjects(db);
  cache = createPolicyCache(db, { pollMs: 10 });
  cache.start();
  server = createServer({ config, db, cache, log: () => {} });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  cache.stop();
  server.stop(true);
  db.close();
});

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });

async function postHook(user_id: string, name: string, inputs: Record<string, unknown>, output: unknown) {
  const res = await post("/post", {
    execution_id: `tc_es_${++execution}`,
    tool: { name, toolkit: ELASTIC, version: "0.1.0" },
    inputs,
    success: true,
    output,
    context: { user_id },
  });
  expect(res.status).toBe(200);
  const body = PostHookResult.parse(await res.json());
  return body.override?.output as Record<string, unknown> | undefined;
}

async function preHook(user_id: string, name: string, inputs: Record<string, unknown>) {
  const res = await post("/pre", {
    execution_id: `tc_es_${++execution}`,
    tool: { name, toolkit: ELASTIC, version: "0.1.0" },
    inputs,
    context: { authorization: [{}], user_id },
  });
  expect(res.status).toBe(200);
  return PreHookResult.parse(await res.json());
}

const V = [{ version: "0.1.0" }];
const READS = ["ElasticListIndices", "ElasticGetIndexMapping", "ElasticSearchByText", "ElasticSemanticSearch", "ElasticHybridSearch", "ElasticAggregateDocuments", "ElasticRunEsqlQuery", "ElasticGetDocument"];
const WRITES = ["ElasticIndexDocument", "ElasticBulkIndexDocuments", "ElasticUpdateDocument", "ElasticDeleteDocument", "ElasticDeleteDocumentsByQuery", "ElasticCreateIndex", "ElasticReindexDocuments", "ElasticDeleteIndex", "ElasticRefreshIndex"];
const tools = (names: readonly string[]) => Object.fromEntries(names.map((name) => [name, V]));

async function hiddenFrom(user_id: string): Promise<string[]> {
  const res = await post("/access", { user_id, toolkits: { [ELASTIC]: { tools: tools([...READS, ...WRITES]) } } });
  expect(res.status).toBe(200);
  const body = AccessHookResult.parse(await res.json());
  return Object.keys(body.deny?.[ELASTIC]?.tools ?? {}).sort();
}

// ---------------------------------------------------------------------------

describe("act 1 over the index: who can see the write tools", () => {
  test("the account executive, the analyst and the VP see every read and no write", async () => {
    for (const persona of [DANA, SAM, RILEY]) {
      expect(await hiddenFrom(persona)).toEqual([...WRITES].sort());
    }
  });

  test("the chief revenue officer — who the seed runs as — sees all of them", async () => {
    expect(await hiddenFrom(MORGAN)).toEqual([]);
  });
});

describe("act 3 over the index: the identifiers in a search hit", () => {
  test("masked for the account executive, by path, on a hybrid search", async () => {
    const output = await postHook(DANA, "ElasticHybridSearch", { index: INDEX, query_text: "bakery", semantic_field: "crm_notes_semantic" }, searchResult());
    const hit = (output?.hits as Array<{ source: Record<string, unknown> }>)[0]?.source;
    expect(hit?.bank_account_number).toBe("[REDACTED]");
    expect(hit?.tax_id).toBe("[REDACTED]");
    // Only the identifiers: the rest of the document is what the officer may read.
    expect(hit?.account_name).toBe(LOAN.account_name);
    expect(hit?.amount).toBe(LOAN.amount);
  });

  test("masked on a single fetched document too, where the path has no hits[]", async () => {
    const output = await postHook(DANA, "ElasticGetDocument", { index: INDEX, document_id: LOAN.deal_id }, { index: INDEX, id: LOAN.deal_id, found: true, source: document() });
    const source = output?.source as Record<string, unknown>;
    expect(source.bank_account_number).toBe("[REDACTED]");
    expect(source.tax_id).toBe("[REDACTED]");
  });

  test("not masked for the VP, whose clearance clears the bar", async () => {
    const output = await postHook(RILEY, "ElasticSearchByText", { index: INDEX, query_text: "Northwind" }, searchResult());
    const hit = (output?.hits as Array<{ source: Record<string, unknown> }> | undefined)?.[0]?.source;
    // The note is still stripped for Riley (act 4 is for everyone), so an
    // override does come back — but the identifiers in it are intact.
    expect(hit?.bank_account_number).toBe(LOAN.bank_account_number);
    expect(hit?.tax_id).toBe(LOAN.tax_id);
  });

  test("ES|QL has no path to mask, so /pre refuses a bare query for the officer and says how to fix it", async () => {
    const bare = await preHook(DANA, "ElasticRunEsqlQuery", { query: `FROM ${INDEX} | LIMIT 10` });
    expect(bare.code).toBe("CHECK_FAILED");
    expect(bare.error_message).toContain("KEEP");
    expect(bare.error_message).toContain("DealDesk_ElasticRunEsqlQuery");

    const naming = await preHook(DANA, "ElasticRunEsqlQuery", { query: `FROM ${INDEX} | KEEP deal_id, tax_id | LIMIT 10` });
    expect(naming.code).toBe("CHECK_FAILED");
    expect(naming.error_message).toContain("tax_id");

    const kept = await preHook(DANA, "ElasticRunEsqlQuery", { query: `FROM ${INDEX} | WHERE status == "pending" | KEEP deal_id, account_name, amount | LIMIT 10` });
    expect(kept.code).toBe("OK");

    const stats = await preHook(DANA, "ElasticRunEsqlQuery", { query: `FROM ${INDEX} | STATS total = SUM(amount) BY status | LIMIT 10` });
    expect(stats.code).toBe("OK");

    // The VP is over the bar: the bare query is theirs to run.
    const vp = await preHook(RILEY, "ElasticRunEsqlQuery", { query: `FROM ${INDEX} | LIMIT 10` });
    expect(vp.code).toBe("OK");
  });

  test("an aggregation over an identifier field is refused for the officer, one over status is not", async () => {
    const over = await preHook(DANA, "ElasticAggregateDocuments", { index: INDEX, aggregations: JSON.stringify({ by_account: { terms: { field: "bank_account_number" } } }) });
    expect(over.code).toBe("CHECK_FAILED");
    const fine = await preHook(DANA, "ElasticAggregateDocuments", { index: INDEX, aggregations: JSON.stringify({ by_status: { terms: { field: "status" } } }) });
    expect(fine.code).toBe("OK");
  });
});

describe("act 4 over the index: the planted instruction in a search hit", () => {
  test("is stripped for everyone, the CCO included, and the legitimate half of the note survives", async () => {
    for (const persona of [DANA, MORGAN]) {
      const output = await postHook(persona, "ElasticSemanticSearch", { index: INDEX, field: "crm_notes_semantic", query_text: "seasonal bakery cash flow" }, searchResult());
      const hit = (output?.hits as Array<{ source: Record<string, unknown> }>)[0]?.source;
      expect(hit?.crm_notes).toBe(LEGITIMATE_NOTE);
    }
  });

  test("a clean hit comes back untouched — no override at all", async () => {
    const clean = loanFixture("DL-2299");
    const { decisions: _d, ...source } = clean as typeof clean & { decisions?: unknown };
    const output = await postHook(MORGAN, "ElasticSearchByText", { index: INDEX, query_text: "Meridian" }, { index: INDEX, total_hits: 1, returned_hits: 1, hits: [{ id: clean.deal_id, score: 1, source }] });
    expect(output).toBeUndefined();
  });
});

