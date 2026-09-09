/**
 * `leads.db` — the inbound lead system of record. Plain domain persistence:
 * a `leads` table and an append-only `lead_decisions` table.
 *
 * Nothing here inspects who is asking or what they are allowed to do. Every
 * read returns whatever the row holds and every write is applied as given.
 * That is deliberate: this is the system being governed, and the controls
 * live in `apps/hooks`, which this service cannot reach or influence.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import fixture from "./fixtures/leads.json" with { type: "json" };

export type LeadStatus = "new" | "qualified" | "follow_up" | "support" | "not_sales_related";
export type LeadDisposition = Exclude<LeadStatus, "new" | "qualified">;

/** One entry in a lead's decision history. Append-only — see the write helpers below. */
export interface LeadDecision {
  action: "routed" | "classified";
  disposition: Exclude<LeadStatus, "new">;
  estimated_acv: number | null;
  owner_email: string | null;
  rationale: string;
  /**
   * Who recorded it — the email the API derived from the caller's token.
   * `null` only for decisions that came in with the seed, which predate the
   * system and have no actor to name.
   */
  decided_by: string | null;
  decided_at: string;
}

/** What `search_leads` returns per hit: the list-view columns. */
export interface LeadSummary {
  lead_id: string;
  company_name: string;
  contact_name: string;
  estimated_acv: number;
  status: LeadStatus;
  source: string;
  submitted_at: string;
}

/**
 * What `get_lead` returns: the complete inbound submission.
 *
 * `personal_phone` and `form_message` are present on purpose. An inbound lead
 * system's detail view holds the submitted values, so this service returns
 * them unchanged and leaves downstream handling to the surrounding system.
 */
export interface LeadRecord extends LeadSummary {
  contact_email: string;
  personal_phone: string;
  company_domain: string;
  job_title: string;
  employee_count: number;
  country: string;
  use_case: string;
  form_message: string;
  assigned_owner: string | null;
  decisions: LeadDecision[];
}

const routedDecisionFixtureSchema = z.object({
  action: z.literal("routed"),
  disposition: z.literal("qualified"),
  estimated_acv: z.number().nonnegative(),
  owner_email: z.string().email(),
  rationale: z.string().min(1),
  decided_by: z.string().email().nullable().default(null),
  decided_at: z.string(),
});

const classifiedDecisionFixtureSchema = z.object({
  action: z.literal("classified"),
  disposition: z.enum(["follow_up", "support", "not_sales_related"]),
  estimated_acv: z.null(),
  owner_email: z.null(),
  rationale: z.string().min(1),
  decided_by: z.string().email().nullable().default(null),
  decided_at: z.string(),
});

const leadFixtureSchema = z.object({
  lead_id: z.string(),
  company_name: z.string(),
  contact_name: z.string(),
  estimated_acv: z.number().nonnegative(),
  status: z.enum(["new", "qualified", "follow_up", "support", "not_sales_related"]),
  source: z.string(),
  submitted_at: z.string(),
  contact_email: z.string().email(),
  personal_phone: z.string(),
  company_domain: z.string(),
  job_title: z.string(),
  employee_count: z.number().int().nonnegative(),
  country: z.string(),
  use_case: z.string(),
  form_message: z.string(),
  assigned_owner: z.string().email().nullable(),
  decisions: z.array(z.discriminatedUnion("action", [
    routedDecisionFixtureSchema,
    classifiedDecisionFixtureSchema,
  ])),
});

// The fixture is hand-edited — by us now and by forkers later — so it is
// parsed rather than trusted. A typo should fail at boot with a field path,
// not surface as a lead that quietly has no company.
const fixtureSchema = z.object({ leads: z.array(leadFixtureSchema).min(1) });

const OPERATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS lead_operations (
    operation_key TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('route', 'classify')),
    lead_id TEXT NOT NULL REFERENCES leads(lead_id),
    body TEXT NOT NULL,
    response TEXT NOT NULL,
    completed_at TEXT NOT NULL
  );
`;

const SCHEMA = `
  CREATE TABLE leads (
    lead_id         TEXT    PRIMARY KEY,
    company_name    TEXT    NOT NULL,
    contact_name    TEXT    NOT NULL,
    estimated_acv   INTEGER NOT NULL,
    status          TEXT    NOT NULL CHECK (
      status IN ('new', 'qualified', 'follow_up', 'support', 'not_sales_related')
    ),
    source           TEXT    NOT NULL,
    submitted_at     TEXT    NOT NULL,
    contact_email    TEXT    NOT NULL,
    personal_phone   TEXT    NOT NULL,
    company_domain   TEXT    NOT NULL,
    job_title        TEXT    NOT NULL,
    employee_count   INTEGER NOT NULL,
    country          TEXT    NOT NULL,
    use_case         TEXT    NOT NULL,
    form_message     TEXT    NOT NULL,
    assigned_owner   TEXT
  );

  -- Append-only: distinct operations retain separate decisions.
  CREATE TABLE lead_decisions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id       TEXT    NOT NULL REFERENCES leads(lead_id),
    action        TEXT    NOT NULL CHECK (action IN ('routed', 'classified')),
    disposition   TEXT    NOT NULL CHECK (
      disposition IN ('qualified', 'follow_up', 'support', 'not_sales_related')
    ),
    estimated_acv INTEGER,
    owner_email   TEXT,
    rationale     TEXT    NOT NULL,
    decided_by    TEXT,
    decided_at    TEXT    NOT NULL
  );

  CREATE INDEX idx_lead_decisions_lead_id ON lead_decisions(lead_id);
  CREATE INDEX idx_leads_status ON leads(status);
  CREATE INDEX idx_leads_estimated_acv ON leads(estimated_acv);
`;

/**
 * Opens the lead store, bootstrapping it from the fixture only when it has no
 * schema.
 *
 * Seed-if-empty rather than seed-on-boot: `leads.db` lives on a persistent
 * disk, so decisions made on stage remain after a restart. Getting back to a
 * clean state is an explicit operation, never a side effect of deploying.
 */
export function openLeadStore(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  if (!hasSchema(db)) seed(db, fixtureSchema.parse(fixture).leads);
  else upgradeSchema(db);
  db.exec(OPERATION_SCHEMA);

  return db;
}

/**
 * Brings a database created by an earlier schema up to the current one while
 * keeping every row. Each step is additive and idempotent.
 */
function upgradeSchema(db: Database): void {
  if (!hasColumn(db, "lead_decisions", "decided_by")) {
    db.exec("ALTER TABLE lead_decisions ADD COLUMN decided_by TEXT");
  }
}

function hasColumn(db: Database, table: string, column: string): boolean {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function hasSchema(db: Database): boolean {
  const row = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'leads'",
    )
    .get();

  return row !== null;
}

/**
 * `bun:sqlite` matches named parameters on the `$name` form, so normalize
 * fixture objects once before passing them to prepared statements.
 */
type NamedBindings = Record<string, string | number | boolean | null>;

function bind(row: NamedBindings): NamedBindings {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [`$${key}`, value]));
}

/** One lead as it appears in the fixture. */
export type LeadSeed = z.infer<typeof leadFixtureSchema>;

/** Creates the schema and inserts the seed rows in one transaction. */
export function seed(db: Database, leads: LeadSeed[]): void {
  db.transaction(() => {
    db.exec(SCHEMA);
    db.exec(OPERATION_SCHEMA);
    insertSeedRows(db, leads);
  })();
}

function insertSeedRows(db: Database, leads: LeadSeed[]): void {
  const insertLead = db.prepare<unknown, NamedBindings>(`
      INSERT INTO leads (
        lead_id, company_name, contact_name, estimated_acv, status, source, submitted_at,
        contact_email, personal_phone, company_domain, job_title, employee_count, country,
        use_case, form_message, assigned_owner
      ) VALUES (
        $lead_id, $company_name, $contact_name, $estimated_acv, $status, $source, $submitted_at,
        $contact_email, $personal_phone, $company_domain, $job_title, $employee_count, $country,
        $use_case, $form_message, $assigned_owner
      )
    `);

  const insertDecision = db.prepare<unknown, NamedBindings>(`
      INSERT INTO lead_decisions (
        lead_id, action, disposition, estimated_acv, owner_email, rationale, decided_by, decided_at
      ) VALUES (
        $lead_id, $action, $disposition, $estimated_acv, $owner_email, $rationale,
        $decided_by, $decided_at
      )
    `);

  try {
    for (const lead of leads) {
      const { decisions, ...columns } = lead;
      insertLead.run(bind(columns));

      for (const decision of decisions) {
        insertDecision.run(bind({ lead_id: lead.lead_id, ...decision }));
      }
    }
  } finally {
    insertLead.finalize();
    insertDecision.finalize();
  }
}

export function searchLeads(
  db: Database,
  filters: {
    status?: LeadStatus;
    min_estimated_acv?: number;
    max_estimated_acv?: number;
  },
): LeadSummary[] {
  return db
    .query<LeadSummary, { $status: string | null; $min: number | null; $max: number | null }>(
      `SELECT lead_id, company_name, contact_name, estimated_acv, status, source, submitted_at
         FROM leads
        WHERE ($status IS NULL OR status = $status)
          AND ($min    IS NULL OR estimated_acv >= $min)
          AND ($max    IS NULL OR estimated_acv <= $max)
        ORDER BY submitted_at DESC, lead_id DESC`,
    )
    .all({
      $status: filters.status ?? null,
      $min: filters.min_estimated_acv ?? null,
      $max: filters.max_estimated_acv ?? null,
    });
}

export function getLead(db: Database, leadId: string): LeadRecord | null {
  const lead = db
    .query<Omit<LeadRecord, "decisions">, { $lead_id: string }>(
      "SELECT * FROM leads WHERE lead_id = $lead_id",
    )
    .get({ $lead_id: leadId });

  if (lead === null) return null;

  const decisions = db
    .query<LeadDecision, { $lead_id: string }>(
      `SELECT action, disposition, estimated_acv, owner_email, rationale, decided_by, decided_at
         FROM lead_decisions
        WHERE lead_id = $lead_id
        ORDER BY id ASC`,
    )
    .all({ $lead_id: leadId });

  return { ...lead, decisions };
}

export interface RouteBody {
  estimated_acv: number;
  owner_email: string;
  rationale: string;
}
export interface ClassifyBody {
  disposition: LeadDisposition;
  rationale: string;
}
export type LeadWriteInput = {
  operation_key: string;
  actor: string;
  lead_id: string;
} & ({ action: "route"; body: RouteBody } | { action: "classify"; body: ClassifyBody });

export interface OperationReceipt {
  operation_key: string;
  actor: string;
  action: "route" | "classify";
  lead_id: string;
  body: RouteBody | ClassifyBody;
  completed_at: string;
}
interface StoredOperation extends Omit<OperationReceipt, "body"> {
  body: string;
  response: string;
}
export class LeadWriteError extends Error {
  constructor(readonly code: "ACV_MISMATCH" | "OPERATION_CONFLICT", message: string) {
    super(message);
  }
}
export const operationKeySchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

function storedOperation(db: Database, key: string): StoredOperation | null {
  return db.query<StoredOperation, [string]>("SELECT * FROM lead_operations WHERE operation_key = ?").get(key);
}

export function getOperation(db: Database, key: string): OperationReceipt | null {
  const saved = storedOperation(db, key);
  if (!saved) return null;
  const { response: _response, body, ...receipt } = saved;
  return { ...receipt, body: JSON.parse(body) };
}

/** The receipt and business write commit together; a replay returns the original snapshot. */
export function executeLeadWrite(db: Database, input: LeadWriteInput): { lead: LeadRecord; replayed: boolean } | null {
  operationKeySchema.parse(input.operation_key);
  // Named fields give equivalent JSON objects a stable representation without changing strings.
  const body = input.action === "route"
    ? { estimated_acv: input.body.estimated_acv, owner_email: input.body.owner_email, rationale: input.body.rationale }
    : { disposition: input.body.disposition, rationale: input.body.rationale };
  const encoded = JSON.stringify(body);
  return db.transaction(() => {
    const saved = storedOperation(db, input.operation_key);
    if (saved) {
      if (saved.actor !== input.actor || saved.action !== input.action || saved.lead_id !== input.lead_id || saved.body !== encoded) {
        throw new LeadWriteError("OPERATION_CONFLICT", "The operation key already belongs to a different request.");
      }
      return { lead: JSON.parse(saved.response) as LeadRecord, replayed: true };
    }
    const current = getLead(db, input.lead_id);
    if (!current) return null;
    if (input.action === "route" && input.body.estimated_acv !== current.estimated_acv) {
      throw new LeadWriteError("ACV_MISMATCH", "The asserted estimated ACV does not match the stored value.");
    }
    const completed_at = new Date().toISOString();
    insertDecision(db, {
      lead_id: input.lead_id,
      action: input.action === "route" ? "routed" : "classified",
      disposition: input.action === "route" ? "qualified" : input.body.disposition,
      estimated_acv: input.action === "route" ? current.estimated_acv : null,
      owner_email: input.action === "route" ? input.body.owner_email : null,
      rationale: input.body.rationale,
      decided_by: input.actor,
      decided_at: completed_at,
    });
    if (input.action === "route") {
      db.query("UPDATE leads SET status = 'qualified', assigned_owner = ? WHERE lead_id = ?")
        .run(input.body.owner_email, input.lead_id);
    } else {
      db.query("UPDATE leads SET status = ? WHERE lead_id = ?").run(input.body.disposition, input.lead_id);
    }
    const lead = getLead(db, input.lead_id)!;
    db.query(`INSERT INTO lead_operations
      (operation_key, actor, action, lead_id, body, response, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(input.operation_key, input.actor, input.action, input.lead_id, encoded, JSON.stringify(lead), completed_at);
    return { lead, replayed: false };
  }).immediate();
}

export function routeLead(db: Database, input: RouteBody & { lead_id: string; operation_key: string; decided_by: string }): LeadRecord | null {
  return executeLeadWrite(db, { operation_key: input.operation_key, actor: input.decided_by, lead_id: input.lead_id, action: "route", body: input })?.lead ?? null;
}

export function classifyLead(db: Database, input: ClassifyBody & { lead_id: string; operation_key: string; decided_by: string }): LeadRecord | null {
  return executeLeadWrite(db, { operation_key: input.operation_key, actor: input.decided_by, lead_id: input.lead_id, action: "classify", body: input })?.lead ?? null;
}

export function resetLeadStore(db: Database): { leads: number; decisions: number; operations: number } {
  const baseline = fixtureSchema.parse(fixture).leads;
  return db.transaction(() => {
    db.exec("DELETE FROM lead_operations");
    db.exec("DELETE FROM lead_decisions");
    db.exec("DELETE FROM leads");
    insertSeedRows(db, baseline);
    return { leads: countLeads(db), decisions: baseline.reduce((sum, lead) => sum + lead.decisions.length, 0), operations: 0 };
  }).immediate();
}

function insertDecision(
  db: Database,
  decision: LeadDecision & { lead_id: string },
): void {
  db.query<unknown, NamedBindings>(
    `INSERT INTO lead_decisions (
       lead_id, action, disposition, estimated_acv, owner_email, rationale, decided_by, decided_at
     ) VALUES (
       $lead_id, $action, $disposition, $estimated_acv, $owner_email, $rationale,
       $decided_by, $decided_at
     )`,
  ).run(bind({ ...decision }));
}

export function countLeads(db: Database): number {
  const row = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM leads").get();
  return row?.n ?? 0;
}
