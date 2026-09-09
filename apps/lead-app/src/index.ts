/** Authenticated account and offer HTTP API; email drafts remain in local SQLite. */
import { z } from "zod";
import { ActorError, actorFromRequest } from "./actor";
import { countAccounts, createDiscountedOffer, discountBodySchema, getAccount, getOperation, openSalesStore, operationKeySchema, resetSalesStore, SalesWriteError, searchAccounts } from "./db";

const SERVICE = "lead-app";
const accountPath = /^\/accounts\/([^/]+)(?:\/(offer|offers))?$/;
const searchQuery = z.object({ q: z.string().max(200).optional() }).strict();
function error(status: number, message: string, issues?: unknown) { return Response.json({ error: message, ...(issues === undefined ? {} : { issues }) }, { status }); }
function noAccount(id: string) { return error(404, `No account found with ID ${id}.`); }

export function createApp(options: { dbPath: string; idpHost: string; internalToken?: string }) {
  const db = openSalesStore(options.dbPath);
  async function accounts(request: Request, url: URL) {
    const match = accountPath.exec(url.pathname);
    if (url.pathname !== "/accounts" && !match) return error(404, "Not found");
    const write = match?.[2] === "offers";
    if (request.method !== (write ? "POST" : "GET")) return error(405, "Method not allowed");
    const actor = await actorFromRequest(request, options.idpHost);
    if (!match) {
      const query = searchQuery.safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) return error(400, "Invalid query", query.error.issues);
      const results = searchAccounts(db, query.data.q);
      return Response.json({ count: results.length, accounts: results });
    }
    const id = decodeURIComponent(match[1]!);
    if (!write) {
      const account = getAccount(db, id);
      if (!account) return noAccount(id);
      if (match[2] === "offer") return account.offer ? Response.json(account.offer) : error(404, `No draft offer found for account ${id}.`);
      return Response.json(account);
    }
    const key = operationKeySchema.safeParse(request.headers.get("Idempotency-Key"));
    if (!key.success) return error(400, "A valid Idempotency-Key is required.");
    const body = discountBodySchema.safeParse(await request.json().catch(() => undefined));
    if (!body.success) return error(400, "Invalid body", body.error.issues);
    const result = createDiscountedOffer(db, { operation_key: key.data, actor, account_id: id, body: body.data });
    return result ? Response.json(result.offer, { headers: { "Idempotency-Key": key.data, "Idempotency-Replayed": String(result.replayed) } }) : noAccount(id);
  }
  async function internal(request: Request, url: URL) {
    const value = /^\/internal\/accounts\/([^/]+)\/value$/.exec(url.pathname);
    const receipt = /^\/internal\/operations\/([^/]+)$/.exec(url.pathname);
    const reset = url.pathname === "/internal/reset";
    if (!value && !receipt && !reset) return error(404, "Not found");
    if (request.method !== (reset ? "POST" : "GET")) return error(405, "Method not allowed");
    if (!options.internalToken || request.headers.get("authorization") !== `Bearer ${options.internalToken}`) return error(401, "The internal service credential is required.");
    if (reset) return Response.json(resetSalesStore(db));
    if (value) {
      const id = decodeURIComponent(value[1]!); const account = getAccount(db, id);
      return account ? Response.json({ account_id: account.account_id, list_price: account.list_price }) : noAccount(id);
    }
    const key = operationKeySchema.safeParse(decodeURIComponent(receipt![1]!));
    if (!key.success) return error(400, "Invalid operation key.");
    const operation = getOperation(db, key.data);
    return operation ? Response.json(operation) : error(404, "No completed operation found.");
  }
  return { close() { db.close(); }, async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") return Response.json({ status: "ok", service: SERVICE, accounts: countAccounts(db) });
      if (url.pathname.startsWith("/internal/")) return await internal(request, url);
      if (url.pathname === "/accounts" || url.pathname.startsWith("/accounts/")) return await accounts(request, url);
      return error(404, "Not found");
    } catch (cause) {
      if (cause instanceof ActorError) return error(cause.status, cause.message);
      if (cause instanceof SalesWriteError) return Response.json({ error: cause.message, code: cause.code }, { status: 409 });
      if (cause instanceof URIError) return error(400, "Invalid path encoding.");
      throw cause;
    }
  } };
}
if (import.meta.main) {
  const app = createApp({ dbPath: process.env.LEADS_DB_PATH ?? "./leads.db", idpHost: process.env.IDP_PUBLIC_HOST ?? "localhost:8083", ...(process.env.LEAD_INTERNAL_TOKEN ? { internalToken: process.env.LEAD_INTERNAL_TOKEN } : {}) });
  const server = Bun.serve({ port: Number(process.env.PORT ?? 8082), idleTimeout: 60, fetch: app.fetch });
  console.log(`[${SERVICE}] listening on :${server.port}`);
}
