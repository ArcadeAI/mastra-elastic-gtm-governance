import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fixtureEvents, GOVERNED_PHONE, GOVERNED_INSTRUCTION } from "./seed-elastic";

const servers: ReturnType<typeof Bun.serve>[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function temp() { const dir = await mkdtemp(join(tmpdir(), "workshop-cli-")); dirs.push(dir); return dir; }
function serve(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch }); servers.push(server); return `http://127.0.0.1:${server.port}`;
}
function mcp(names: string[], methods: string[] = []) {
  return serve(async request => {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const body = await request.json() as any;
    methods.push(body.method);
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = body.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "controlled-gateway", version: "1" } } : body.method === "tools/list" ? { tools: names.map(name => ({ name, description: `Observed ${name}`, inputSchema: { type: "object", properties: {} } })) } : null;
    return Response.json({ jsonrpc: "2.0", id: body.id, ...(result ? { result } : { error: { code: -32601, message: "No execution in this test" } }) });
  });
}
function gatewayConfig(url: string) {
  return { ARCADE_API_KEY: "arcade-test-secret", ARCADE_MCP_URL: url, PERSONA_DANA_EMAIL: "dana@example.test", ARCADE_ELASTIC_TOOL_NAMES: "Observed_Search" };
}
function elastic() {
  const documents = new Map<string, any>();
  const requests: Array<{ method: string; path: string; auth: string | null }> = [];
  const url = serve(async request => {
    const path = new URL(request.url).pathname;
    requests.push({ method: request.method, path, auth: request.headers.get("authorization") });
    if (path === "/context/_delete_by_query") { const deleted = documents.size; documents.clear(); return Response.json({ deleted, version_conflicts: 0, failures: [] }); }
    if (path === "/_bulk") {
      const lines = (await request.text()).trim().split("\n").map(line => JSON.parse(line));
      for (let i = 0; i < lines.length; i += 2) documents.set(lines[i].index._id, lines[i + 1]);
      return Response.json({ errors: false, items: [] });
    }
    if (path === "/context/_search") return Response.json({ hits: { total: { value: documents.size, relation: "eq" }, hits: [...documents].map(([_id, _source]) => ({ _id, _source })) } });
    return Response.json({ acknowledged: true });
  });
  return { documents, requests, config: { ELASTICSEARCH_URL: url, ELASTIC_API_KEY: "elastic-test-secret", ELASTIC_GTM_INDEX: "context" } };
}
function proof() {
  const body = { estimated_acv: 95000, owner_email: "drew@sales.example", rationale: "Enterprise security evidence evt-northwind-003" };
  const receipt = { operation_key: "run:run-test", actor: "dana@example.test", action: "route", lead_id: "LD-2291", body, completed_at: "2026-09-08T12:03:00.000Z" };
  const canonical = (value: any): string => value && typeof value === "object" ? Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
  const binding = { actor: receipt.actor, action: receipt.action, lead_id: receipt.lead_id, body };
  const hash = createHash("sha256").update(canonical(binding)).digest("hex");
  const evidence: any = {
    run: { run_id: "run-test", requester_user_id: receipt.actor, stage: "governed", status: "completed", request_id: "request-test", operation_key: receipt.operation_key, tool_call_id: "approval-tool-call", created_at: "2026-09-08T12:00:00.000Z", resumed_at: "2026-09-08T12:04:00.000Z", text: "Routed Northwind using security evidence [evt-northwind-003].", error: null, tool_calls: [{ name: "Observed_Search", args: { query: "Northwind" } }, { name: "Exact_Route", args: { ...body, lead_id: receipt.lead_id, operation_key: receipt.operation_key } }] },
    approval: { request_id: "request-test", requester_id: receipt.actor, approver_id: "riley@example.test", operation_key: receipt.operation_key, resource_id: receipt.lead_id, status: "approved", notification_status: "sent", grant_id: "grant-test", decided_at: "2026-09-08T12:02:00.000Z", expires_at: "2026-09-08T12:15:00.000Z", channel: "D123", ts: "1788868860.000001" },
    action: { operation_key: receipt.operation_key, tool_name: "Exact_Route", arguments_hash: createHash("sha256").update(canonical({ ...body, lead_id: receipt.lead_id, operation_key: receipt.operation_key })).digest("hex"), receipt_binding_hash: hash },
    denial: { execution_id: "denied-execution", operation_key: receipt.operation_key, request_id: "request-test", requester_id: receipt.actor, tool_name: "Lead.RouteLead" },
    events: [
      { seq: 1, id: "event-1", ts: "2026-09-08T12:00:10.000Z", user_id: receipt.actor, tool: "Elastic.Search", decision: "modify", hook: "post", execution_id: "elastic-execution", success: true, after: { content: [{ type: "text", text: JSON.stringify({ event_id: "evt-northwind-003", content: "SAML SSO and residency questions" }) }] } },
      { seq: 2, id: "event-2", ts: "2026-09-08T12:00:20.000Z", user_id: receipt.actor, tool: "Lead.RouteLead", decision: "deny", hook: "pre", execution_id: "denied-execution" },
      { seq: 3, id: "event-3", ts: "2026-09-08T12:01:00.000Z", user_id: receipt.actor, tool: "Lead.RouteLead", decision: "approval_requested", request_id: "request-test", operation_key: receipt.operation_key },
      { seq: 4, id: "event-4", ts: "2026-09-08T12:01:01.000Z", user_id: receipt.actor, tool: "Lead.RouteLead", decision: "notification", request_id: "request-test", status: "sent", channel: "D123", ts_slack: "unused" },
      { seq: 5, id: "event-5", ts: "2026-09-08T12:02:00.000Z", user_id: receipt.actor, tool: "Lead.RouteLead", decision: "approved", request_id: "request-test", operation_key: receipt.operation_key, grant_id: "grant-test", approver_id: "riley@example.test", verified_subject: "riley-idp-subject" },
      { seq: 6, id: "event-6", ts: "2026-09-08T12:02:30.000Z", user_id: receipt.actor, tool: "Lead.RouteLead", decision: "allow", hook: "pre", execution_id: "write-execution", operation_key: receipt.operation_key },
    ],
  };
  // The owner stores Slack's receipt timestamp in the notification event's ts field.
  evidence.events[3].ts = evidence.approval.ts;
  return { evidence, receipt };
}
function evidenceService(evidence: any, receipt: any, requests: string[]) {
  const host = serve(request => {
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (path === "/operator/runs/run-test/evidence") return request.headers.get("authorization") === "Bearer operator-test-secret" ? Response.json(evidence) : new Response(null, { status: 401 });
    if (path === "/internal/operations/run%3Arun-test") return request.headers.get("authorization") === "Bearer lead-test-secret" ? Response.json(receipt) : new Response(null, { status: 401 });
    return new Response(null, { status: 404 });
  });
  return { HOOKS_PUBLIC_HOST: host, LEAD_APP_PUBLIC_HOST: host, WORKSHOP_OPERATOR_TOKEN: "operator-test-secret", LEAD_INTERNAL_TOKEN: "lead-test-secret", PERSONA_DANA_EMAIL: "dana@example.test", PERSONA_RILEY_EMAIL: "riley@example.test", ARCADE_ELASTIC_TOOL_NAMES: "Observed_Search", ARCADE_ELASTIC_HOOK_TOOLS: '[{"toolkit":"Elastic","name":"Search","arguments":["query"]}]', ARCADE_ROUTE_TOOL_NAME: "Exact_Route" };
}
async function cli(args: string[], config: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "scripts/workshop.ts", ...args], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { PATH: process.env.PATH!, ...config }, stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, out, err, json: () => JSON.parse(out) };
}

describe("workshop operator CLI", () => {
  test("supplied readiness only needs model configuration but does not claim a model call", async () => {
    const result = await cli(["readiness", "--stage", "supplied"], { ANTHROPIC_API_KEY: "model-test-secret" });
    expect(result.code, result.out + result.err).toBe(0);
    expect(result.json()).toMatchObject({ command: "readiness", stage: "supplied", status: "configured", live_proof: false });
    expect(result.json().checks).toContainEqual(expect.objectContaining({ boundary: "model_execution", status: "unexercised" }));
    expect(result.out).not.toContain("model-test-secret");
  });
  test("discovery writes only explicitly selected observed names", async () => {
    const methods: string[] = [];
    const endpoint = mcp(["Observed_Search", "Exact_Route"], methods);
    const output = join(await temp(), "tools.json");
    const result = await cli(["discover", "--output", output, "--elastic-tools", "Observed_Search"], { ...gatewayConfig(endpoint), ARCADE_ROUTE_TOOL_NAME: "Exact_Route" });
    expect(result.code, result.out + result.err).toBe(0);
    expect(result.json()).toMatchObject({ status: "observed", live_proof: false });
    const saved = JSON.parse(await readFile(output, "utf8"));
    expect(saved.configuration).toEqual({ ARCADE_ELASTIC_TOOL_NAMES: "Observed_Search", ARCADE_ROUTE_TOOL_NAME: "Exact_Route" });
    expect(saved.observed.map((tool: any) => tool.name)).toEqual(["Observed_Search", "Exact_Route"]);
    expect(JSON.stringify(saved)).not.toContain("arcade-test-secret");
    expect(methods).toContain("tools/list");
    expect(methods).not.toContain("tools/call");
  });
  test.each(["clean", "governed"] as const)("seed %s stores and verifies all eight stable fixture documents", async variant => {
    const store = elastic();
    const hooks = serve(() => Response.json({ active: true, verified_denial: true, verified_filter: true }));
    const result = await cli(["seed", "--variant", variant], { ...store.config, HOOKS_PUBLIC_HOST: hooks, WORKSHOP_OPERATOR_TOKEN: "operator-test-secret" });
    expect(result.code, result.out + result.err).toBe(0);
    expect(result.json()).toMatchObject({ command: "seed", variant, status: "seeded", count: 8, live_proof: false });
    expect([...store.documents.values()]).toEqual(fixtureEvents(variant));
    const saved = JSON.stringify([...store.documents.values()]);
    expect(saved.includes(GOVERNED_PHONE)).toBe(variant === "governed");
    expect(saved.includes(GOVERNED_INSTRUCTION)).toBe(variant === "governed");
    expect(store.requests.every(request => request.auth === "ApiKey elastic-test-secret")).toBe(true);
  });
  test("reset clears every owner and verifies the clean Elastic baseline", async () => {
    const store = elastic();
    for (const event of fixtureEvents("governed")) store.documents.set(event.event_id, event);
    store.documents.set("extra", { content: GOVERNED_INSTRUCTION });
    const resets: Array<{ path: string; auth: string | null; body: unknown }> = [];
    const owners = serve(async request => {
      const path = new URL(request.url).pathname;
      resets.push({ path, auth: request.headers.get("authorization"), body: await request.json() });
      if (path === "/operator/reset") return Response.json({ reset: true, active: false, reset_epoch: 7 });
      if (path === "/api/operator/reset") return Response.json({ reset: true, deleted_snapshots: 2 });
      if (path === "/lead/internal/reset") return Response.json({ leads: 9, decisions: 6, operations: 0 });
      if (path === "/idp/internal/reset") return Response.json({ reset: true, people: 4, oauth_clients_preserved: 2 });
      return new Response(null, { status: 404 });
    });
    const result = await cli(["reset", "--variant", "clean"], { ...store.config, HOOKS_PUBLIC_HOST: owners, WEB_PUBLIC_ORIGIN: owners, IDP_PUBLIC_HOST: `${owners}/idp`, LEAD_APP_PUBLIC_HOST: `${owners}/lead`, WORKSHOP_OPERATOR_TOKEN: "operator-test-secret", LEAD_INTERNAL_TOKEN: "lead-test-secret" });
    expect(result.code, result.out + result.err).toBe(0);
    expect(result.json()).toMatchObject({ command: "reset", status: "reset", live_proof: false });
    expect(resets).toEqual([
      { path: "/operator/reset", auth: "Bearer operator-test-secret", body: {} },
      { path: "/api/operator/reset", auth: "Bearer operator-test-secret", body: { reset_epoch: 7 } },
      { path: "/lead/internal/reset", auth: "Bearer lead-test-secret", body: {} },
      { path: "/idp/internal/reset", auth: "Bearer operator-test-secret", body: {} },
    ]);
    expect([...store.documents.values()]).toEqual(fixtureEvents("clean"));
    expect(result.json().owners.idp.oauth_clients_preserved).toBe(2);
  });
  test.each(["readiness", "capstone"])("%s --live with missing credentials produces incomplete evidence", async command => {
    const output = join(await temp(), "proof");
    const result = await cli([command, ...(command === "capstone" ? ["--run-id", "run-test", "--output", output] : ["--stage", "governed"]), "--live"]);
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({ command, status: "incomplete", live_proof: false });
    expect(result.json().checks).toContainEqual(expect.objectContaining({ status: "missing" }));
    if (command === "capstone") expect(JSON.parse(await readFile(join(output, "manifest.json"), "utf8"))).toMatchObject({ run_id: "run-test", status: "incomplete", live_proof: false });
  });
  test("capstone reads one bound run and saves independently hashed evidence artifacts", async () => {
    const { evidence, receipt } = proof();
    const requests: string[] = [];
    const output = join(await temp(), "proof");
    const result = await cli(["capstone", "--run-id", "run-test", "--output", output], evidenceService(evidence, receipt, requests));
    expect(result.code, result.out + result.err).toBe(0);
    expect(result.json()).toMatchObject({ status: "passed", live_proof: false, run_id: "run-test", request_id: "request-test", operation_key: "run:run-test" });
    expect(requests).toEqual(["GET /operator/runs/run-test/evidence", "GET /internal/operations/run%3Arun-test"]);
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    expect(manifest.artifacts.map((item: any) => item.file)).toEqual(["run.json", "gateway-audit.json", "approval.json", "operation-receipt.json"]);
    for (const artifact of manifest.artifacts) {
      const text = await readFile(join(output, artifact.file), "utf8");
      expect(createHash("sha256").update(text).digest("hex")).toBe(artifact.sha256);
      expect(JSON.parse(text)).toMatchObject({ run_id: "run-test", request_id: "request-test", operation_key: "run:run-test" });
    }
    expect(await readFile(join(output, "operation-receipt.json"), "utf8")).not.toContain(receipt.body.rationale);
  });
  test("setup emits stage-specific guide and observed configuration without inventing account setup", async () => {
    const endpoint = mcp(["Observed_Search"]);
    const output = join(await temp(), "setup.json");
    const result = await cli(["setup", "--stage", "elastic", "--output", output], gatewayConfig(endpoint));
    expect(result.code, result.out + result.err).toBe(0);
    expect(result.json()).toMatchObject({ command: "setup", status: "guide", connected: false });
    expect(result.json().steps.join(" ")).toContain("docs/modules/03-arcade.md");
    expect(JSON.parse(await readFile(output, "utf8")).configuration.ARCADE_ELASTIC_TOOL_NAMES).toBe("Observed_Search");
  });
  test("governed readiness requires its persistent service owners even when gateway discovery works", async () => {
    const names = { ARCADE_ROUTE_TOOL_NAME: "Exact_Route", ARCADE_CLASSIFY_TOOL_NAME: "Exact_Classify", ARCADE_REQUEST_APPROVAL_TOOL_NAME: "Exact_Request", ARCADE_DECIDE_TOOL_NAME: "Exact_Decide" };
    const result = await cli(["readiness", "--stage", "governed"], { ...gatewayConfig(mcp(["Observed_Search", ...Object.values(names)])), ...names, ANTHROPIC_API_KEY: "model-test-secret" });
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({ status: "incomplete" });
    expect(result.json().checks).toContainEqual(expect.objectContaining({ status: "missing", detail: expect.stringContaining("WORKSHOP_OPERATOR_TOKEN") }));
  });
  test("Elastic readiness discovers cited-search tools without governed service setup", async () => {
    const methods: string[] = [];
    const result = await cli(["readiness", "--stage", "elastic"], { ...gatewayConfig(mcp(["Observed_Search"], methods)), ANTHROPIC_API_KEY: "model-test-secret" });
    expect(result.code, result.out + result.err).toBe(0);
    expect(result.json()).toMatchObject({ status: "configured", live_proof: false });
    expect(methods).toContain("tools/list");
    expect(methods).not.toContain("tools/call");
  });
  test.each([
    ["empty discovery", []],
    ["configured tool absent", ["Different_Search"]],
  ] as const)("discovery rejects %s without a guessed configuration", async (_label, names) => {
    const output = join(await temp(), "tools.json");
    const result = await cli(["discover", "--output", output], gatewayConfig(mcp([...names])));
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({ status: "failed", live_proof: false });
    expect(await Bun.file(output).exists()).toBe(false);
  });
  test("governed seed refuses an inactive policy before changing Elastic", async () => {
    const store = elastic();
    const hooks = serve(() => Response.json({ active: false, verified_denial: true, verified_filter: true }));
    const result = await cli(["seed", "--variant", "governed"], { ...store.config, HOOKS_PUBLIC_HOST: hooks, WORKSHOP_OPERATOR_TOKEN: "operator-test-secret" });
    expect(result.code).toBe(1);
    expect(result.json().error).toContain("activated gateway policy");
    expect(store.documents.size).toBe(0);
    expect(store.requests).toEqual([]);
  });
  test("reset exposes a partial reset when the native storage owner is unavailable", async () => {
    const store = elastic();
    const paths: string[] = [];
    const host = serve(request => {
      const path = new URL(request.url).pathname; paths.push(path);
      return path === "/operator/reset" ? Response.json({ reset: true, active: false, reset_epoch: 9 }) : Response.json({ error: "storage unavailable" }, { status: 503 });
    });
    const result = await cli(["reset", "--variant", "clean"], { ...store.config, HOOKS_PUBLIC_HOST: host, WEB_PUBLIC_ORIGIN: host, IDP_PUBLIC_HOST: host, LEAD_APP_PUBLIC_HOST: host, WORKSHOP_OPERATOR_TOKEN: "operator-test-secret", LEAD_INTERNAL_TOKEN: "lead-test-secret" });
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({ status: "incomplete", owners: { hooks: { reset_epoch: 9 } } });
    expect(result.json().checks).toContainEqual(expect.objectContaining({ boundary: "web_reset", status: "failed" }));
    expect(paths).toEqual(["/operator/reset", "/api/operator/reset"]);
    expect(store.requests).toEqual([]);
  });
  test.each([
    ["missing native resume", "resumed_run", (e: any, _r: any) => { e.run.resumed_at = null; }],
    ["another request", "approval_binding", (e: any, _r: any) => { e.approval.request_id = "foreign"; }],
    ["another operation", "operation_receipt", (_e: any, r: any) => { r.operation_key = "foreign"; }],
    ["changed saved body", "operation_receipt", (_e: any, r: any) => { r.body.estimated_acv = 300000; }],
    ["invented citation", "source_citations", (e: any, _r: any) => { e.run.text = "Evidence evt-invented-001"; }],
    ["unexercised tool trace", "tool_trace", (e: any, _r: any) => { e.run.tool_calls = []; }],
    ["changed tool trace arguments", "tool_trace", (e: any, _r: any) => { e.run.tool_calls[1].args.owner_email = "other@example.test"; }],
    ["unfiltered source", "filtered_evidence", (e: any, _r: any) => { e.events[0].after = { event_id: "evt-northwind-003", content: GOVERNED_PHONE }; }],
    ["uncertain delivery", "slack_acknowledgement", (e: any, _r: any) => { e.approval.notification_status = "uncertain"; }],
    ["another approval subject", "authenticated_approval", (e: any, _r: any) => { e.events[4].approver_id = "other@example.test"; }],
    ["no gateway denial", "gateway_denial", (e: any, _r: any) => { e.events = e.events.filter((event: any) => event.decision !== "deny"); }],
    ["unrelated gateway denial", "gateway_denial", (e: any, _r: any) => { e.events[1].execution_id = "other-execution"; }],
    ["missing denial binding", "gateway_denial", (e: any, _r: any) => { delete e.denial; }],
  ] as const)("capstone keeps %s incomplete", async (_label, boundary, mutate) => {
    const { evidence, receipt } = proof(); mutate(evidence, receipt);
    const output = join(await temp(), "proof");
    const result = await cli(["capstone", "--run-id", "run-test", "--output", output], evidenceService(evidence, receipt, []));
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({ status: "incomplete", live_proof: false });
    expect(result.json().checks).toContainEqual(expect.objectContaining({ boundary, status: "failed" }));
    expect(await readFile(join(output, "gateway-audit.json"), "utf8")).not.toContain(GOVERNED_PHONE);
  });
  test("live capstone excludes controlled local services before reading their evidence", async () => {
    const { evidence, receipt } = proof(); const requests: string[] = [];
    const result = await cli(["capstone", "--run-id", "run-test", "--live", "--output", join(await temp(), "proof")], { ...evidenceService(evidence, receipt, requests), ARCADE_API_KEY: "arcade-test-secret", ARCADE_GATEWAY_ID: "test-gateway" });
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({ status: "incomplete", live_proof: false });
    expect(result.json().checks).toContainEqual(expect.objectContaining({ boundary: "live_endpoints", status: "failed" }));
    expect(requests).toEqual([]);
  });
  test.each(["readiness", "capstone", "seed", "reset"])("%s reports shared read-only Elastic as degraded", async command => {
    const args = command === "readiness" ? ["--stage", "elastic"] : command === "capstone" ? ["--run-id", "run-test", "--output", join(await temp(), "proof")] : ["--variant", "clean"];
    const result = await cli([command, ...args], { WORKSHOP_ELASTIC_MODE: "shared-read-only" });
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({ command, status: "degraded", live_proof: false });
  });
});
