import { afterEach, expect, test } from "bun:test";
import { createHooksApp } from "../src/app";

const dana = "dana@example.test", riley = "riley@example.test", morgan = "morgan@example.test";
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const action = { account_id: "ACC-2291", discount_percent: 30, list_price: 12000, rationale: "A justified annual offer", operation_key: "discount-test" };

async function fixture() {
  let price = 12000;
  const dependency = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/oauth2/userinfo") return Response.json({ email: request.headers.get("authorization")?.replace("Bearer ", "") });
    if (request.headers.get("authorization") !== "Bearer lead") return new Response(null, { status: 401 });
    if (path === "/internal/accounts/ACC-2291/value") return Response.json({ account_id: "ACC-2291", list_price: price });
    return new Response(null, { status: 404 });
  } });
  const app = createHooksApp({ dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web", leadHost: dependency.url.origin, leadToken: "lead", idpHost: dependency.url.origin, webOrigin: "http://localhost:3000", subjectEmails: { dana, riley, morgan, sam: "sam@example.test" }, verificationUserId: "verify@example.test", elasticTools: [], soloSlackDelivery: true });
  cleanups.push(() => { app.close(); dependency.stop(true); });
  async function call(path: string, body: unknown, token = "hook", actorToken?: string) {
    const response = await app.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(actorToken ? { "X-Actor-Token": actorToken } : {}) }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() as any };
  }
  const pre = (inputs: Record<string, unknown>, actor = dana, execution_id = crypto.randomUUID()) => call("/pre", { execution_id, tool: { toolkit: "Sales", name: "CreateDiscountedOffer", version: "1" }, inputs, context: { user_id: actor } });
  const denialId = crypto.randomUUID();
  await call("/operator/verification", { operation_key: "probe" }, "operator");
  const probe = await pre({ ...action, operation_key: "probe", rationale: "" }, "verify@example.test", denialId);
  expect(probe.body.error_message).toContain("denial_id=");
  await call("/post", { execution_id: "filter", tool: { toolkit: "Sales", name: "GetAccount", version: "1" }, inputs: { account_id: action.account_id }, context: { user_id: "verify@example.test" }, success: true, output: { activation_token: "workshop_activation_FAKE_fixture" } });
  expect((await call("/operator/verification/confirm", { operation_key: "probe", denial_execution_id: denialId, filter_execution_id: "filter" }, "operator")).status).toBe(200);
  expect((await call("/operator/activate", {}, "operator")).status).toBe(200);
  return { call, pre, setPrice: (next: number) => { price = next; } };
}

test.each([[0, "OK"], [15, "OK"], [15.01, "CHECK_FAILED"], [30, "CHECK_FAILED"]])("AE discount authority boundary %s returns %s", async (discount, expected) => {
  const { pre } = await fixture();
  expect((await pre({ ...action, discount_percent: discount })).body.code).toBe(expected);
});

test("analysts can research accounts but cannot create even a zero-discount offer", async () => {
  const { pre, call } = await fixture();
  const versions = [{ version: "1" }];
  const access = await call("/access", { user_id: "sam@example.test", toolkits: { Sales: { tools: { SearchAccounts: versions, GetAccount: versions, GetOffer: versions, CreateDiscountedOffer: versions } } } });
  expect(access.body.only.Sales.tools).toEqual({ SearchAccounts: versions, GetAccount: versions, GetOffer: versions });
  expect((await pre({ ...action, discount_percent: 0 }, "sam@example.test")).body.code).toBe("CHECK_FAILED");
});

test("offer creation cannot accept arbitrary email sender or recipient overrides", async () => {
  const { pre } = await fixture();
  const result = await pre({ ...action, discount_percent: 15, sender: "other@example.test", recipient: "elsewhere@example.test" });
  expect(result.body.code).toBe("CHECK_FAILED");
  expect(result.body.error_message).not.toContain("denial_id=");
});

test.each([[30, riley], [40, riley], [40.01, morgan], [75, morgan]])("a %s percent discount routes to the least sufficient approver", async (discount, approver) => {
  const { pre, call } = await fixture();
  const denied = await pre({ ...action, discount_percent: discount });
  const denial_id = /denial_id="([^"]+)"/.exec(denied.body.error_message)![1];
  const created = await call("/internal/approvals/request", { denial_id, requester_id: dana, justification: "Review this exact discount" }, "approvals");
  expect(created.status).toBe(200);
  expect(created.body.approver_id).toBe(approver);
  expect(created.body.required_clearance).toBe(discount);
  expect(created.body.inputs.list_price).toBe(12000);
});

test("discounts above executive authority have no eligible approver", async () => {
  const { pre, call } = await fixture();
  const denied = await pre({ ...action, discount_percent: 75.01 });
  const denial_id = /denial_id="([^"]+)"/.exec(denied.body.error_message)![1];
  expect((await call("/internal/approvals/request", { denial_id, requester_id: dana, justification: "Review" }, "approvals")).status).toBe(409);
});

test.each([-1, 100.01, "30", null])("invalid discount %s cannot create an authority denial", async (discount) => {
  const { pre } = await fixture();
  const denied = await pre({ ...action, discount_percent: discount });
  expect(denied.body.code).toBe("CHECK_FAILED");
  expect(denied.body.error_message).not.toContain("denial_id=");
});

test("an approved discount cannot execute after its authoritative list price changes", async () => {
  const { pre, call, setPrice } = await fixture();
  const denied = await pre(action);
  const denial_id = /denial_id="([^"]+)"/.exec(denied.body.error_message)![1];
  const created = await call("/internal/approvals/request", { denial_id, requester_id: dana, justification: "Review" }, "approvals");
  const path = `/internal/approvals/${created.body.request_id}`;
  const claim = await call(`${path}/notification/claim`, { requester_id: dana, slack_user_id: "UATTENDEE", slack_team_id: "TWORKSHOP" }, "approvals");
  await call(`${path}/notification/result`, { requester_id: dana, claim_id: claim.body.claim_id, outcome: "sent", channel: "DSELF", ts: "100.1" }, "approvals");
  expect((await call(`${path}/decision`, { actor_id: dana, decision: "approve" }, "approvals", dana)).status).toBe(403);
  expect((await call(`${path}/decision`, { actor_id: riley, decision: "approve" }, "approvals", riley)).status).toBe(200);
  setPrice(13000);
  expect((await pre(action)).body.code).toBe("CHECK_FAILED");
  expect((await pre({ ...action, list_price: 13000 })).body.code).toBe("CHECK_FAILED");
  setPrice(12000);
  expect((await pre({ ...action, discount_percent: 31 })).body.code).toBe("CHECK_FAILED");
  expect((await pre(action)).body.code).toBe("OK");
});
