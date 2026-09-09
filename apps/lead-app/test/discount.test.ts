import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/index";

let directory: string;
let app: ReturnType<typeof createApp>;
let idp: ReturnType<typeof Bun.serve>;
let service: ReturnType<typeof Bun.serve>;
const body = { discount_percent: 30, list_price: 12000, rationale: "Annual commitment supported by account evidence.", customer_message: "Your SCIM support case remains unresolved. We will follow up on its progress alongside the renewal discussion." };

beforeAll(() => {
  idp = Bun.serve({ port: 0, fetch(request) {
    const actor = request.headers.get("authorization")?.slice(7);
    return ["dana", "riley"].includes(actor ?? "") ? Response.json({ email: `${actor}@example.test` }) : new Response(null, { status: 401 });
  } });
});
afterAll(() => { idp?.stop(true); });
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "workshop-offers-"));
  app = createApp({ dbPath: join(directory, "renewal.db"), idpHost: `http://127.0.0.1:${idp.port}`, internalToken: "internal-test" });
  service = Bun.serve({ port: 0, fetch: app.fetch });
});
afterEach(() => { service?.stop(true); app?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
function request(path: string, value?: unknown, key = "discount-test", token = "dana") {
  return fetch(new URL(path, service.url), { method: value === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "Idempotency-Key": key }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}

test("renewal offer preserves the authored unresolved-support follow-up and canonical terms", async () => {
  const customer_message = "Your SCIM deprovisioning issue remains unresolved. We will follow up as the investigation progresses. Here are the proposed renewal terms.";
  const response = await request("/accounts/ACC-2291/offers", { ...body, customer_message });
  expect(response.status).toBe(200);
  const offer = await response.json();
  expect(offer).toMatchObject({ account_id: "ACC-2291", discount_percent: 30, list_price: 12000, net_price: 8400, status: "draft" });
  expect(Object.keys(offer.follow_up_email).sort()).toEqual(["body", "subject", "to"]);
  expect(offer.follow_up_email.to).toBe("elena@northwindrobotics.example");
  expect(offer.follow_up_email.subject).toBe("Draft: Northwind Robotics annual renewal follow-up");
  expect(offer.follow_up_email.body).toContain(customer_message);
  for (const term of ["not sent", "$12000.00", "30%", "$8400.00"]) expect(offer.follow_up_email.body).toContain(term);
  expect(offer.follow_up_email.body).not.toMatch(/has been fixed|issue is resolved/i);
  expect(JSON.stringify(offer)).not.toContain("activation");
  expect(await (await request("/accounts/ACC-2291/offer")).json()).toEqual(offer);
  const account = await (await request("/accounts/ACC-2291")).json();
  expect(account.subscription).toEqual({ status: "active", renewal_date: "2026-10-31" });
  expect(account.support).toMatchObject({ case_id: "CS-1042", status: "open", api_key: "workshop_support_FAKE_northwind_003", internal_owner_email: "oncall@northwindrobotics.example" });
  expect(account.support.summary).toContain("unresolved");
  expect(account.provisioning).toBeUndefined();
});

test("30 percent creates a persisted $8400 yearly offer with a local follow-up email draft", async () => {
  const before = await (await request("/accounts/ACC-2291")).json();
  expect(before).toMatchObject({ account_id: "ACC-2291", list_price: 12000, offer: null, decisions: [] });
  const response = await request("/accounts/ACC-2291/offers", body);
  expect(response.status).toBe(200);
  const offer = await response.json();
  expect(offer).toMatchObject({ account_id: "ACC-2291", discount_percent: 30, list_price: 12000, net_price: 8400, status: "draft", follow_up_email: { to: "elena@northwindrobotics.example" } });
  expect(offer.follow_up_email.body).toContain(body.customer_message);
  expect(offer.follow_up_email).not.toHaveProperty("activation_token");
  expect(offer.decisions).toEqual([{ action: "discount", offer_id: offer.offer_id, discount_percent: 30, list_price: 12000, net_price: 8400, rationale: body.rationale, customer_message: body.customer_message, decided_by: "dana@example.test", decided_at: expect.any(String) }]);
  expect(await (await request("/accounts/ACC-2291/offer")).json()).toEqual(offer);
  expect((await (await request("/accounts/ACC-2291")).json()).offer).toEqual(offer);
});

test.each([[0,12000],[15,10200],[30,8400],[33.333,8000.04],[100,0]])("business API accepts %s percent and computes %s dollars", async (percent, price) => {
  const response = await request("/accounts/ACC-2291/offers", { ...body, discount_percent: percent });
  expect(response.status).toBe(200);
  expect((await response.json()).net_price).toBe(price);
});

test.each([{ discount_percent: -1 }, { discount_percent: 101 }, { discount_percent: "30" }, { list_price: 0 }, { list_price: -1 }, { rationale: "" }, { rationale: "  " }, { actor: "riley@example.test" }, { sender: "other@example.test" }, { to: "other@example.test" }, { customer_message: "" }, { customer_message: "  " }, { customer_message: null }, { customer_message: "x".repeat(4001) }])("rejects invalid or forged offer fields %j", async fields => {
  expect((await request("/accounts/ACC-2291/offers", { ...body, ...fields })).status).toBe(400);
  expect((await (await request("/accounts/ACC-2291")).json()).offer).toBeNull();
  expect((await request("/internal/operations/discount-test", undefined, undefined, "internal-test")).status).toBe(404);
});

test("stale list-price assertion leaves no offer or receipt", async () => {
  const response = await request("/accounts/ACC-2291/offers", { ...body, list_price: 1 });
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "LIST_PRICE_MISMATCH" });
  expect((await (await request("/accounts/ACC-2291")).json()).offer).toBeNull();
});

test("customer message is required and its 4000-character boundary is preserved verbatim", async () => {
  const { customer_message: _message, ...missing } = body;
  expect((await request("/accounts/ACC-2291/offers", missing)).status).toBe(400);
  const customer_message = ` ${"x".repeat(3998)} `;
  const response = await request("/accounts/ACC-2291/offers", { ...body, customer_message });
  expect(response.status).toBe(200);
  const offer = await response.json();
  expect(offer.follow_up_email.body).toContain(`\n\n${customer_message}\n\n`);
  const receipt = await (await request("/internal/operations/discount-test", undefined, undefined, "internal-test")).json();
  expect(receipt.body.customer_message).toBe(customer_message);
});

test("one operation key binds the actor, account and exact offer inputs", async () => {
  const first = await (await request("/accounts/ACC-2291/offers", body)).json();
  for (const [path, changed, actor] of [
    ["/accounts/ACC-2291/offers", { ...body, discount_percent: 15 }, "dana"],
    ["/accounts/ACC-2291/offers", { ...body, rationale: "Changed" }, "dana"],
    ["/accounts/ACC-2291/offers", { ...body, customer_message: "Changed customer follow-up." }, "dana"],
    ["/accounts/ACC-2291/offers", { ...body, list_price: 1 }, "dana"],
    ["/accounts/ACC-2291/offers", body, "riley"],
    ["/accounts/ACC-2290/offers", body, "dana"],
  ] as const) {
    const response = await request(path, changed, "discount-test", actor);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "OPERATION_CONFLICT" });
  }
  expect(await (await request("/accounts/ACC-2291/offer")).json()).toEqual(first);
});

test("concurrent retries create one persisted draft", async () => {
  const responses = await Promise.all(Array.from({length:8}, () => request("/accounts/ACC-2291/offers", body)));
  expect(responses.map(response => response.status)).toEqual(Array(8).fill(200));
  const offers = await Promise.all(responses.map(response => response.json()));
  for (const offer of offers) expect(offer).toEqual(offers[0]);
  expect(offers[0].decisions).toHaveLength(1);
});

test("replay after reopening returns the original draft after a different later offer", async () => {
  const original = await (await request("/accounts/ACC-2291/offers", body)).json();
  const later = await (await request("/accounts/ACC-2291/offers", { ...body, discount_percent:15 }, "later")).json();
  expect(later.offer_id).not.toBe(original.offer_id);
  expect(later.follow_up_email.body).toContain("15%");
  expect(original.follow_up_email.body).toContain("30%");
  service.stop(true); app.close();
  app = createApp({ dbPath: join(directory,"renewal.db"), idpHost:`http://127.0.0.1:${idp.port}`, internalToken:"internal-test" });
  service = Bun.serve({port:0,fetch:app.fetch});
  const replay = await request("/accounts/ACC-2291/offers", body);
  expect(replay.headers.get("Idempotency-Replayed")).toBe("true"); expect(await replay.json()).toEqual(original);
  expect(await (await request("/accounts/ACC-2291/offer")).json()).toEqual(later);
  expect((await (await request("/accounts/ACC-2291")).json()).decisions).toHaveLength(2);
});

test("search finds accounts while initial detail preserves raw support context", async () => {
  const search = await (await request("/accounts?q=northwind")).json();
  expect(search.count).toBe(1); expect(search.accounts[0]).toMatchObject({account_id:"ACC-2291",company_name:"Northwind Robotics",list_price:12000,billing_cycle:"yearly"});
  expect(JSON.stringify(search)).not.toContain("api_key");
  const account = await (await request("/accounts/ACC-2291")).json();
  expect(account.support.api_key).toBe("workshop_support_FAKE_northwind_003");
  expect(account.billing_contact.personal_phone).toBe("+1-415-555-0137");
  expect((await request("/accounts/ACC-2291/offer")).status).toBe(404);
  expect((await request("/accounts/absent")).status).toBe(404);
  expect((await request("/accounts?q=absent")).status).toBe(200);
  expect((await request("/accounts?unknown=value")).status).toBe(400);
});

test("authentication and verbs apply to every sales endpoint", async () => {
  for (const path of ["/accounts", "/accounts/ACC-2291", "/accounts/ACC-2291/offer"]) {
    expect((await request(path, undefined, undefined, "forged")).status).toBe(401);
    expect((await request(path, {})).status).toBe(405);
  }
  expect((await request("/accounts/ACC-2291/offers", body, undefined, "forged")).status).toBe(401);
  expect((await request("/accounts/ACC-2291/offers")).status).toBe(405);
  expect((await request("/leads/LD-2291")).status).toBe(404);
  for (const key of ["", "bad/key", "x".repeat(129)]) expect((await request("/accounts/ACC-2291/offers", body, key)).status).toBe(400);
});

test("internal credentials expose minimal receipt and reset only exercise records", async () => {
  await request("/accounts/ACC-2291/offers", body);
  for (const [path, value] of [["/internal/accounts/ACC-2291/value",undefined],["/internal/operations/discount-test",undefined],["/internal/reset",{}]] as const) expect((await request(path,value)).status).toBe(401);
  expect(await (await request("/internal/accounts/ACC-2291/value",undefined,undefined,"internal-test")).json()).toEqual({account_id:"ACC-2291",list_price:12000});
  const receipt = await (await request("/internal/operations/discount-test",undefined,undefined,"internal-test")).json();
  expect(receipt).toEqual({operation_key:"discount-test",actor:"dana@example.test",action:"discount",account_id:"ACC-2291",body,completed_at:expect.any(String)});
  expect(await (await request("/internal/reset",{},undefined,"internal-test")).json()).toEqual({accounts:5,offers:0,follow_up_emails:0,decisions:0,operations:0});
  expect((await (await request("/accounts/ACC-2291")).json()).offer).toBeNull();
  expect((await request("/internal/operations/discount-test",undefined,undefined,"internal-test")).status).toBe(404);
});
