import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../lead-app/src/index";
import { createHooksApp } from "../src/app";
import { INJECTION, type HooksConfig } from "../src/policy";

test("real hooks and Lead HTTP preserve exact approved writes across restart and later value changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "connected-lead-"));
  let now = Date.now();
  const dana = "dana@example.test", riley = "riley@example.test";
  const identity = Bun.serve({ port: 0, fetch(req) {
    const token = req.headers.get("authorization");
    return token === "Bearer dana-oauth" || token === "Bearer riley-oauth" ? Response.json({ sub: token, email: token === "Bearer dana-oauth" ? dana : riley }) : Response.json({ error: "Invalid identity" }, { status: 401 });
  } });
  let business = createApp({ dbPath: join(dir, "leads.db"), idpHost: identity.url.host, internalToken: "lead-internal" });
  let lead = Bun.serve({ port: 0, fetch: business.fetch });
  const config: HooksConfig = { dbPath: join(dir, "hooks.db"), hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web", leadHost: lead.url.origin, leadToken: "lead-internal", idpHost: identity.url.origin, webOrigin: "http://localhost:3000", subjectEmails: { dana, riley, sam: "sam@example.test", morgan: "morgan@example.test" }, verificationUserId: "verification@example.test", elasticTools: [], soloSlackDelivery: true, now: () => now };
  let controls = createHooksApp(config), hooks = Bun.serve({ port: 0, fetch: controls.fetch });
  const action = { lead_id: "LD-2291", estimated_acv: 95000, owner_email: "drew@sales.example", rationale: "Qualified from eight events", operation_key: "exact-approved-1" };
  async function request(path: string, body: unknown, token = "hook", headers: Record<string, string> = {}) {
    const response = await fetch(new URL(path, hooks.url), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  }
  const pre = (inputs: Record<string, unknown>, actor = dana) => request("/pre", { execution_id: crypto.randomUUID(), tool: { toolkit: "Lead", name: "RouteLead", version: "1" }, inputs, context: { user_id: actor } });
  const read = async () => (await fetch(new URL("/leads/LD-2291", lead.url), { headers: { authorization: "Bearer dana-oauth" } })).json() as Promise<any>;
  async function write() {
    const { lead_id, operation_key, ...body } = action;
    return fetch(new URL(`/leads/${lead_id}/route`, lead.url), { method: "POST", headers: { authorization: "Bearer dana-oauth", "Idempotency-Key": operation_key, "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  try {
    expect((await pre({ ...action, operation_key: "probe" }, config.verificationUserId)).body.code).toBe("CHECK_FAILED");
    const raw = await read();
    expect(JSON.stringify(raw)).toContain(INJECTION);
    await request("/post", { execution_id: "probe-post", tool: { toolkit: "Lead", name: "GetLead", version: "1" }, context: { user_id: config.verificationUserId }, success: true, output: raw });
    expect((await request("/operator/activate", {}, "operator")).status).toBe(200);
    const db = new Database(join(dir, "leads.db"));
    for (const [value, expected] of [[49999, "OK"], [50000, "OK"], [95000, "CHECK_FAILED"]] as const) {
      db.query("UPDATE leads SET estimated_acv=? WHERE lead_id='LD-2291'").run(value);
      expect((await pre({ ...action, estimated_acv: value, operation_key: `boundary-${value}` })).body.code).toBe(expected);
    }
    const denial = await pre(action);
    const id = /denial_id="([^"]+)"/.exec(denial.body.error_message)![1];
    expect((await read()).decisions).toHaveLength(0);
    const approval = await request("/internal/approvals/request", { denial_id: id, requester_id: dana, justification: "Qualified" }, "approvals");
    expect(approval.body.approver_id).toBe(riley);
    const approved = await request(`/internal/approvals/${approval.body.request_id}/decision`, { actor_id: riley, decision: "approve" }, "approvals", { "X-Actor-Token": "riley-oauth" });
    expect(approved.body.status).toBe("approved");
    db.query("UPDATE leads SET estimated_acv=300000 WHERE lead_id='LD-2291'").run();
    expect((await pre(action)).body.code).toBe("CHECK_FAILED");
    expect((await read()).decisions).toHaveLength(0);
    db.query("UPDATE leads SET estimated_acv=95000 WHERE lead_id='LD-2291'").run();
    expect((await pre(action)).body.code).toBe("OK");
    const firstResponse = await write();
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    const filtered = await request("/post", { execution_id: "written", tool: { toolkit: "Lead", name: "RouteLead", version: "1" }, context: { user_id: dana }, success: true, output: first });
    expect(JSON.stringify(filtered.body)).toContain("Qualified from eight events");
    expect(JSON.stringify(filtered.body)).not.toContain(INJECTION);
    expect(JSON.stringify(filtered.body)).not.toContain("+1-415-555-0137");
    db.query("UPDATE leads SET estimated_acv=300000 WHERE lead_id='LD-2291'").run(); db.close();
    now += 20 * 60_000;
    const leadPort = lead.port;
    lead.stop(true); business.close(); hooks.stop(true); controls.close();
    business = createApp({ dbPath: join(dir, "leads.db"), idpHost: identity.url.host, internalToken: "lead-internal" });
    lead = Bun.serve({ port: leadPort, fetch: business.fetch });
    controls = createHooksApp(config); hooks = Bun.serve({ port: 0, fetch: controls.fetch });
    expect((await pre(action)).body.code).toBe("OK");
    const duplicate = await write();
    expect(duplicate.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await duplicate.json()).toEqual(first);
    expect((await read()).decisions).toHaveLength(1);
    expect((await pre({ ...action, operation_key: "fresh" })).body.code).toBe("CHECK_FAILED");
    const receipt = await fetch(new URL(`/internal/operations/${action.operation_key}`, lead.url), { headers: { authorization: "Bearer lead-internal" } });
    expect((await receipt.json() as any).actor).toBe(dana);
  } finally { hooks.stop(true); controls.close(); lead.stop(true); business.close(); identity.stop(true); rmSync(dir, { recursive: true, force: true }); }
});

test("post filtering fails closed on unsupported media and excessive structure", async () => {
  const controls = createHooksApp({ dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web", leadHost: "http://localhost:1", leadToken: "lead", idpHost: "http://localhost:1", webOrigin: "http://localhost:3000", subjectEmails: { dana: "dana@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" }, verificationUserId: "verify@example.test", elasticTools: [] });
  let deep: unknown = { personal_phone: "+1-415-555-0137" };
  for (let i = 0; i < 90; i++) deep = { child: deep };
  try {
    for (const output of [{ content: [{ type: "image", data: "raw-sensitive", mimeType: "image/png" }] }, deep]) {
      const response = await controls.fetch(new Request("http://localhost/post", { method: "POST", headers: { authorization: "Bearer hook", "content-type": "application/json" }, body: JSON.stringify({ execution_id: "post", tool: { toolkit: "Lead", name: "GetLead", version: "1" }, context: { user_id: "verify@example.test" }, success: true, output }) }));
      const result = await response.json();
      expect(result.code).toBe("CHECK_FAILED"); expect(result.override).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("raw-sensitive");
    }
  } finally { controls.close(); }
});
