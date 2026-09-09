import { describe, expect, test } from "bun:test";
import { createRuntime, parseToolResult } from "../lib/agent-runtime";
import { MCPClient } from "@mastra/mcp";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discountArguments, mcpBoundary, names, objectSchema, scriptedModel } from "./helpers";
import { LibSQLStore } from "@mastra/libsql";
import { HooksClient } from "../lib/hooks-client";
import { createWebApp } from "../lib/web-app";

// These loopback control services stop between cases. Closing each response
// prevents Bun's HTTP pool retaining sockets for a later reuse of the same port.
function controlResponse(body: unknown) {
  return Response.json(body, { headers: { connection: "close" } });
}

function apiFor(runtime: ReturnType<typeof createRuntime>) {
  return createWebApp({ runtime: () => runtime, session: () => { throw Error("Early stages must not require identity"); }, hooks: () => { throw Error("Early stages must not require hooks"); }, arcadeKey: () => { throw Error("The verifier is not part of early stages"); } });
}
function researchRequest() { return new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: "elastic", message: "What evidence supports qualifying Northwind, and what is missing?" }) }); }

const model = {
  specificationVersion: "v2" as const,
  provider: "workshop-test",
  modelId: "scripted",
  supportedUrls: {},
  async doGenerate() {
    return { content: [{ type: "text" as const, text: "Recommendation: follow_up. Evidence: supplied lead." }],
      finishReason: "stop" as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] };
  },
  async doStream(): Promise<never> { throw new Error("Unexpected stream"); },
};

describe("ATT1.R1 supplied stage", () => {
  test("runs the actual agent with only a model and no other services", async () => {
    const runtime = createRuntime({ model });
    const result = await runtime.start({ stage: "supplied", message: "Research the supplied lead." });
    expect(result.text).toContain("supplied lead");
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toEqual([]);
  });

  test("Elastic fails visibly without a gateway instead of using supplied input", async () => {
    const runtime = createRuntime({ model });
    await expect(runtime.start({ stage: "elastic", message: "Research Northwind." })).rejects.toThrow("gateway");
  });
});

test("ATT1.R1 a configured but unreachable MCP gateway returns an API failure without calling the model", async () => {
  const closed = Bun.serve({ port: 0, fetch: () => new Response() });
  const address = new URL(closed.url); closed.stop(true);
  const observed: any[] = [];
  const runtime = createRuntime({ model: scriptedModel(["A supplied fallback would be incorrect"], observed), danaUserId: "dana@example.test", elasticTools: ["Elastic.Search"],
    clientFor: () => new MCPClient({ id: crypto.randomUUID(), timeout: 500, servers: { arcade: { url: address, allowedHosts: [address.host] } } }) });
  const response = await apiFor(runtime).fetch(researchRequest());
  const body = await response.json() as any;
  expect(response.status).toBe(503); expect(body.error).toMatch(/gateway|discovery|tools/i);
  expect(body.text).toBeUndefined(); expect(observed).toEqual([]);
});

test("ATT1.R2 Elastic retrieves two cited events with only evidence tools and no direct setup credential", async () => {
  const observed: any[] = [], gatewayRequests: unknown[] = [];
  const previous = { url: process.env.ELASTICSEARCH_URL, key: process.env.ELASTIC_API_KEY };
  const setupUrl = "https://operator-only-elastic.example.invalid", setupKey = "operator-only-elastic-seed-secret";
  process.env.ELASTICSEARCH_URL = setupUrl; process.env.ELASTIC_API_KEY = setupKey;
  const gateway = mcpBoundary({ "Elastic.Search": { schema: objectSchema, execute: () => ({ hits: [{ id: "evt-1", content: "Enterprise trial" }, { id: "evt-2", content: "SAML requirement" }] }) },
    [names.discount]: { schema: objectSchema, execute: () => { throw new Error("Write must not be available"); } } }, (request) => gatewayRequests.push(request));
  try {
    const runtime = createRuntime({ model: scriptedModel([{ name: "Elastic.Search", args: { query: "Northwind" } }, "Evidence evt-1 and evt-2 support enterprise interest."], observed), danaUserId: "dana@example.test", elasticTools: ["Elastic.Search"],
      clientFor: () => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(gateway.url), allowedHosts: [new URL(gateway.url).host] } } }) });
    const response = await apiFor(runtime).fetch(researchRequest()); const result = await response.json() as any;
    expect(response.status).toBe(200); expect(result.text).toContain("evt-1"); expect(result.text).toContain("evt-2");
    expect(observed[0].tools.map((tool: any) => tool.description)).toEqual(["Elastic.Search"]);
    expect(JSON.stringify(observed[1].prompt)).toContain("Enterprise trial"); expect(JSON.stringify(observed[1].prompt)).toContain("SAML requirement");
    expect(result.toolCalls.map((call: any) => call.mcpName)).toEqual(["Elastic.Search"]);
    expect(gatewayRequests.length).toBeGreaterThan(1);
    for (const serialized of [JSON.stringify(observed), JSON.stringify(gatewayRequests)]) { expect(serialized).not.toContain(setupUrl); expect(serialized).not.toContain(setupKey); }
  } finally { gateway.stop(true); if (previous.url === undefined) delete process.env.ELASTICSEARCH_URL; else process.env.ELASTICSEARCH_URL = previous.url; if (previous.key === undefined) delete process.env.ELASTIC_API_KEY; else process.env.ELASTIC_API_KEY = previous.key; }
});

test("ATT1.R2 empty retrieved evidence reaches the model and its missing-evidence response remains visible", async () => {
  const observed: any[] = [];
  const gateway = mcpBoundary({ "Elastic.Search": { schema: objectSchema, execute: () => ({ hits: [] }) } });
  const missing = "No Northwind evidence was returned. Qualification remains unsupported; no source IDs are available.";
  try {
    const runtime = createRuntime({ model: scriptedModel([{ name: "Elastic.Search", args: { query: "Northwind" } }, (input) => {
      // This proves transmission and response handling, not a live model's factual judgment.
      const messages = input.prompt.filter((message: any) => message.role === "tool");
      expect(messages).toHaveLength(1);
      expect(parseToolResult(messages[0].content[0].output.value)).toEqual({ hits: [] });
      return missing;
    }], observed), danaUserId: "dana@example.test", elasticTools: ["Elastic.Search"], clientFor: () => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(gateway.url), allowedHosts: [new URL(gateway.url).host] } } }) });
    const response = await apiFor(runtime).fetch(researchRequest()); const result = await response.json() as any;
    expect(response.status).toBe(200); expect(result.text).toBe(missing); expect(result.text).not.toMatch(/evt-/);
    expect(result.toolCalls.map((call: any) => call.mcpName)).toEqual(["Elastic.Search"]);
    expect(observed[1].prompt[0].content).toContain("do not invent sources");
  } finally { gateway.stop(true); }
});

test("ATT1.R6 native waiting snapshot survives a process exit and resumes the original requester", async () => {
  const directory = mkdtempSync(join(tmpdir(), "workshop-runtime-"));
  let run: any; let action: any; let notifications = 0; let writes = 0; const actors: string[] = [];
  let approved = false; let reads = 0;
  const offer = { account_id: "ACC-2291", offer_id: "OFF-restart", discount_percent: 30, list_price: 12000, net_price: 8400, status: "draft", follow_up_email: { to: "elena@northwindrobotics.example", subject: "Draft offer", body: "Local follow-up email draft; no email sent." } };
  const gateway = mcpBoundary({
    "Elastic.Search": { schema: objectSchema, execute: () => ({ hits: [{ id: "evt-1", content: "Enterprise trial" }] }) },
    [names.discount]: { schema: objectSchema, execute: (args, user) => { actors.push(user); expect(args.operation_key).toBe(`run:${run.run_id}`); if (!approved) return { denied: true, denial_id: "denial-1" }; writes++; return offer; } },
    [names.getOffer]: { schema: objectSchema, execute: (args, user) => { expect(writes).toBe(1); expect(args).toEqual({ account_id: offer.account_id }); expect(user).toBe("dana@example.test"); reads++; return offer; } },
  });
  let approval: any;
  const control = Bun.serve({ port: 0, async fetch(request) {
    const body = request.method === "POST" ? await request.json() as any : {};
    const path = new URL(request.url).pathname;
    if (path === "/v1/auth/authorize") return controlResponse({ id: "auth", status: "completed", context: { token: "local-slack" } });
    if (path === "/slack/auth.test") return controlResponse({ ok: true, user_id: "ULOCAL", team_id: "TLOCAL" });
    if (path === "/slack/conversations.open") return controlResponse({ ok: true, channel: { id: "DSELF" } });
    if (path === "/slack/chat.postMessage") { notifications++; return controlResponse({ ok: true, channel: "DSELF", ts: "100.1" }); }
    expect(request.headers.get("authorization")).toBe("Bearer web-test-token");
    if (path === "/internal/approvals/request") {
      approval = { request_id: "approval-1", requester_id: "dana@example.test", approver_id: "riley@example.test", requester_name: "Dana", approver_name: "Riley", operation_key: action.operation_key, tool_name: names.discount, inputs: action.arguments, resource_id: "ACC-2291", required_clearance: 30, status: "pending", notification_status: "pending", approval_url: "http://localhost/approvals/approval-1" };
      return controlResponse(approval);
    }
    if (path.endsWith("/delivery")) return controlResponse(approval);
    if (path.endsWith("/notification/claim")) { approval.notification_status = "sending"; return controlResponse({ claim_id: "claim-1", notification_status: "sending" }); }
    if (path.endsWith("/notification/result")) { approval.notification_status = "sent"; return controlResponse(approval); }
    if (path === "/internal/runs") run = { ...body, status: "running" };
    else if (path.endsWith("/action")) action = body;
    else if (path.endsWith("/approval")) run = { ...run, ...body, status: "awaiting_snapshot" };
    else if (path.endsWith("/suspended")) run = { ...run, ...body, status: "waiting" };
    else if (path.endsWith("/resume")) return controlResponse({ lease_id: "lease", run, action, approval: { ...approval, status: "approved" } });
    else if (path.endsWith("/result")) run = { ...run, ...body };
    else throw Error(`Unexpected ${path}`);
    return controlResponse({ run });
  } });
  async function worker(phase: string) {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "runtime-worker.ts"), phase, `file:${directory}/agent.db`, `http://127.0.0.1:${gateway.port}`, `http://127.0.0.1:${control.port}`, run?.run_id ?? ""], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status !== 0) throw Error(`${stdout}\n${stderr}`);
    return JSON.parse(stdout.split("\n").find((line) => line.startsWith("RESULT "))!.slice(7));
  }
  try {
    const waiting = await worker("start");
    expect(waiting.status).toBe("waiting"); expect(writes).toBe(0); expect(notifications).toBe(1);
    approved = true;
    const completed = await worker("resume");
    expect(completed.status).toBe("completed"); expect(completed.text).toContain("evt-1"); expect(writes).toBe(1); expect(reads).toBe(1); expect(notifications).toBe(1);
    expect(actors).toEqual(["dana@example.test", "dana@example.test"]);
  } finally { gateway.stop(true); control.stop(true); rmSync(directory, { recursive: true, force: true }); }
}, 20_000);

test("Arcade consent remains an actionable incomplete run, never a successful write or approval wait", async () => {
  const consent = "https://cloud.arcade.dev/auth/authorize-local-fixture";
  const gateway = mcpBoundary({ "Sales.GetAccount": { schema: objectSchema, execute: () => ({ error: "Authorization required", authorization_url: consent }) }, [names.discount]: { schema: objectSchema, execute: () => { throw new Error("Consent test must not create an offer"); } }, [names.getOffer]: { schema: objectSchema, execute: () => { throw new Error("Consent test must not read an offer"); } } });
  const updates: any[] = [];
  const control = Bun.serve({ port: 0, async fetch(request) { const body = await request.json(); updates.push(body); return controlResponse({ run: body }); } });
  const storage = new LibSQLStore({ id: "consent-proof", url: ":memory:" });
  try {
    const runtime = createRuntime({ storage, names, hooks: new HooksClient(`http://127.0.0.1:${control.port}`, "local-web"), model: scriptedModel([{ name: "Sales.GetAccount", args: { account_id: "ACC-2291" } }, "Authorize Lead access to continue." ]), clientFor: () => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(gateway.url), allowedHosts: [new URL(gateway.url).host] } } }) });
    const result = await runtime.start({ stage: "governed", message: "Research the lead", userId: "dana@example.test" });
    expect(result.status).toBe("failed"); expect(result.pending).toBeNull();
    expect(result.authorizationUrls).toEqual([consent]); expect(result.toolResults[0].error).toBe("Authorization required");
    expect(updates.at(-1).status).toBe("failed"); expect(updates.at(-1).error).toContain("did not complete");
  } finally { gateway.stop(true); control.stop(true); await storage.close(); }
});

test("a stale discount tool name fails before the model can execute an untracked write", async () => {
  let writes = 0; const observed: any[] = [];
  const gateway = mcpBoundary({ "Actual_Discount": { schema: objectSchema, execute: () => { writes++; return { account_id: "ACC-2291" }; } } });
  const storage = new LibSQLStore({ id: "name-check", url: ":memory:" });
  try {
    const runtime = createRuntime({ names: { discount: "Stale_Discount", getOffer: names.getOffer }, storage, hooks: new HooksClient("http://localhost:1", "local"), model: scriptedModel([{ name: "Actual_Discount", args: {} }], observed), clientFor: () => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(gateway.url), allowedHosts: [new URL(gateway.url).host] } } }) });
    await expect(runtime.start({ stage: "governed", userId: "dana@example.test", message: "Prepare 30% off" })).rejects.toThrow("discount tool");
    expect(writes).toBe(0); expect(observed).toEqual([]);
  } finally { gateway.stop(true); await storage.close(); }
});

test("duplicate write and read tool names fail before gateway or model execution", async () => {
  let writes = 0; let run: any; const observed: any[] = [], methods: string[] = [];
  const gateway = mcpBoundary({ [names.discount]: { schema: objectSchema, execute: () => { writes++; return { account_id: "ACC-2291", offer_id: "OFF-duplicate" }; } } }, request => methods.push((request.rpc as any).method));
  const control = Bun.serve({ port: 0, async fetch(request) { const body = await request.json(); run = { ...run, ...body }; return controlResponse({ run }); } });
  const storage = new LibSQLStore({ id: "duplicate-name", url: ":memory:" });
  try {
    const runtime = createRuntime({ names: { discount: names.discount, getOffer: names.discount }, storage, hooks: new HooksClient(String(control.url), "local"), model: scriptedModel([{ name: names.discount, args: { ...discountArguments, discount_percent: 15 } }, "The offer was saved."], observed), clientFor: () => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(gateway.url), allowedHosts: [new URL(gateway.url).host] } } }) });
    await expect(runtime.start({ stage: "governed", userId: "dana@example.test", message: "Prepare a 15% offer" })).rejects.toThrow("must be different");
    expect(writes).toBe(0); expect(observed).toEqual([]); expect(methods).toEqual([]); expect(run).toBeUndefined();
  } finally { gateway.stop(true); control.stop(true); await storage.close(); }
});

test.each(["matching", "skipped", "wrong net price", "read error", "empty recipient", "blank subject", "empty body", "changed recipient", "changed subject", "changed body", "empty creation body", "different metadata"] as const)("15 percent offer completion requires an actual matching readback: %s", async readback => {
  const submitted = { ...discountArguments, discount_percent: 15 };
  const saved = { account_id: submitted.account_id, offer_id: "OFF-local-readback", discount_percent: 15, list_price: 12000, net_price: 10200, status: "draft", follow_up_email: { to: "elena@northwindrobotics.example", subject: "Local draft", body: "Local follow-up email draft. No email sent." } };
  if (readback === "empty creation body") saved.follow_up_email.body = "";
  const emailChange = readback === "empty recipient" ? { to: "" } : readback === "blank subject" ? { subject: "   " } : readback === "empty body" ? { body: "" } : readback === "changed recipient" ? { to: "elsewhere@example.test" } : readback === "changed subject" ? { subject: "Different subject" } : readback === "changed body" ? { body: "Different offer email" } : readback === "different metadata" ? { format_hint: "text" } : {};
  let writes = 0; let reads = 0; let run: any;
  const paths: string[] = [];
  const gateway = mcpBoundary({
    [names.discount]: { schema: objectSchema, execute: args => { expect(args).toEqual({ ...submitted, operation_key: `run:${run.run_id}` }); writes++; return { ...saved, follow_up_email: { ...saved.follow_up_email, format_hint: "plain" } }; } },
    [names.getOffer]: { schema: objectSchema, execute: args => { expect(writes).toBe(1); expect(args).toEqual({ account_id: submitted.account_id }); reads++; return readback === "read error" ? { error: "Saved offer service unavailable" } : { ...saved, follow_up_email: { ...saved.follow_up_email, ...emailChange }, ...(readback === "wrong net price" ? { net_price: 12000 } : {}) }; } },
  });
  const control = Bun.serve({ port: 0, async fetch(request) {
    const path = new URL(request.url).pathname; paths.push(path); const body = await request.json() as any;
    if (path === "/internal/runs") run = { ...body, status: "running" };
    else if (path.endsWith("/action")) expect(body.arguments.discount_percent).toBe(15);
    else if (path.endsWith("/result")) run = { ...run, ...body };
    else throw Error(`Unexpected control-plane call ${path}`);
    return controlResponse({ run });
  } });
  const storage = new LibSQLStore({ id: `readback-${readback}`, url: ":memory:" });
  const claim = "The offer was saved and checked successfully.";
  try {
    const steps = [{ name: names.discount, args: submitted }, ...(readback === "skipped" ? [] : [{ name: names.getOffer, args: { account_id: submitted.account_id } }]), claim];
    const runtime = createRuntime({ names, storage, hooks: new HooksClient(String(control.url), "local-web"), model: scriptedModel(steps), clientFor: () => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(gateway.url), allowedHosts: [new URL(gateway.url).host] } } }) });
    const result = await runtime.start({ stage: "governed", userId: "dana@example.test", message: "Prepare a 15% offer and verify its saved draft." });
    expect(writes).toBe(1); expect(reads).toBe(readback === "skipped" ? 0 : 1);
    expect(paths.some(path => path.includes("approvals"))).toBe(false);
    expect(result.pending).toBeNull(); expect(result.text).toBe(claim);
    const matching = readback === "matching" || readback === "different metadata";
    expect(result.status).toBe(matching ? "completed" : "failed");
    expect(run.status).toBe(result.status);
    const error = "error" in result ? result.error : undefined;
    if (matching) expect(error).toBeUndefined();
    else { expect(error).toContain("offer was saved"); expect(error).toContain("GetOffer"); }
  } finally { gateway.stop(true); control.stop(true); await storage.close(); }
});
