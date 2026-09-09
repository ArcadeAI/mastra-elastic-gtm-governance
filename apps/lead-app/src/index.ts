/**
 * The inbound lead system of record. Owns `leads.db` and serves submissions
 * over plain HTTP:
 *
 *     GET  /leads?status=&min_estimated_acv=&max_estimated_acv=
 *     GET  /leads/:lead_id
 *     POST /leads/:lead_id/route
 *     POST /leads/:lead_id/classify
 *     GET  /health
 *
 * This service applies domain writes as requested and knows nothing about
 * governance. Controls live outside it, and the tools that call it
 * (`tools/lead`) are stateless clients that hold no state of their own.
 *
 * Every route under `/leads` requires a bearer token. The actor recorded on a
 * decision is read from that token and never accepted in the request body.
 */
import { z } from "zod";

import { ActorError, actorFromRequest } from "./actor.ts";
import {
  executeLeadWrite,
  getOperation,
  resetLeadStore,
  operationKeySchema,
  LeadWriteError,
  countLeads,
  getLead,
  openLeadStore,
  searchLeads,
} from "./db.ts";

const SERVICE = "lead-app";


const searchQuery = z.object({
  status: z.enum(["new", "qualified", "follow_up", "support", "not_sales_related"]).optional(),
  min_estimated_acv: z.coerce.number().nonnegative().optional(),
  max_estimated_acv: z.coerce.number().nonnegative().optional(),
});

// Strict bodies make an unknown field a 400. In particular, a body that tries
// to name its own actor is refused rather than quietly ignored.
const routeBody = z
  .object({
    estimated_acv: z.number().nonnegative(),
    owner_email: z.string().email(),
    rationale: z.string().min(1),
  })
  .strict();

const classifyBody = z
  .object({
    disposition: z.enum(["follow_up", "support", "not_sales_related"]),
    rationale: z.string().min(1),
  })
  .strict();

const LEAD_PATH = /^\/leads\/([^/]+)(?:\/(route|classify))?$/;

function error(status: number, message: string, issues?: unknown): Response {
  return Response.json(issues === undefined ? { error: message } : { error: message, issues }, {
    status,
  });
}

function noSuchLead(leadId: string): Response {
  return error(404, `No inbound lead found with ID ${leadId}.`);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function createApp(options: { dbPath: string; idpHost: string; internalToken?: string }) {
  const db = openLeadStore(options.dbPath);
  const idpHost = options.idpHost;

  async function handleLeads(request: Request, url: URL): Promise<Response> {
    // Resolve the route and check the method before identifying the caller, so a
    // wrong verb is a 405 whether or not a token came with it.
    const match = url.pathname === "/leads" ? null : LEAD_PATH.exec(url.pathname);
    if (url.pathname !== "/leads" && match === null) return error(404, "Not found");

    const action = match?.[2];
    const expected = action === undefined ? "GET" : "POST";
    if (request.method !== expected) return error(405, "Method not allowed");

    const actor = await actorFromRequest(request, idpHost);

    if (match === null) {
      const query = searchQuery.safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) return error(400, "Invalid query", query.error.issues);

      const { status, min_estimated_acv, max_estimated_acv } = query.data;
      const results = searchLeads(db, {
        ...(status !== undefined && { status }),
        ...(min_estimated_acv !== undefined && { min_estimated_acv }),
        ...(max_estimated_acv !== undefined && { max_estimated_acv }),
      });
      return Response.json({ count: results.length, leads: results });
    }

    const leadId = decodeURIComponent(match[1]!);

    if (action === undefined) {
      const lead = getLead(db, leadId);
      return lead === null ? noSuchLead(leadId) : Response.json(lead);
    }

    const key = operationKeySchema.safeParse(request.headers.get("Idempotency-Key"));
    if (!key.success) return error(400, "A valid Idempotency-Key is required.");
    const raw = await readJson(request);
    if (action === "route") {
      const body = routeBody.safeParse(raw);
      if (!body.success) return error(400, "Invalid body", body.error.issues);

      const result = executeLeadWrite(db, {
        operation_key: key.data, actor, lead_id: leadId, action: "route", body: body.data,
      });
      return result === null ? noSuchLead(leadId) : Response.json(result.lead, {
        headers: { "Idempotency-Key": key.data, "Idempotency-Replayed": String(result.replayed) },
      });
    }

    const body = classifyBody.safeParse(raw);
    if (!body.success) return error(400, "Invalid body", body.error.issues);

    const result = executeLeadWrite(db, {
      operation_key: key.data, actor, lead_id: leadId, action: "classify", body: body.data,
    });
    return result === null ? noSuchLead(leadId) : Response.json(result.lead, {
      headers: { "Idempotency-Key": key.data, "Idempotency-Replayed": String(result.replayed) },
    });
  }

  async function handleInternal(request: Request, url: URL): Promise<Response> {
    const value = /^\/internal\/leads\/([^/]+)\/value$/.exec(url.pathname);
    const receipt = /^\/internal\/operations\/([^/]+)$/.exec(url.pathname);
    const reset = url.pathname === "/internal/reset";
    if (!value && !receipt && !reset) return error(404, "Not found");
    if (request.method !== (reset ? "POST" : "GET")) return error(405, "Method not allowed");
    if (!options.internalToken || request.headers.get("authorization") !== `Bearer ${options.internalToken}`) {
      return error(401, "The internal service credential is required.");
    }
    if (reset) return Response.json(resetLeadStore(db));
    if (value) {
      const id = decodeURIComponent(value[1]!);
      const lead = getLead(db, id);
      return lead ? Response.json({ lead_id: lead.lead_id, estimated_acv: lead.estimated_acv }) : noSuchLead(id);
    }
    const key = operationKeySchema.safeParse(decodeURIComponent(receipt![1]!));
    if (!key.success) return error(400, "Invalid operation key.");
    const operation = getOperation(db, key.data);
    return operation ? Response.json(operation) : error(404, "No completed operation found.");
  }

  return {
    close() { db.close(); },
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      try {
        if (request.method === "GET" && url.pathname === "/health") {
          return Response.json({ status: "ok", service: SERVICE, leads: countLeads(db) });
        }
        if (url.pathname.startsWith("/internal/")) return await handleInternal(request, url);
        if (url.pathname === "/leads" || url.pathname.startsWith("/leads/")) return await handleLeads(request, url);
        return error(404, "Not found");
      } catch (cause) {
        if (cause instanceof ActorError) return error(cause.status, cause.message);
        if (cause instanceof LeadWriteError) return Response.json({ error: cause.message, code: cause.code }, { status: 409 });
        if (cause instanceof URIError) return error(400, "Invalid path encoding.");
        throw cause;
      }
    },
  };
}

if (import.meta.main) {
  const application = createApp({
    dbPath: process.env.LEADS_DB_PATH ?? "./leads.db",
    idpHost: process.env.IDP_PUBLIC_HOST ?? "localhost:8083",
    ...(process.env.LEAD_INTERNAL_TOKEN ? { internalToken: process.env.LEAD_INTERNAL_TOKEN } : {}),
  });
  const server = Bun.serve({ port: Number(process.env.PORT ?? 8082), idleTimeout: 60, fetch: application.fetch });
  console.log(`[${SERVICE}] listening on :${server.port}`);
}
