import { z } from "zod";
import { createRuntime, type Stage } from "./agent-runtime";
import { createSessions, type SessionConfig } from "./session";
import { HooksClient, ServiceError } from "./hooks-client";
import type { ApprovalClient } from "./approval-client";
import { timingSafeEqual } from "node:crypto";

export interface WebAppOptions {
  runtime: (stage: Stage) => ReturnType<typeof createRuntime> | Promise<ReturnType<typeof createRuntime>>;
  session: () => SessionConfig;
  hooks: () => HooksClient;
  arcadeKey: () => string;
  approvals?: () => ApprovalClient;
  confirmUrl?: string;
  operatorToken?: () => string;
  resetSnapshots?: (resetEpoch: number) => Promise<{ deleted_snapshots: number }>;
}
const stageSchema = z.enum(["supplied", "elastic", "governed"]);
const messageSchema = z.object({ stage: stageSchema, message: z.string().trim().min(1).max(4000) }).strict();
const decisionSchema = z.object({ decision: z.enum(["approve", "deny"]), note: z.string().max(1000).optional() }).strict();

export function createWebApp(options: WebAppOptions) {
  let activeWorkers = 0;
  let resetting = false;
  async function work<T>(execute: () => Promise<T>) {
    if (resetting) throw new ServiceError("Exercise reset is in progress.", 409);
    activeWorkers++;
    try { return await execute(); } finally { activeWorkers--; }
  }
  return { async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url); const path = url.pathname;
      if (path === "/api/operator/reset" && request.method === "POST") {
        const token = options.operatorToken?.();
        const actual = Buffer.from(request.headers.get("authorization") ?? "");
        const expected = Buffer.from(`Bearer ${token ?? ""}`);
        if (!token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ServiceError("Invalid operator credential", 401);
        if (activeWorkers || resetting) throw new ServiceError("Wait for the active web worker before resetting snapshots.", 409);
        if (!options.resetSnapshots) throw new ServiceError("Snapshot reset is not configured.", 503);
        const reset = z.object({ reset_epoch: z.number().int().positive() }).strict().parse(await request.json());
        if (activeWorkers || resetting) throw new ServiceError("Wait for the active web worker before resetting snapshots.", 409);
        resetting = true;
        try { return Response.json({ reset: true, ...await options.resetSnapshots(reset.reset_epoch) }); } finally { resetting = false; }
      }
      const json = async () => request.json().catch(() => { throw new ServiceError("Invalid JSON request", 400); });
      const sessions = () => createSessions(options.session());
      const requireSession = async (mutating = false) => {
        const handler = sessions(); const session = await handler.current(request);
        if (!session) throw new ServiceError("Sign in to a demo role to continue.", 401);
        if (mutating) handler.csrf(request, session);
        return session;
      };
      if (path === "/auth/login" && request.method === "GET") return sessions().login(request);
      if (path === "/auth/callback" && request.method === "GET") return await sessions().callback(request);
      if (path === "/auth/logout" && request.method === "POST") { await requireSession(true); return sessions().logout(); }
      if (path === "/auth/arcade/verify" && request.method === "GET") {
        const session = await requireSession(); const flowId = z.string().min(1).max(500).parse(url.searchParams.get("flow_id"));
        if (url.searchParams.has("user_id") && url.searchParams.get("user_id") !== session.email) throw new ServiceError("Sign in as the identity requesting Arcade authorization.", 403);
        const response = await fetch(options.confirmUrl ?? "https://cloud.arcade.dev/api/v1/oauth/confirm_user", { method: "POST", headers: { authorization: `Bearer ${options.arcadeKey()}`, "content-type": "application/json" }, body: JSON.stringify({ flow_id: flowId, user_id: session.email }), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new ServiceError("Arcade could not verify this signed-in identity. Retry authorization in the matching role.", 403);
        return Response.json({ verified: true, message: "Identity verified. Return to the workshop and retry the pending action." });
      }
      if (path === "/api/session" && request.method === "GET") {
        // Earlier stages can render even before identity configuration exists.
        try {
          const config = options.session();
          const session = await createSessions(config).current(request).catch((error) => { if (error instanceof ServiceError && error.status === 401) return null; throw error; });
          return Response.json({ session: session ? { email: session.email, persona: session.persona, csrf: session.csrf } : null, demoMode: config.demoMode, roles: config.demoMode ? config.emails : {} });
        }
        catch (error) { if (error instanceof ServiceError && error.status === 503) return Response.json({ session: null, configured: false, demoMode: false, roles: {} }); throw error; }
      }
      if (path === "/api/agent" && request.method === "POST") {
        const input = messageSchema.parse(await json());
        const session = input.stage === "governed" ? await requireSession(true) : null;
        if (session?.persona === "verification") throw new ServiceError("The verification identity is for setup checks only.", 403);
        return Response.json(await work(async () => (await options.runtime(input.stage)).start({ ...input, ...(session ? { userId: session.email } : {}), signal: request.signal })));
      }
      if (path === "/api/tools" && request.method === "GET") {
        const stage = stageSchema.parse(url.searchParams.get("stage") ?? "governed");
        const session = stage === "governed" ? await requireSession() : null;
        return Response.json({ tools: await (await options.runtime(stage)).tools(stage, session?.email) });
      }
      const runMatch = path.match(/^\/api\/runs\/([^/]+)(?:\/(resume|close))?$/);
      if (runMatch) {
        const session = await requireSession(request.method === "POST"); const id = encodeURIComponent(runMatch[1]!);
        if (request.method === "GET" && !runMatch[2]) return Response.json(await options.hooks().request(`/internal/runs/${id}?viewer_user_id=${encodeURIComponent(session.email)}`));
        if (request.method === "POST" && runMatch[2]) return Response.json(await work(async () => (await options.runtime("governed"))[runMatch[2] as "resume" | "close"](id, session.email)));
      }
      const approvalMatch = path.match(/^\/api\/approvals\/([^/]+)(?:\/(decision|notify))?$/);
      if (approvalMatch) {
        const session = await requireSession(request.method === "POST"); const id = encodeURIComponent(approvalMatch[1]!);
        if (request.method === "GET" && !approvalMatch[2]) return Response.json(await options.hooks().request(`/internal/approvals/${id}?viewer_user_id=${encodeURIComponent(session.email)}`));
        if (request.method === "POST" && approvalMatch[2]) {
          if (!options.approvals) throw new ServiceError("Host approvals are not configured.", 503);
          if (approvalMatch[2] === "notify") {
            z.object({}).strict().parse(await json());
            const delivery = await work(() => options.approvals!().notify(id, session.email));
            return Response.json(delivery, { status: delivery.authorizationUrls.length ? 202 : 200 });
          }
          const input = decisionSchema.parse(await json());
          const result = await work(async () => options.approvals!().decide(id, session.email, session.token, input.decision, input.note));
          if (result.authorizationUrls.length) return Response.json(result, { status: 202 });
          const committed = await options.hooks().request(`/internal/approvals/${id}?viewer_user_id=${encodeURIComponent(session.email)}`);
          if (committed.approval.status !== (input.decision === "approve" ? "approved" : "denied")) throw new ServiceError("The approval service did not commit the requested decision.", 409, result);
          return Response.json({ ...result, ...committed });
        }
      }
      if ((path === "/api/policy" || path === "/api/audit") && request.method === "GET") {
        const session = await requireSession(); const query = new URLSearchParams({ viewer_user_id: session.email });
        if (path === "/api/audit") { query.set("run_id", z.string().min(1).parse(url.searchParams.get("run_id"))); if (url.searchParams.has("after")) query.set("after", url.searchParams.get("after")!); }
        return Response.json(await options.hooks().request(`/internal/${path.slice(5)}?${query}`));
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      if (error instanceof z.ZodError) return Response.json({ error: "Invalid request", issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 });
      return Response.json({ error: error instanceof Error ? error.message : "Request failed", ...(error instanceof ServiceError && error.details ? { details: error.details } : {}) }, { status: error instanceof ServiceError ? error.status : 502 });
    }
  } };
}
