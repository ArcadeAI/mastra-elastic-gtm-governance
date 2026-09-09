import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createHooksApp } from "../src/app";

const dana = "dana@example.test", riley = "riley@example.test";
const action = { lead_id: "LD-2291", estimated_acv: 95000, owner_email: "drew@sales.example", rationale: "Enterprise SOURCE_SECRET", operation_key: "edge-operation" };
let app: ReturnType<typeof createHooksApp>;
let server: ReturnType<typeof Bun.serve>, dependency: ReturnType<typeof Bun.serve>;
let now: number, value: number;
let valueGate: Promise<void> | null, valueEntered: (() => void) | null;

function hook(actor = dana, inputs = action, name = "RouteLead") {
  return { execution_id: crypto.randomUUID(), tool: { toolkit: "Lead", name, version: "1.0.0" }, inputs, context: { user_id: actor } };
}
async function call(path: string, body?: unknown, token: string | null = "hook", headers: Record<string, string> = {}, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(new URL(path, server.url), { method, headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
}
async function ok(path: string, body?: unknown, token = "hook", headers: Record<string, string> = {}, method?: string) {
  const result = await call(path, body, token, headers, method);
  expect(result.status).toBe(200);
  return result.body;
}
async function policy() { return ok("/operator/policy", undefined, "operator"); }
async function updatePolicy(doc: unknown) { return ok("/operator/policy", doc, "operator", {}, "PUT"); }
async function denial(actor = dana) {
  const response = await ok("/pre", hook(actor));
  expect(response.code).toBe("CHECK_FAILED");
  const id = /denial_id="([^"]+)"/.exec(response.error_message)?.[1];
  expect(id).toBeDefined();
  return id!;
}
async function approval() {
  return ok("/internal/approvals/request", { denial_id: await denial(), requester_id: dana, justification: "Review enterprise fit" }, "approvals");
}
async function claim(id: string) {
  return ok(`/internal/approvals/${id}/notification/claim`, { requester_id: dana, slack_user_id: "UATTENDEE", slack_team_id: "TWORKSHOP" }, "approvals");
}
async function decide(id: string, decision = "approve") {
  return call(`/internal/approvals/${id}/decision`, { actor_id: riley, decision }, "approvals", { "X-Actor-Token": "riley-oauth" });
}
async function readApproval(id: string) {
  return ok(`/internal/approvals/${id}?viewer_user_id=${dana}`, undefined, "web");
}
async function waitingRun(trace: { text?: string; tool_calls?: unknown[] } = {}) {
  await ok("/internal/runs", { run_id: "run-edge", requester_user_id: dana, stage: "governed", message: "Research and route" }, "web");
  await ok("/internal/runs/run-edge/action", { operation_key: action.operation_key, tool_name: "Lead.RouteLead", arguments: action }, "web");
  const request = await approval(), delivery = await claim(request.request_id);
  await ok(`/internal/approvals/${request.request_id}/notification/result`, { requester_id: dana, claim_id: delivery.claim_id, outcome: "sent", channel: "DSELF", ts: "100.001" }, "approvals");
  await ok("/internal/runs/run-edge/approval", { request_id: request.request_id, operation_key: action.operation_key, tool_call_id: "waiting" }, "web");
  await ok("/internal/runs/run-edge/suspended", { tool_call_id: "waiting", ...trace }, "web");
  return request;
}

beforeEach(async () => {
  now = Date.now(); value = 95000; valueGate = null; valueEntered = null;
  dependency = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/oauth2/userinfo") return req.headers.get("authorization") === "Bearer riley-oauth" ? Response.json({ email: riley }) : new Response("Unauthorized", { status: 401 });
    if (req.headers.get("authorization") !== "Bearer lead-internal") return new Response("Unauthorized", { status: 401 });
    if (path.startsWith("/internal/operations/")) return new Response("Missing", { status: 404 });
    if (path === "/internal/leads/LD-2291/value") { valueEntered?.(); if (valueGate) await valueGate; return Response.json({ lead_id: "LD-2291", estimated_acv: value }); }
    return new Response("Missing", { status: 404 });
  } });
  app = createHooksApp({ dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web", leadHost: dependency.url.origin, leadToken: "lead-internal", idpHost: dependency.url.origin, webOrigin: "http://localhost:3000", subjectEmails: { dana, riley, sam: "sam@example.test", morgan: "morgan@example.test" }, verificationUserId: "verify@example.test", elasticTools: [{ toolkit: "Elastic", name: "Observed_Search", arguments: ["query"] }], soloSlackDelivery: true, allowedSlackTeamId: "TWORKSHOP", now: () => now });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  await denial("verify@example.test");
  await ok("/post", { ...hook("verify@example.test", {} as typeof action, "GetLead"), success: true, output: { personal_phone: "+1-415-555-0137" } });
  await ok("/operator/activate", {}, "operator");
});
afterEach(() => { server?.stop(true); dependency?.stop(true); app?.close(); });

test("approval display applies output policy for the original action tool", async () => {
  const doc = await policy();
  doc.output_rules.push({ ...doc.output_rules[0], id: "route-rationale", match: { toolkit: "Lead", tool: "RouteLead" }, fields: [], patterns: [{ id: "source-secret", regex: "SOURCE_SECRET", strategy: "remove" }] });
  await updatePolicy(doc);
  const request = await approval();
  expect(request.inputs.rationale).toContain("Enterprise");
  expect(JSON.stringify(request)).not.toContain("SOURCE_SECRET");
});

test("pre checks authority changed while authoritative lookup was pending", async () => {
  const initial = await policy(); initial.subjects.find((s: any) => s.user_id === dana).clearance = 100000;
  await updatePolicy(initial);
  let release!: () => void;
  valueGate = new Promise(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { valueEntered = resolve; });
  const pending = call("/pre", hook());
  await entered;
  const reduced = await policy(); reduced.subjects.find((s: any) => s.user_id === dana).clearance = 50000;
  await updatePolicy(reduced);
  release();
  expect((await pending).body.code).toBe("CHECK_FAILED");
});

test("closing an expired approval cannot overwrite a completed run", async () => {
  const request = await waitingRun();
  expect((await decide(request.request_id)).status).toBe(200);
  const resume = await ok("/internal/runs/run-edge/resume", { actor_user_id: riley }, "web");
  await ok("/internal/runs/run-edge/result", { lease_id: resume.lease_id, status: "completed", text: "Northwind routed", tool_calls: [] }, "web");
  now += 16 * 60_000;
  expect((await call("/internal/runs/run-edge/close", { actor_user_id: dana }, "web")).status).toBe(409);
  expect((await ok("/internal/runs/run-edge/resume", { actor_user_id: dana }, "web")).run.text).toBe("Northwind routed");
});

for (const path of ["/internal/approvals/request", "/internal/approvals/not-a-request/notification/claim", "/internal/approvals/not-a-request/notification/result", "/internal/approvals/not-a-request/decision"]) {
  for (const token of [null, "wrong", "web", "operator", "hook"]) test(`${path} rejects ${token ?? "missing"} service credential`, async () => {
    expect((await call(path, {}, token)).status).toBe(401);
  });
}

test("a foreign requester cannot turn an owned denial into an approval", async () => {
  const response = await call("/internal/approvals/request", { denial_id: await denial(), requester_id: riley, justification: "Forged owner" }, "approvals");
  expect(response.status).toBe(403);
});

test("an expired denial cannot create a new approval", async () => {
  const id = await denial(); now += 16 * 60_000;
  expect((await call("/internal/approvals/request", { denial_id: id, requester_id: dana, justification: "Late request" }, "approvals")).status).toBe(410);
});

test("a stalled sending claim never becomes eligible for automatic repost", async () => {
  const request = await approval(), first = await claim(request.request_id);
  expect(first.claim_id).toBeTruthy(); now += 5 * 60_000;
  expect(await claim(request.request_id)).toEqual({ claim_id: null, notification_status: "sending" });
});

test("a decision rechecks the assigned approver's current authority", async () => {
  const request = await approval();
  const doc = await policy(); doc.subjects.find((s: any) => s.user_id === riley).clearance = 50000;
  await updatePolicy(doc);
  expect((await decide(request.request_id)).status).toBe(403);
  expect((await readApproval(request.request_id)).approval.status).toBe("pending");
});

test("a decision rechecks the lead's authoritative value", async () => {
  const request = await approval(); value = 300000;
  expect((await decide(request.request_id)).status).toBe(403);
  expect((await readApproval(request.request_id)).approval.status).toBe("pending");
});

test("operator evidence joins safe initial and resumed traces with canonical receipt binding", async () => {
  const request = await waitingRun({ text: "Waiting after EVT-1", tool_calls: [{ toolCallId: "research-1", result: { source: "EVT-1", personal_phone: "+1-415-555-0137" } }] });
  expect((await decide(request.request_id)).status).toBe(200);
  const claim = await ok("/internal/runs/run-edge/resume", { actor_user_id: riley }, "web");
  expect((await call("/internal/runs/run-edge/result", { lease_id: "stale", status: "completed", text: "Forged" }, "web")).status).toBe(409);
  const waiting = await ok("/operator/runs/run-edge/evidence", undefined, "operator");
  expect(waiting.run.resumed_at).toBeNull();
  expect(waiting.run.tool_calls).toEqual([{ toolCallId: "research-1", result: { source: "EVT-1" } }]);
  await ok("/internal/runs/run-edge/result", { lease_id: claim.lease_id, status: "completed", text: "Routed based on EVT-1", tool_calls: [{ toolCallId: "route-1", result: { lead_id: "LD-2291" } }] }, "web");
  const evidence = await ok("/operator/runs/run-edge/evidence", undefined, "operator");
  expect(evidence.run.resumed_at).toBe(new Date(now).toISOString());
  expect(evidence.run.tool_calls.map((t: any) => t.toolCallId)).toEqual(["research-1", "route-1"]);
  expect(evidence.approval.request_id).toBe(request.request_id);
  expect(evidence.action.operation_key).toBe(action.operation_key);
  expect(evidence.action.arguments).toBeUndefined();
  expect(evidence.denial).toEqual({ execution_id: expect.any(String), operation_key: action.operation_key, request_id: request.request_id, requester_id: dana, tool_name: "Lead.RouteLead" });
  expect(evidence.events.some((event: any) => event.decision === "deny" && event.execution_id === evidence.denial.execution_id && event.user_id === dana && event.tool === evidence.denial.tool_name)).toBe(true);
  const binding = `{"action":"route","actor":"${dana}","body":{"estimated_acv":95000,"owner_email":"drew@sales.example","rationale":"Enterprise SOURCE_SECRET"},"lead_id":"LD-2291"}`;
  expect(evidence.action.receipt_binding_hash).toBe(createHash("sha256").update(binding).digest("hex"));
  expect(evidence.events.some((event: any) => event.decision === "approved" && event.request_id === request.request_id)).toBe(true);
  expect(JSON.stringify(evidence)).not.toContain("+1-415-555-0137");
  expect((await call("/operator/runs/run-edge/evidence", undefined, "web")).status).toBe(401);
});

test("operator state increments reset epoch only after a successful reset", async () => {
  expect(await ok("/operator/state", undefined, "operator")).toEqual({ active: true, verified_denial: true, verified_filter: true, active_run_count: 0, reset_epoch: 0 });
  await ok("/internal/runs", { run_id: "run-edge", requester_user_id: dana, stage: "governed", message: "Research" }, "web");
  expect((await call("/operator/reset", {}, "operator")).status).toBe(409);
  expect((await ok("/operator/state", undefined, "operator")).reset_epoch).toBe(0);
  await ok("/internal/runs/run-edge/result", { status: "failed", error: "Stopped" }, "web");
  await ok("/operator/reset", {}, "operator");
  expect(await ok("/operator/state", undefined, "operator")).toEqual({ active: false, verified_denial: false, verified_filter: false, active_run_count: 0, reset_epoch: 1 });
});

test("operator recovery requires the expired current lease and stopped worker attestation", async () => {
  const request = await waitingRun();
  expect((await decide(request.request_id)).status).toBe(200);
  const claim = await ok("/internal/runs/run-edge/resume", { actor_user_id: riley }, "web");
  const path = "/operator/runs/run-edge/recover";
  expect((await call(path, { lease_id: claim.lease_id, worker_stopped: true }, "operator")).status).toBe(409);
  now += 6 * 60_000;
  expect((await call(path, { lease_id: claim.lease_id }, "operator")).status).toBe(409);
  expect((await call(path, { lease_id: "stale", worker_stopped: true }, "operator")).status).toBe(409);
  expect((await ok(path, { lease_id: claim.lease_id, worker_stopped: true }, "operator")).run.status).toBe("waiting");
  expect((await call("/internal/runs/run-edge/result", { lease_id: claim.lease_id, status: "completed" }, "web")).status).toBe(409);
  const next = await ok("/internal/runs/run-edge/resume", { actor_user_id: riley }, "web");
  expect(next.lease_id).not.toBe(claim.lease_id);
});
