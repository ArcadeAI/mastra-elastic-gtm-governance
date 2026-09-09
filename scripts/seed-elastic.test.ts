import { describe, expect, test } from "bun:test";

import leads from "../apps/lead-app/src/fixtures/leads.json" with { type: "json" };
import fixture from "../elastic/fixtures/account-context.json" with { type: "json" };
import { seedElastic, fixtureEvents, GOVERNED_PHONE, GOVERNED_INSTRUCTION } from "./seed-elastic";

describe("seedElastic", () => {
  test("partitions clean and governed markers without changing evidence IDs or dates", () => {
    const clean = fixtureEvents("clean");
    const governed = fixtureEvents("governed");
    expect(clean).toEqual(fixture);
    expect(JSON.stringify(clean)).not.toContain(GOVERNED_PHONE);
    expect(JSON.stringify(clean)).not.toContain(GOVERNED_INSTRUCTION);
    expect(JSON.stringify(governed)).toContain(GOVERNED_PHONE);
    expect(JSON.stringify(governed)).toContain(GOVERNED_INSTRUCTION);
    expect(governed.map(event => [event.event_id, event.occurred_at])).toEqual(clean.map(event => [event.event_id, event.occurred_at]));
    expect(governed).toHaveLength(8);
    expect(governed.find(event => event.event_id === "evt-northwind-003")?.content).toContain("SAML SSO");
    expect(fixtureEvents("clean")).toEqual(fixture);
  });
  test("keeps Elastic context joined to the lead-system fixture", () => {
    const leadsById = new Map(leads.leads.map((lead) => [lead.lead_id, lead]));

    for (const event of fixture) {
      const lead = leadsById.get(event.lead_id);
      expect(lead, `${event.event_id} references a missing lead`).toBeDefined();
      expect(event.company_name).toBe(lead!.company_name);
      expect(event.company_domain).toBe(lead!.company_domain);
    }
  });

  test("creates the mapping and bulk-indexes stable fixture IDs", async () => {
    const requests: Array<{ path: string; method: string; auth: string | null; body: string }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        requests.push({
          path: `${url.pathname}${url.search}`,
          method: request.method,
          auth: request.headers.get("authorization"),
          body: await request.text(),
        });
        return url.pathname === "/_bulk"
          ? Response.json({ errors: false, items: [] })
          : Response.json({ acknowledged: true });
      },
    });

    try {
      const count = await seedElastic({
        endpoint: `http://127.0.0.1:${server.port}/`,
        apiKey: "test-key",
        index: "gtm-account-context",
      });

      expect(count).toBe(fixture.length);
      expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
        "PUT /gtm-account-context",
        "POST /_bulk?refresh=true",
      ]);
      expect(requests.every(({ auth }) => auth === "ApiKey test-key")).toBe(true);

      const mapping = JSON.parse(requests[0]!.body);
      expect(mapping.mappings.dynamic).toBe("strict");
      expect(mapping.mappings.properties.metadata.type).toBe("flattened");

      const lines = requests[1]!.body.trimEnd().split("\n");
      expect(lines).toHaveLength(fixture.length * 2);
      const ids = lines
        .filter((_, index) => index % 2 === 0)
        .map((line) => JSON.parse(line).index._id);
      expect(ids).toEqual(fixture.map((event) => event.event_id));
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      server.stop(true);
    }
  });

  test("treats an existing index as an idempotent rerun", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        return request.method === "PUT"
          ? Response.json(
              { error: { type: "resource_already_exists_exception" } },
              { status: 400 },
            )
          : Response.json({ errors: false, items: [] });
      },
    });

    try {
      await expect(
        seedElastic({
          endpoint: `http://127.0.0.1:${server.port}`,
          apiKey: "test-key",
          index: "gtm-account-context",
        }),
      ).resolves.toBe(fixture.length);
    } finally {
      server.stop(true);
    }
  });

  test("rejects an invalid index before making a request", async () => {
    await expect(
      seedElastic({
        endpoint: "https://example.invalid",
        apiKey: "test-key",
        index: "Uppercase Is Unsafe",
      }),
    ).rejects.toThrow(/lowercase Elasticsearch index name/);
  });
});
