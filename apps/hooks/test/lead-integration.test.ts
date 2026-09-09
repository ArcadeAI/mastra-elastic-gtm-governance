import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../lead-app/src/index";
import { createHooksApp } from "../src/app";
import { INJECTION, type HooksConfig } from "../src/policy";

test("real hooks and Sales HTTP preserve exact approved discounts across restart and later price changes", async () => {
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
  const action = { account_id: "ACC-2291", discount_percent: 30, list_price: 12000, rationale: "Qualified from eight events", operation_key: "exact-approved-1" };
  async function request(path: string, body: unknown, token = "hook", headers: Record<string, string> = {}) {
    const response = await fetch(new URL(path, hooks.url), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  }
  const pre = (inputs: Record<string, unknown>, actor = dana, executionId = crypto.randomUUID()) => request("/pre", { execution_id: executionId, tool: { toolkit: "Sales", name: "CreateDiscountedOffer", version: "1" }, inputs, context: { user_id: actor } });
  const read = async () => (await fetch(new URL("/accounts/ACC-2291", lead.url), { headers: { authorization: "Bearer dana-oauth" } })).json() as Promise<any>;
  async function write(input = action) {
    const { account_id, operation_key, ...body } = input;
    return fetch(new URL(`/accounts/${account_id}/offers`, lead.url), { method: "POST", headers: { authorization: "Bearer dana-oauth", "Idempotency-Key": operation_key, "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  try {
    const denialExecutionId = crypto.randomUUID();
    expect((await request("/operator/verification", { operation_key: "probe" }, "operator")).status).toBe(200);
    expect((await pre({ ...action, operation_key: "probe", rationale: "" }, config.verificationUserId, denialExecutionId)).body.code).toBe("CHECK_FAILED");
    const raw = await read();
    expect(raw.provisioning.activation_token).toStartWith("workshop_activation_FAKE_");
    expect(raw.offer).toBeNull();
    // The setup probe is invalid at the business API even if hooks are absent.
    expect((await write({ ...action, operation_key: "hookless-probe", rationale: "" })).status).toBe(400);
    expect((await read()).decisions).toHaveLength(0);
    await request("/post", { execution_id: "probe-post", tool: { toolkit: "Sales", name: "GetAccount", version: "1" }, context: { user_id: config.verificationUserId }, success: true, output: raw });
    expect((await request("/operator/verification/confirm", { operation_key: "probe", denial_execution_id: denialExecutionId, filter_execution_id: "probe-post" }, "operator")).status).toBe(200);
    expect((await request("/operator/activate", {}, "operator")).status).toBe(200);
    const db = new Database(join(dir, "leads.db"));
    for (const [discount, expected] of [[14.99, "OK"], [15, "OK"], [15.01, "CHECK_FAILED"], [30, "CHECK_FAILED"]] as const) {
      expect((await pre({ ...action, discount_percent: discount, operation_key: `boundary-${discount}` })).body.code).toBe(expected);
    }
    const denial = await pre(action);
    const id = /denial_id="([^"]+)"/.exec(denial.body.error_message)![1];
    expect((await read()).decisions).toHaveLength(0);
    const approval = await request("/internal/approvals/request", { denial_id: id, requester_id: dana, justification: "Qualified" }, "approvals");
    expect(approval.body.approver_id).toBe(riley);
    const delivery = await request(`/internal/approvals/${approval.body.request_id}/notification/claim`, { requester_id: dana, slack_user_id: "UATTENDEE", slack_team_id: "TWORKSHOP" }, "approvals");
    await request(`/internal/approvals/${approval.body.request_id}/notification/result`, { requester_id: dana, claim_id: delivery.body.claim_id, outcome: "sent", channel: "DSELF", ts: "100.001" }, "approvals");
    const approved = await request(`/internal/approvals/${approval.body.request_id}/decision`, { actor_id: riley, decision: "approve" }, "approvals", { "X-Actor-Token": "riley-oauth" });
    expect(approved.body.status).toBe("approved");
    db.query("UPDATE sales_accounts SET data=json_set(data, '$.list_price', 13000) WHERE account_id='ACC-2291'").run();
    expect((await pre(action)).body.code).toBe("CHECK_FAILED");
    expect((await read()).decisions).toHaveLength(0);
    db.query("UPDATE sales_accounts SET data=json_set(data, '$.list_price', 12000) WHERE account_id='ACC-2291'").run();
    expect((await pre(action)).body.code).toBe("OK");
    const firstResponse = await write();
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    const filtered = await request("/post", { execution_id: "written", tool: { toolkit: "Sales", name: "CreateDiscountedOffer", version: "1" }, context: { user_id: dana }, success: true, output: first });
    expect(JSON.stringify(filtered.body)).toContain("Qualified from eight events");
    expect(JSON.stringify(filtered.body)).not.toContain(INJECTION);
    expect(JSON.stringify(filtered.body)).not.toContain("+1-415-555-0137");
    expect(JSON.stringify(first)).toContain("workshop_activation_FAKE_");
    expect(JSON.stringify(filtered.body)).not.toContain("workshop_activation_FAKE_");
    expect(JSON.stringify(filtered.body)).not.toContain("activation_token");
    expect(filtered.body.override.output).toMatchObject({ account_id: "ACC-2291", discount_percent: 30, list_price: 12000, net_price: 8400, status: "draft" });
    db.query("UPDATE sales_accounts SET data=json_set(data, '$.list_price', 13000) WHERE account_id='ACC-2291'").run(); db.close();
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
    expect((await pre({ ...action, discount_percent: 31 })).body.code).toBe("CHECK_FAILED");
    expect((await pre({ ...action, list_price: 13000 })).body.code).toBe("CHECK_FAILED");
    expect((await pre({ ...action, sender: "other@example.test" })).body.code).toBe("CHECK_FAILED");
    expect((await pre(action, riley)).body.code).toBe("CHECK_FAILED");
    const receipt = await fetch(new URL(`/internal/operations/${action.operation_key}`, lead.url), { headers: { authorization: "Bearer lead-internal" } });
    expect(await receipt.json()).toMatchObject({ actor: dana, operation_key: action.operation_key, action: "discount", account_id: action.account_id, body: { discount_percent: 30, list_price: 12000, rationale: action.rationale } });
  } finally { hooks.stop(true); controls.close(); lead.stop(true); business.close(); identity.stop(true); rmSync(dir, { recursive: true, force: true }); }
});

test("post filtering fails closed on unsupported media and excessive structure", async () => {
  const controls = createHooksApp({ dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web", leadHost: "http://localhost:1", leadToken: "lead", idpHost: "http://localhost:1", webOrigin: "http://localhost:3000", subjectEmails: { dana: "dana@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" }, verificationUserId: "verify@example.test", elasticTools: [] });
  let deep: unknown = { personal_phone: "+1-415-555-0137" };
  for (let i = 0; i < 90; i++) deep = { child: deep };
  try {
    for (const output of [{ content: [{ type: "image", data: "raw-sensitive", mimeType: "image/png" }] }, deep]) {
      const response = await controls.fetch(new Request("http://localhost/post", { method: "POST", headers: { authorization: "Bearer hook", "content-type": "application/json" }, body: JSON.stringify({ execution_id: "post", tool: { toolkit: "Sales", name: "GetAccount", version: "1" }, context: { user_id: "verify@example.test" }, success: true, output }) }));
      const result = await response.json();
      expect(result.code).toBe("CHECK_FAILED"); expect(result.override).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("raw-sensitive");
    }
  } finally { controls.close(); }
});
