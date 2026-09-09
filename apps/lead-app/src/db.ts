/** Business persistence only. Offers and local email drafts commit with their receipt. */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import fixture from "./fixtures/accounts.json" with { type: "json" };

const accountSchema = z.object({
  account_id: z.string().min(1), company_name: z.string().min(1), company_domain: z.string(),
  product: z.string().min(1), billing_cycle: z.literal("yearly"), list_price: z.number().positive(),
  billing_contact: z.object({ name: z.string(), email: z.string().email(), personal_phone: z.string() }),
  subscription: z.object({ status: z.literal("active"), renewal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  support: z.object({ case_id: z.string().min(1), status: z.literal("open"), summary: z.string().min(1), api_key: z.string().startsWith("workshop_support_FAKE_"), internal_owner_email: z.string().email() }),
});
export type AccountSeed = z.infer<typeof accountSchema>;
export interface DiscountBody { discount_percent: number; list_price: number; rationale: string; customer_message: string }
export interface OfferDecision extends DiscountBody {
  action: "discount"; offer_id: string; net_price: number; decided_by: string; decided_at: string;
}
export interface FollowUpEmail { to: string; subject: string; body: string }
export interface Offer {
  account_id: string; offer_id: string; discount_percent: number; list_price: number; net_price: number;
  status: "draft"; follow_up_email: FollowUpEmail; decisions: OfferDecision[];
}
export interface AccountRecord extends AccountSeed { offer: Offer | null; decisions: OfferDecision[] }
export type AccountSummary = Pick<AccountSeed, "account_id" | "company_name" | "company_domain" | "product" | "billing_cycle" | "list_price">;
export interface OperationReceipt { operation_key: string; actor: string; action: "discount"; account_id: string; body: DiscountBody; completed_at: string }
interface StoredOperation extends Omit<OperationReceipt, "body"> { body: string; response: string }
export class SalesWriteError extends Error {
  constructor(readonly code: "LIST_PRICE_MISMATCH" | "OPERATION_CONFLICT", message: string) { super(message); }
}
export const operationKeySchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const discountBodySchema = z.object({ discount_percent: z.number().finite().min(0).max(100), list_price: z.number().finite().positive(), rationale: z.string().min(1).refine(value => value.trim().length > 0), customer_message: z.string().min(1).max(4000).refine(value => value.trim().length > 0) }).strict();

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sales_accounts (account_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sales_offers (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, offer_id TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL REFERENCES sales_accounts(account_id), response TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sales_email_drafts (
    offer_id TEXT PRIMARY KEY REFERENCES sales_offers(offer_id), payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sales_decisions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, offer_id TEXT NOT NULL UNIQUE REFERENCES sales_offers(offer_id),
    account_id TEXT NOT NULL REFERENCES sales_accounts(account_id), data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sales_operations (
    operation_key TEXT PRIMARY KEY, actor TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action = 'discount'), account_id TEXT NOT NULL REFERENCES sales_accounts(account_id),
    body TEXT NOT NULL, response TEXT NOT NULL, completed_at TEXT NOT NULL
  );
`;

/** Use a fresh renewal database path; earlier exercise stores are not converted. */
export function openSalesStore(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
  db.transaction(() => {
    const existing = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='sales_accounts'").get();
    db.exec(SCHEMA);
    if (!existing) insertSeed(db);
  }).immediate();
  return db;
}
function insertSeed(db: Database) {
  const accounts = z.object({ accounts: z.array(accountSchema).min(1) }).parse(fixture).accounts;
  for (const account of accounts) db.query("INSERT INTO sales_accounts(account_id,data) VALUES (?,?)").run(account.account_id, JSON.stringify(account));
}
export function countAccounts(db: Database): number { return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sales_accounts").get()!.n; }
export function searchAccounts(db: Database, query = ""): AccountSummary[] {
  const term = query.toLowerCase();
  return db.query<{ data: string }, []>("SELECT data FROM sales_accounts ORDER BY account_id").all()
    .map(row => JSON.parse(row.data) as AccountSeed)
    .filter(account => [account.account_id, account.company_name, account.company_domain].some(value => value.toLowerCase().includes(term)))
    .map(({ account_id, company_name, company_domain, product, billing_cycle, list_price }) => ({ account_id, company_name, company_domain, product, billing_cycle, list_price }));
}
function decisions(db: Database, accountId: string): OfferDecision[] {
  return db.query<{ data: string }, [string]>("SELECT data FROM sales_decisions WHERE account_id=? ORDER BY seq").all(accountId).map(row => JSON.parse(row.data));
}
export function getOffer(db: Database, accountId: string): Offer | null {
  const row = db.query<{ response: string }, [string, string]>("SELECT response FROM sales_offers WHERE account_id=? AND seq=(SELECT MAX(seq) FROM sales_offers WHERE account_id=?)").get(accountId, accountId);
  return row ? JSON.parse(row.response) as Offer : null;
}
export function getAccount(db: Database, accountId: string): AccountRecord | null {
  const row = db.query<{ data: string }, [string]>("SELECT data FROM sales_accounts WHERE account_id=?").get(accountId);
  return row ? { ...JSON.parse(row.data) as AccountSeed, offer: getOffer(db, accountId), decisions: decisions(db, accountId) } : null;
}
function storedOperation(db: Database, key: string): StoredOperation | null {
  return db.query<StoredOperation, [string]>("SELECT * FROM sales_operations WHERE operation_key=?").get(key);
}
export function getOperation(db: Database, key: string): OperationReceipt | null {
  const saved = storedOperation(db, key);
  if (!saved) return null;
  const { response: _response, body, ...receipt } = saved;
  return { ...receipt, body: JSON.parse(body) as DiscountBody };
}
export function createDiscountedOffer(db: Database, input: { operation_key: string; actor: string; account_id: string; body: DiscountBody }): { offer: Offer; replayed: boolean } | null {
  operationKeySchema.parse(input.operation_key);
  discountBodySchema.parse(input.body);
  const body = { discount_percent: input.body.discount_percent, list_price: input.body.list_price, rationale: input.body.rationale, customer_message: input.body.customer_message };
  const encoded = JSON.stringify(body);
  return db.transaction(() => {
    const saved = storedOperation(db, input.operation_key);
    if (saved) {
      if (saved.actor !== input.actor || saved.account_id !== input.account_id || saved.body !== encoded) throw new SalesWriteError("OPERATION_CONFLICT", "The operation key already belongs to a different request.");
      return { offer: JSON.parse(saved.response) as Offer, replayed: true };
    }
    const account = getAccount(db, input.account_id);
    if (!account) return null;
    if (body.list_price !== account.list_price) throw new SalesWriteError("LIST_PRICE_MISMATCH", "The asserted list price does not match the stored value.");
    const offer_id = `OFF-${crypto.randomUUID()}`;
    const net_price = Math.round((account.list_price * (100 - body.discount_percent) / 100 + Number.EPSILON) * 100) / 100;
    const completed_at = new Date().toISOString();
    const follow_up_email: FollowUpEmail = {
      to: account.billing_contact.email,
      subject: `Draft: ${account.company_name} annual renewal follow-up`,
      body: `LOCAL WORKSHOP DRAFT — not sent.\n\n${body.customer_message}\n\nAnnual list price: $${account.list_price.toFixed(2)}. Discount: ${body.discount_percent}%. Annual net price: $${net_price.toFixed(2)}.`,
    };
    const decision: OfferDecision = { action: "discount", offer_id, ...body, net_price, decided_by: input.actor, decided_at: completed_at };
    const offer: Offer = { account_id: account.account_id, offer_id, discount_percent: body.discount_percent, list_price: account.list_price, net_price, status: "draft", follow_up_email, decisions: [...account.decisions, decision] };
    const response = JSON.stringify(offer);
    db.query("INSERT INTO sales_offers(offer_id,account_id,response) VALUES (?,?,?)").run(offer_id, account.account_id, response);
    db.query("INSERT INTO sales_email_drafts(offer_id,payload) VALUES (?,?)").run(offer_id, JSON.stringify(follow_up_email));
    db.query("INSERT INTO sales_decisions(offer_id,account_id,data) VALUES (?,?,?)").run(offer_id, account.account_id, JSON.stringify(decision));
    db.query("INSERT INTO sales_operations(operation_key,actor,action,account_id,body,response,completed_at) VALUES (?,?,'discount',?,?,?,?)")
      .run(input.operation_key, input.actor, account.account_id, encoded, response, completed_at);
    return { offer, replayed: false };
  }).immediate();
}
export function resetSalesStore(db: Database) {
  return db.transaction(() => {
    db.exec("DELETE FROM sales_operations; DELETE FROM sales_decisions; DELETE FROM sales_email_drafts; DELETE FROM sales_offers; DELETE FROM sales_accounts;");
    insertSeed(db);
    return { accounts: countAccounts(db), offers: 0, follow_up_emails: 0, decisions: 0, operations: 0 };
  }).immediate();
}
