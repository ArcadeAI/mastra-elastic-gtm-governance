/** ATT1.R3–R4 and OPS1.R2: real HTTP writes and internal receipts. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/index.ts";

let directory: string;
let application: ReturnType<typeof createApp>;
let service: ReturnType<typeof Bun.serve>;
let idp: ReturnType<typeof Bun.serve>;
const token = "local-internal-token";
const route = { estimated_acv: 95000, owner_email: "owner@example.test", rationale: "Cited fit." };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lead-operations-"));
  idp = Bun.serve({
    port: 0, fetch(request) {
      const actor = request.headers.get("authorization") === "Bearer riley" ? "riley@example.test" : "dana@example.test";
      return Response.json({ email: actor });
    }
});
  application = createApp({ dbPath: join(directory, "leads.db"), idpHost: `localhost:${idp.port}`, internalToken: token });
  service = Bun.serve({ port: 0, fetch: application.fetch });
});
afterEach(() => { service?.stop(true); application?.close(); idp?.stop(true); if (directory) rmSync(directory, { recursive: true, force: true }); });

function request(path: string, body?: unknown, key?: string, bearer = "dana") {
  return fetch(new URL(path, service.url), {
    method: body === undefined ? "GET" : "POST", headers: {
      authorization: `Bearer ${bearer}`, "content-type": "application/json", ...(key !== undefined ? { "Idempotency-Key": key } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

test("asserted ACV cannot replace stored ACV or record a failed write", async () => {
  const response = await request("/leads/LD-2291/route", { ...route, estimated_acv: 49000 }, "lowball");
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "ACV_MISMATCH" });
  expect(await (await request("/leads/LD-2291")).json()).toMatchObject({ estimated_acv: 95000, decisions: [] });
  expect((await request("/internal/operations/lowball", undefined, undefined, token)).status).toBe(404);
});

test("both writes require a valid operation key", async () => {
  for (const [action, body] of [["route", route], ["classify", { disposition: "follow_up", rationale: "Later" }]] as const) {
    for (const key of [undefined, "bad/key", "x".repeat(129)]) {
      expect((await request(`/leads/LD-2291/${action}`, body, key)).status).toBe(400);
    }
  }
});

test("route replay returns the saved result after later changes and database reopen", async () => {
  const first = await request("/leads/LD-2291/route", route, "saved-route");
  expect(first.headers.get("Idempotency-Replayed")).toBe("false");
  const saved = await first.json();
  await request("/leads/LD-2291/classify", { disposition: "support", rationale: "New information" }, "later-classification");
  service.stop(true); application.close();
  application = createApp({ dbPath: join(directory, "leads.db"), idpHost: `localhost:${idp.port}`, internalToken: token });
  service = Bun.serve({ port: 0, fetch: application.fetch });
  const repeated = await request("/leads/LD-2291/route", route, "saved-route");
  expect(repeated.headers.get("Idempotency-Replayed")).toBe("true");
  expect(await repeated.json()).toEqual(saved);
  expect(await (await request("/leads/LD-2291")).json()).toMatchObject({ status: "support", decisions: expect.arrayContaining([{ ...saved.decisions[0] }]) });
});

test("concurrent classification delivery records one decision", async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => request("/leads/LD-2291/classify", { disposition: "follow_up", rationale: "Later" }, "classification")));
  expect(responses.every(response => response.status === 200)).toBe(true);
  const bodies = await Promise.all(responses.map(response => response.json()));
  expect(bodies.every(body => JSON.stringify(body) === JSON.stringify(bodies[0]))).toBe(true);
  expect(bodies[0].decisions).toHaveLength(1);
});

test("one key binds actor, action, resource, and complete body", async () => {
  expect((await request("/leads/LD-2291/route", route, "bound")).status).toBe(200);
  for (const [path, body, actor] of [
    ["/leads/LD-2291/route", { ...route, owner_email: "other@example.test" }, "dana"],
    ["/leads/LD-2291/route", { ...route, rationale: "Different" }, "dana"],
    ["/leads/LD-2291/route", { ...route, estimated_acv: 1 }, "dana"],
    ["/leads/LD-2291/route", route, "riley"],
    ["/leads/LD-2292/route", route, "dana"],
    ["/leads/LD-2291/classify", { disposition: "support", rationale: "Later" }, "dana"],
  ] as const) {
    const response = await request(path, body, "bound", actor);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OPERATION_CONFLICT" });
  }
  expect((await (await request("/leads/LD-2291")).json()).decisions).toHaveLength(1);
});

test("internal routes require their own token and return minimal completed receipts", async () => {
  await request("/leads/LD-2291/route", route, "receipt");
  for (const [path, body] of [["/internal/leads/LD-2291/value", undefined], ["/internal/operations/receipt", undefined], ["/internal/reset", {}]] as const) {
    expect((await request(path, body, undefined, "dana")).status).toBe(401);
  }
  expect(await (await request("/internal/leads/LD-2291/value", undefined, undefined, token)).json()).toEqual({ lead_id: "LD-2291", estimated_acv: 95000 });
  const receipt = await (await request("/internal/operations/receipt", undefined, undefined, token)).json();
  expect(Object.keys(receipt).sort()).toEqual(["action", "actor", "body", "completed_at", "lead_id", "operation_key"]);
  expect(receipt).toMatchObject({ operation_key: "receipt", actor: "dana@example.test", action: "route", lead_id: "LD-2291", body: route });
  expect((await request("/internal/leads/unknown/value", undefined, undefined, token)).status).toBe(404);
});

test("reset restores historical fixture decisions and removes receipts", async () => {
  await request("/leads/LD-2291/route", route, "reset-me");
  const response = await request("/internal/reset", {}, undefined, token);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ leads: 9, decisions: 6, operations: 0 });
  expect((await (await request("/leads/LD-2291")).json()).decisions).toHaveLength(0);
  expect((await (await request("/leads/LD-2288")).json()).decisions).toHaveLength(1);
  expect((await request("/internal/operations/reset-me", undefined, undefined, token)).status).toBe(404);
});

test("approved operation replay survives a separate lead process restart", async () => {
  const dbPath = join(directory, "separate-process.db");
  async function startProcess() {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = probe.port;
    probe.stop(true);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/index.ts")], {
      env: { ...process.env, PORT: String(port), LEADS_DB_PATH: dbPath, IDP_PUBLIC_HOST: `localhost:${idp.port}`, LEAD_INTERNAL_TOKEN: token },
      stdout: "ignore", stderr: "pipe",
    });
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 10000;
    for (; ;) {
      try { if ((await fetch(`${origin}/health`)).ok) return { child, origin }; } catch {
        // The child may not have opened its socket yet; retry until the bounded deadline.
      }
      if (child.exitCode !== null || Date.now() > deadline) {
        child.kill();
        throw new Error(`Lead process did not start: ${await new Response(child.stderr).text()}`);
      }
      await Bun.sleep(10);
    }
  }
  const write = (origin: string) => fetch(`${origin}/leads/LD-2291/route`, {
    method: "POST", headers: { authorization: "Bearer dana", "content-type": "application/json", "Idempotency-Key": "process-replay" }, body: JSON.stringify(route),
  });
  const first = await startProcess();
  let saved: unknown;
  try {
    const response = await write(first.origin);
    expect(response.status).toBe(200);
    saved = await response.json();
  } finally { first.child.kill(); await first.child.exited; }
  const second = await startProcess();
  try {
    const response = await write(second.origin);
    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await response.json()).toEqual(saved);
    const current = await fetch(`${second.origin}/leads/LD-2291`, { headers: { authorization: "Bearer dana" } });
    expect((await current.json()).decisions).toHaveLength(1);
  } finally { second.child.kill(); await second.child.exited; }
});

test("internal endpoints reject absent credentials and remain closed without a configured token", async () => {
  for (const path of ["/internal/leads/LD-2291/value", "/internal/operations/absent", "/internal/reset"]) {
    const response = await fetch(new URL(path, service.url), { method: path.endsWith("reset") ? "POST" : "GET" });
    expect(response.status).toBe(401);
  }
  const closed = createApp({ dbPath: ":memory:", idpHost: `localhost:${idp.port}` });
  const server = Bun.serve({ port: 0, fetch: closed.fetch });
  try {
    const response = await fetch(new URL("/internal/reset", server.url), { method: "POST", headers: { authorization: "Bearer undefined" } });
    expect(response.status).toBe(401);
  } finally { server.stop(true); closed.close(); }
});
