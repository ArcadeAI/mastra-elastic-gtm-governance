import { describe, expect, test } from "bun:test";
import { createRuntime, parseToolResult } from "../lib/agent-runtime";
import { MCPClient } from "@mastra/mcp";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpBoundary, names, objectSchema, scriptedModel } from "./helpers";
import { LibSQLStore } from "@mastra/libsql";
import { HooksClient } from "../lib/hooks-client";
import { createWebApp } from "../lib/web-app";

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
    [names.route]: { schema: objectSchema, execute: () => { throw new Error("Write must not be available"); } } }, (request) => gatewayRequests.push(request));
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
  let approved = false;
  const gateway = mcpBoundary({
    "Elastic.Search": { schema: objectSchema, execute: () => ({ hits: [{ id: "evt-1", content: "Enterprise trial" }] }) },
    [names.route]: { schema: objectSchema, execute: (args, user) => { actors.push(user); expect(args.operation_key).toBe(`run:${run.run_id}`); if (!approved) return { denied: true, denial_id: "denial-1" }; writes++; return { lead_id: "LD-2291", status: "qualified" }; } },
    [names.requestApproval]: { schema: objectSchema, execute: () => { notifications++; return { request_id: "approval-1", operation_key: action.operation_key, notification_status: "sent", status: "pending" }; } },
  });
  const control = Bun.serve({ port: 0, async fetch(request) {
    expect(request.headers.get("authorization")).toBe("Bearer web-test-token");
    const body = await request.json() as any;
    const path = new URL(request.url).pathname;
    if (path === "/internal/runs") run = { ...body, status: "running" };
    else if (path.endsWith("/action")) action = body;
    else if (path.endsWith("/approval")) run = { ...run, ...body, status: "awaiting_snapshot" };
    else if (path.endsWith("/suspended")) run.status = "waiting";
    else if (path.endsWith("/resume")) return Response.json({ lease_id: "lease", run, action, approval: { request_id: "approval-1", operation_key: action.operation_key, status: "approved" } });
    else if (path.endsWith("/result")) run = { ...run, ...body };
    else throw Error(`Unexpected ${path}`);
    return Response.json({ run });
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
    expect(completed.text).toContain("evt-1"); expect(writes).toBe(1); expect(notifications).toBe(1);
    expect(actors).toEqual(["dana@example.test", "dana@example.test"]);
  } finally { gateway.stop(true); control.stop(true); rmSync(directory, { recursive: true, force: true }); }
}, 20_000);

test("Arcade consent remains an actionable incomplete run, never a successful write or approval wait", async () => {
  const consent = "https://cloud.arcade.dev/auth/authorize-local-fixture";
  const gateway = mcpBoundary({ "Lead.GetLead": { schema: objectSchema, execute: () => ({ error: "Authorization required", authorization_url: consent }) } });
  const updates: any[] = [];
  const control = Bun.serve({ port: 0, async fetch(request) { const body = await request.json(); updates.push(body); return Response.json({ run: body }); } });
  const storage = new LibSQLStore({ id: "consent-proof", url: ":memory:" });
  try {
    const runtime = createRuntime({ storage, names, hooks: new HooksClient(`http://127.0.0.1:${control.port}`, "local-web"), model: scriptedModel([{ name: "Lead.GetLead", args: { lead_id: "LD-2291" } }, "Authorize Lead access to continue." ]), clientFor: () => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(gateway.url), allowedHosts: [new URL(gateway.url).host] } } }) });
    const result = await runtime.start({ stage: "governed", message: "Research the lead", userId: "dana@example.test" });
    expect(result.status).toBe("failed"); expect(result.pending).toBeNull();
    expect(result.authorizationUrls).toEqual([consent]); expect(result.toolResults[0].error).toBe("Authorization required");
    expect(updates.at(-1).status).toBe("failed"); expect(updates.at(-1).error).toContain("did not complete");
  } finally { gateway.stop(true); control.stop(true); await storage.close(); }
});
