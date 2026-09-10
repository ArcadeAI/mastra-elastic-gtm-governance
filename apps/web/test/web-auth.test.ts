import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebApp } from "../lib/web-app";
import { createRuntime } from "../lib/agent-runtime";
import { HooksClient } from "../lib/hooks-client";
import { OAuthBrowser } from "./oauth-browser";
import { scriptedModel } from "./helpers";

const directory = mkdtempSync(join(tmpdir(), "workshop-auth-"));
const idpRoot = join(import.meta.dir, "../../idp");
let child: ReturnType<typeof Bun.spawn>; let web: ReturnType<typeof Bun.serve>; let control: ReturnType<typeof Bun.serve>; let verifier: ReturnType<typeof Bun.serve>;
let base: string; let idp: string; let credentials: any; let verifiedIdentity = "";
const emails = { dana: "dana@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" };
const verificationEmail = "verification@example.test";
let verificationEnabled = true, demoMode = true;
let authStatus = "completed", authUser = "", confirmFailure = false;

beforeAll(async () => {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() }); const idpPort = reservation.port; reservation.stop(true);
  idp = `http://127.0.0.1:${idpPort}`;
  control = Bun.serve({ port: 0, fetch(request) { const viewer = new URL(request.url).searchParams.get("viewer_user_id"); return Response.json({ run: { run_id: "pending-dana", requester_user_id: emails.dana, status: "waiting", viewer } }); } });
  verifier = Bun.serve({ port: 0, async fetch(request) {
    if (request.method === "GET") return Response.json({ id: "auth-test", user_id: authUser || verifiedIdentity, status: authStatus });
    verifiedIdentity = ((await request.json()) as any).user_id;
    if (confirmFailure) return Response.json({ error: "user_mismatch" }, { status: 400 });
    return Response.json({ auth_id: "auth-test" });
  } });
  const app = createWebApp({ runtime: () => createRuntime({ model: scriptedModel(["Supplied evidence only"]) }),
    session: () => ({ origin: base, idp, clientId: credentials.client_id, clientSecret: credentials.client_secret, secret: "test-session-secret-with-more-than-32-chars", emails, demoMode, ...(verificationEnabled ? { verificationEmail } : {}) }),
    hooks: () => new HooksClient(`http://127.0.0.1:${control.port}`, "web-token"), arcadeKey: () => "fake-arcade-key", confirmUrl: `http://127.0.0.1:${verifier.port}`, authStatusUrl: `http://127.0.0.1:${verifier.port}` });
  web = Bun.serve({ port: 0, fetch: app.fetch }); base = `http://127.0.0.1:${web.port}`;
  const env = { ...process.env, PORT: String(idpPort), IDP_DB_PATH: join(directory, "idp.db"), IDP_PUBLIC_URL: idp, WORKSHOP_WEB_REDIRECT_URI: `${base}/auth/callback`, BETTER_AUTH_SECRET: "test-idp-secret-with-more-than-32-chars", WORKSHOP_OPERATOR_TOKEN: "local-reset-token", WORKSHOP_VERIFICATION_USER_ID: "verification@example.test", ...Object.fromEntries(Object.entries(emails).map(([name, email]) => [`PERSONA_${name.toUpperCase()}_EMAIL`, email])) };
  child = Bun.spawn([process.execPath, "src/index.ts"], { cwd: idpRoot, env, stdout: "pipe", stderr: "pipe" });
  const deadline = Date.now() + 10_000;
  for (;;) { try { if ((await fetch(`${idp}/health`)).ok) break; } catch { /* Server boot in progress. */ } if (Date.now() > deadline) throw Error("IdP failed to boot"); await Bun.sleep(20); }
  const script = Bun.spawn([process.execPath, "scripts/oauth-client.ts", "--web", "--json"], { cwd: idpRoot, env, stdout: "pipe", stderr: "pipe" });
  credentials = JSON.parse(await new Response(script.stdout).text()); expect(await script.exited).toBe(0);
});
afterAll(() => { child?.kill(); web?.stop(true); control?.stop(true); verifier?.stop(true); rmSync(directory, { recursive: true, force: true }); });

test("APR1.R2 real OAuth session switches Dana to Riley while preserving pending Dana run", async () => {
  const browser = new OAuthBrowser();
  expect((await browser.login(base, "dana", emails.dana, "dana-demo-2026")).status).toBe(303);
  let session = await (await browser.fetch(`${base}/api/session`)).json() as any;
  expect(session.session.persona).toBe("dana");
  const callback = await browser.login(base, "riley", emails.riley, "riley-demo-2026");
  expect(callback.status).toBe(303); expect(callback.headers.get("location")).toBe(`${base}/?run=pending-dana`);
  session = await (await browser.fetch(`${base}/api/session`)).json() as any;
  expect(session.session.persona).toBe("riley"); expect(JSON.stringify(session)).not.toContain("access_token");
  const pending = await (await browser.fetch(`${base}/api/runs/pending-dana`)).json() as any;
  expect(pending.run.status).toBe("waiting"); expect(pending.run.requester_user_id).toBe(emails.dana); expect(pending.run.viewer).toBe(emails.riley);
  const forged = await browser.fetch(`${base}/api/approvals/id/decision`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ decision: "approve", persona: "riley" }) });
  expect(forged.status).toBe(403);
  verifiedIdentity = "";
  const mismatch = await browser.fetch(`${base}/auth/arcade/verify?flow_id=flow&user_id=${emails.dana}`);
  expect(mismatch.status).toBe(403); expect(verifiedIdentity).toBe("");
  const verified = await browser.fetch(`${base}/auth/arcade/verify?flow_id=flow&user_id=${emails.riley}`);
  expect(verified.status).toBe(200); expect(verifiedIdentity).toBe(emails.riley);
});

test("APR1.R2 callback rejects a valid login under a different selected persona", async () => {
  const browser = new OAuthBrowser();
  const callback = await browser.login(base, "riley", emails.dana, "dana-demo-2026");
  expect(callback.status).toBe(403);
  expect((await (await browser.fetch(`${base}/api/session`)).json() as any).session).toBeNull();
});

test("APR1.R2 a forged callback or missing session cannot decide", async () => {
  expect((await fetch(`${base}/auth/callback?state=forged&code=forged&iss=${encodeURIComponent(idp)}`)).status).toBe(400);
  expect((await fetch(`${base}/api/approvals/id/decision`, { method: "POST", body: JSON.stringify({ decision: "approve" }) })).status).toBe(401);
});

test("Revoked OAuth sessions retain sign-in choices and can authenticate again after reset", async () => {
  const browser = new OAuthBrowser();
  expect((await browser.login(base, "dana", emails.dana, "dana-demo-2026")).status).toBe(303);
  expect((await fetch(`${idp}/internal/reset`, { method: "POST", headers: { authorization: "Bearer local-reset-token" } })).status).toBe(200);
  const response = await browser.fetch(`${base}/api/session`);
  expect(response.status).toBe(200);
  const state = await response.json() as any;
  expect(state.session).toBeNull(); expect(state.roles).toEqual(emails);
  expect((await browser.fetch(`${base}/api/approvals/id/decision`, { method: "POST", body: JSON.stringify({ decision: "approve" }) })).status).toBe(401);
  expect((await browser.login(base, "riley", emails.riley, "riley-demo-2026")).status).toBe(303);
  expect((await (await browser.fetch(`${base}/api/session`)).json() as any).session.persona).toBe("riley");
});

test("setup identity completes real OAuth and returns to its Arcade verification flow", async () => {
  const browser = new OAuthBrowser();
  const returnTo = `/auth/arcade/verify?${new URLSearchParams({ flow_id: "setup-flow", user_id: verificationEmail })}`;
  const callback = await browser.login(base, "verification", verificationEmail, "verification-demo-2026", returnTo);
  expect(callback.status).toBe(303);
  expect(callback.headers.get("location")).toBe(`${base}${returnTo}`);
  const state = await (await browser.fetch(`${base}/api/session`)).json() as any;
  expect(state.session.persona).toBe("verification");
  expect(state.session.email).toBe(verificationEmail);
  expect(state.roles).toEqual(emails);
  expect(state.session.token).toBeUndefined();
  const confirmed = await browser.fetch(callback.headers.get("location")!);
  expect(confirmed.status).toBe(200);
  expect(verifiedIdentity).toBe(verificationEmail);
});

test("setup OAuth cannot borrow an attendee role's authenticated identity", async () => {
  const browser = new OAuthBrowser();
  const callback = await browser.login(base, "verification", emails.dana, "dana-demo-2026");
  expect(callback.status).toBe(403);
  expect((await (await browser.fetch(`${base}/api/session`)).json() as any).session).toBeNull();
});

test("setup identity cannot start an attendee's governed agent", async () => {
  const browser = new OAuthBrowser();
  await browser.login(base, "verification", verificationEmail, "verification-demo-2026");
  const state = await (await browser.fetch(`${base}/api/session`)).json() as any;
  const response = await browser.fetch(`${base}/api/agent`, { method: "POST", headers: { origin: base, "content-type": "application/json", "x-csrf-token": state.session.csrf }, body: JSON.stringify({ stage: "governed", message: "Route Northwind" }) });
  expect(response.status).toBe(403);
  expect((await response.json() as any).error).toContain("setup checks only");
});

test.each(["configuration", "demo mode"])("disabling setup %s invalidates its session and login", async (setting) => {
  const browser = new OAuthBrowser();
  expect((await browser.login(base, "verification", verificationEmail, "verification-demo-2026")).status).toBe(303);
  try {
    if (setting === "configuration") verificationEnabled = false; else demoMode = false;
    expect((await browser.fetch(`${base}/auth/login?persona=verification`)).status).toBe(503);
    const state = await (await browser.fetch(`${base}/api/session`)).json() as any;
    expect(state.session).toBeNull();
    expect(state.roles.verification).toBeUndefined();
  } finally { verificationEnabled = true; demoMode = true; }
});


test("Arcade identity confirmation is not authorization completion", async () => {
  const browser = new OAuthBrowser();
  await browser.login(base, "dana", emails.dana, "dana-demo-2026");
  try {
    authStatus = "pending";
    const response = await browser.fetch(`${base}/auth/arcade/verify?flow_id=actual-callback-flow`);
    expect(response.status).toBe(202);
    expect(await response.text()).toContain("Authorization is still pending");
    authStatus = "completed";
    const completed = await browser.fetch(`${base}/auth/arcade/status?auth_id=auth-test`);
    expect(completed.status).toBe(200);
    expect(await completed.text()).toContain("Authorization complete");
    authUser = emails.riley;
    expect((await browser.fetch(`${base}/auth/arcade/status?auth_id=auth-test`)).status).toBe(403);
    authUser = ""; authStatus = "failed";
    const failed = await browser.fetch(`${base}/auth/arcade/status?auth_id=auth-test`);
    expect(failed.status).toBe(409);
    expect(await failed.text()).not.toContain("Authorization complete");
    confirmFailure = true;
    const mismatch = await browser.fetch(`${base}/auth/arcade/verify?flow_id=wrong-user`);
    expect(mismatch.status).toBe(403);
    expect(await mismatch.text()).toContain("different identity");
  } finally { authStatus = "completed"; authUser = ""; confirmFailure = false; }
});

test("Arcade verification without a session preserves the callback in sign-in links", async () => {
  const response = await fetch(`${base}/auth/arcade/verify?flow_id=preserve-this-flow`);
  expect(response.status).toBe(401);
  expect(response.headers.get("content-type")).toContain("text/html");
  const body = await response.text();
  expect(body).toContain("returnTo=");
  expect(body).toContain("preserve-this-flow");
  expect(body).toContain("persona=dana");
});
