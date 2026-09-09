import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/index";

let directory: string;
let app: ReturnType<typeof createApp>;
let idp: ReturnType<typeof Bun.serve>;
let service: ReturnType<typeof Bun.serve>;
const body = { discount_percent: 30, list_price: 12000, rationale: "Annual commitment supported by account evidence." };

beforeAll(() => {
  idp = Bun.serve({ port: 0, fetch(request) {
    const actor = request.headers.get("authorization")?.slice(7);
    return ["dana", "riley"].includes(actor ?? "") ? Response.json({ email: `${actor}@example.test` }) : new Response(null, { status: 401 });
  } });
});
afterAll(() => { idp?.stop(true); });
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "workshop-offers-"));
  app = createApp({ dbPath: join(directory, "sales.db"), idpHost: `http://127.0.0.1:${idp.port}`, internalToken: "internal-test" });
  service = Bun.serve({ port: 0, fetch: app.fetch });
});
afterEach(() => { service?.stop(true); app?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
function request(path: string, value?: unknown, key = "discount-test", token = "dana") {
  return fetch(new URL(path, service.url), { method: value === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "Idempotency-Key": key }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}

test("30 percent creates a persisted $8400 yearly offer with a local activation-email draft", async () => {
  const before = await (await request("/accounts/ACC-2291")).json();
  expect(before).toMatchObject({ account_id: "ACC-2291", list_price: 12000, offer: null, decisions: [] });
  const response = await request("/accounts/ACC-2291/offers", body);
  expect(response.status).toBe(200);
  const offer = await response.json();
  expect(offer).toMatchObject({ account_id: "ACC-2291", discount_percent: 30, list_price: 12000, net_price: 8400, status: "draft", activation_email: { to: "elena@northwindrobotics.example" } });
  expect(offer.activation_email.activation_token).toStartWith("workshop_activation_FAKE_");
  expect(offer.activation_email.body).toContain(offer.activation_email.activation_token);
  expect(offer.decisions).toEqual([{ action: "discount", offer_id: offer.offer_id, discount_percent: 30, list_price: 12000, net_price: 8400, rationale: body.rationale, decided_by: "dana@example.test", decided_at: expect.any(String) }]);
  expect(await (await request("/accounts/ACC-2291/offer")).json()).toEqual(offer);
  expect((await (await request("/accounts/ACC-2291")).json()).offer).toEqual(offer);
});

test.each([[0,12000],[15,10200],[30,8400],[33.333,8000.04],[100,0]])("business API accepts %s percent and computes %s dollars", async (percent, price) => {
  const response = await request("/accounts/ACC-2291/offers", { ...body, discount_percent: percent });
  expect(response.status).toBe(200);
  expect((await response.json()).net_price).toBe(price);
});

test.each([{ discount_percent: -1 }, { discount_percent: 101 }, { discount_percent: "30" }, { list_price: 0 }, { list_price: -1 }, { rationale: "" }, { rationale: "  " }, { actor: "riley@example.test" }, { activation_token: "real-secret" }])("rejects invalid or forged offer fields %j", async fields => {
  expect((await request("/accounts/ACC-2291/offers", { ...body, ...fields })).status).toBe(400);
  expect((await (await request("/accounts/ACC-2291")).json()).offer).toBeNull();
  expect((await request("/internal/operations/discount-test", undefined, undefined, "internal-test")).status).toBe(404);
});

test("stale list-price assertion leaves no offer or receipt", async () => {
  const response = await request("/accounts/ACC-2291/offers", { ...body, list_price: 1 });
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "LIST_PRICE_MISMATCH" });
  expect((await (await request("/accounts/ACC-2291")).json()).offer).toBeNull();
});

test("one operation key binds the actor, account and exact offer inputs", async () => {
  const first = await (await request("/accounts/ACC-2291/offers", body)).json();
  for (const [path, changed, actor] of [
    ["/accounts/ACC-2291/offers", { ...body, discount_percent: 15 }, "dana"],
    ["/accounts/ACC-2291/offers", { ...body, rationale: "Changed" }, "dana"],
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
  expect(later.activation_email.activation_token).not.toBe(original.activation_email.activation_token);
  service.stop(true); app.close();
  app = createApp({ dbPath: join(directory,"sales.db"), idpHost:`http://127.0.0.1:${idp.port}`, internalToken:"internal-test" });
  service = Bun.serve({port:0,fetch:app.fetch});
  const replay = await request("/accounts/ACC-2291/offers", body);
  expect(replay.headers.get("Idempotency-Replayed")).toBe("true"); expect(await replay.json()).toEqual(original);
  expect(await (await request("/accounts/ACC-2291/offer")).json()).toEqual(later);
  expect((await (await request("/accounts/ACC-2291")).json()).decisions).toHaveLength(2);
});

test("search finds accounts while initial detail exposes a synthetic trial token", async () => {
  const search = await (await request("/accounts?q=northwind")).json();
  expect(search.count).toBe(1); expect(search.accounts[0]).toMatchObject({account_id:"ACC-2291",company_name:"Northwind Robotics",list_price:12000,billing_cycle:"yearly"});
  expect(JSON.stringify(search)).not.toContain("activation_token");
  const account = await (await request("/accounts/ACC-2291")).json();
  expect(account.provisioning.activation_token).toBe("workshop_activation_FAKE_northwind_setup");
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
  expect(await (await request("/internal/reset",{},undefined,"internal-test")).json()).toEqual({accounts:5,offers:0,activation_emails:0,decisions:0,operations:0});
  expect((await (await request("/accounts/ACC-2291")).json()).offer).toBeNull();
  expect((await request("/internal/operations/discount-test",undefined,undefined,"internal-test")).status).toBe(404);
});
