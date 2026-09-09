/**
 * A `leads.db` from before a column existed must still open, keep its rows,
 * and accept writes because the database disk persists across deploys.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { getLead, openLeadStore, routeLead } from "../src/db.ts";

/** The first lead schema, before decision attribution was added. */
const EARLY_SCHEMA = `
  CREATE TABLE leads (
    lead_id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    estimated_acv INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('new', 'qualified', 'follow_up', 'support', 'not_sales_related')
    ),
    source TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    personal_phone TEXT NOT NULL,
    company_domain TEXT NOT NULL,
    job_title TEXT NOT NULL,
    employee_count INTEGER NOT NULL,
    country TEXT NOT NULL,
    use_case TEXT NOT NULL,
    form_message TEXT NOT NULL,
    assigned_owner TEXT
  );
  CREATE TABLE lead_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id TEXT NOT NULL REFERENCES leads(lead_id),
    action TEXT NOT NULL CHECK (action IN ('routed', 'classified')),
    disposition TEXT NOT NULL CHECK (
      disposition IN ('qualified', 'follow_up', 'support', 'not_sales_related')
    ),
    estimated_acv INTEGER,
    owner_email TEXT,
    rationale TEXT NOT NULL,
    decided_at TEXT NOT NULL
  );
  INSERT INTO leads VALUES (
    'LD-0001',
    'Early Schema Co',
    'Alex Morgan',
    12000,
    'qualified',
    'contact_form',
    '2026-01-01T00:00:00.000Z',
    'alex@earlyschema.example',
    '+1-202-555-0101',
    'earlyschema.example',
    'Engineering Manager',
    30,
    'United States',
    'Preview deployments',
    'We are evaluating the product.',
    'maya@sales.example'
  );
  INSERT INTO lead_decisions (
    lead_id, action, disposition, estimated_acv, owner_email, rationale, decided_at
  ) VALUES (
    'LD-0001',
    'routed',
    'qualified',
    12000,
    'maya@sales.example',
    'Active evaluation.',
    '2026-01-02T00:00:00.000Z'
  );
`;

describe("opening a leads.db written by an earlier schema", () => {
  test("keeps every row, adds the missing column, and accepts writes", () => {
    const path = join(tmpdir(), `cg-leads-old-${crypto.randomUUID()}`, "leads.db");
    mkdirSync(dirname(path), { recursive: true });
    const legacy = new Database(path, { create: true });
    legacy.exec(EARLY_SCHEMA);
    legacy.close();

    const db = openLeadStore(path);
    try {
      const before = getLead(db, "LD-0001");
      expect(before?.decisions).toEqual([
        {
          action: "routed",
          disposition: "qualified",
          estimated_acv: 12000,
          owner_email: "maya@sales.example",
          rationale: "Active evaluation.",
          decided_by: null,
          decided_at: "2026-01-02T00:00:00.000Z",
        },
      ]);

      const after = routeLead(db, {
        operation_key: crypto.randomUUID(),
        lead_id: "LD-0001",
        estimated_acv: 12000,
        owner_email: "drew@sales.example",
        rationale: "Scope expanded.",
        decided_by: "dana@example.test",
      });
      expect(after?.decisions).toHaveLength(2);
      expect(after?.decisions.at(-1)?.decided_by).toBe("dana@example.test");

      // Not reseeded: the fixture is absent and the legacy row remains.
      expect(getLead(db, "LD-2291")).toBeNull();
    } finally {
      db.close();
      rmSync(dirname(path), { recursive: true, force: true });
    }
  });

  test("is idempotent when a current database opens again", () => {
    const path = join(tmpdir(), `cg-leads-current-${crypto.randomUUID()}`, "leads.db");
    openLeadStore(path).close();
    const db = openLeadStore(path);
    try {
      expect(getLead(db, "LD-2291")).not.toBeNull();
    } finally {
      db.close();
      rmSync(dirname(path), { recursive: true, force: true });
    }
  });
});
