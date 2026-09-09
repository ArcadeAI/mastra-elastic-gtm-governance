import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHooksApp } from "../../hooks/src/app";
import { createApp as createLeadApp } from "../../lead-app/src/index";
import { HooksClient } from "../lib/hooks-client";
import { OAuthBrowser } from "./oauth-browser";
import { connectedGateway } from "./connected-gateway";
import { names } from "./helpers";

function freePort() { const server = Bun.serve({ port: 0, fetch: () => new Response() }); const port = server.port; server.stop(true); return port!; }
async function ready(url: string, process: ReturnType<typeof Bun.spawn>) {
  const end = Date.now() + 15_000;
  for (;;) {
    try { if ((await fetch(url)).ok) return; } catch { /* Local process boot. */ }
    if (process.exitCode !== null || Date.now() > end) { process.kill(); throw new Error(`Process did not start: ${await new Response(process.stderr as ReadableStream).text()}`); }
    await Bun.sleep(25);
  }
}

test("APR1.R2 expired approval-page decision is rejected through authenticated web and actual Decide MCP", async () => {
  const directory = mkdtempSync(join(tmpdir(), "workshop-expired-decision-"));
  const idpPort = freePort(), webPort = freePort();
  const idp = `http://127.0.0.1:${idpPort}`, web = `http://127.0.0.1:${webPort}`;
  const emails = { dana: "attendee@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" };
  const verification = "verification@example.test";
  let hooksNow = Date.now();
  const leadApp = createLeadApp({ dbPath: join(directory, "lead.db"), idpHost: new URL(idp).host, internalToken: "lead-test" });
  const lead = Bun.serve({ port: 0, fetch: leadApp.fetch }); const leadOrigin = `http://127.0.0.1:${lead.port}`;
  const hooksApp = createHooksApp({ dbPath: join(directory, "hooks.db"), hookSecret: "hook-test", operatorToken: "operator-test", approvalsToken: "approvals-test", webToken: "web-test", leadHost: leadOrigin, leadToken: "lead-test", idpHost: idp, webOrigin: web, subjectEmails: emails, verificationUserId: verification, elasticTools: [{ toolkit: "Elastic", name: "Search", arguments: ["query"] }], mcpToolNames: names, soloSlackDelivery: true, allowedSlackTeamId: "TWORKSHOP", now: () => hooksNow });
  const hooks = Bun.serve({ port: 0, fetch: hooksApp.fetch }); const hooksOrigin = `http://127.0.0.1:${hooks.port}`;
  const tokens = new Map<string, string>();
  const gateway = connectedGateway({ hooks: hooksOrigin, lead: leadOrigin, directory, tokens });
  const idpRoot = join(import.meta.dir, "../../idp");
  const env = { ...process.env, PORT: String(idpPort), IDP_DB_PATH: join(directory, "idp.db"), IDP_PUBLIC_URL: idp, WORKSHOP_WEB_REDIRECT_URI: `${web}/auth/callback`, IDP_OAUTH_REDIRECT_URIS: "http://localhost:3000/callback", BETTER_AUTH_SECRET: "local-idp-proof-secret-longer-than-32-characters", WORKSHOP_OPERATOR_TOKEN: "operator-test", WORKSHOP_VERIFICATION_USER_ID: verification, ...Object.fromEntries(Object.entries(emails).map(([role, email]) => [`PERSONA_${role.toUpperCase()}_EMAIL`, email])) };
  const idpChild = Bun.spawn([process.execPath, "src/index.ts"], { cwd: idpRoot, env, stdout: "ignore", stderr: "pipe" });
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const configPath = join(directory, "web.json");
  let config: any;
  async function launch(phase: "start" | "resume") {
    if (child) { child.kill(); await child.exited; }
    writeFileSync(configPath, JSON.stringify({ ...config, phase }));
    child = Bun.spawn([process.execPath, join(import.meta.dir, "connected-worker.ts"), configPath], { stdout: "ignore", stderr: "pipe" });
    await ready(`${web}/api/session`, child);
  }
  async function credentials(webClient = false) {
    const command = Bun.spawn([process.execPath, "scripts/oauth-client.ts", ...(webClient ? ["--web"] : []), "--json"], { cwd: idpRoot, env, stdout: "pipe", stderr: "pipe" });
    const result = JSON.parse(await new Response(command.stdout).text());
    expect(await command.exited).toBe(0); return result;
  }
  try {
    await ready(`${idp}/health`, idpChild);
    const arcade = await credentials(); const browserClient = await credentials(true);
    for (const [persona, email] of [["dana", emails.dana], ["riley", emails.riley], ["verification", verification]]) tokens.set(email!, await new OAuthBrowser().token(idp, arcade, email!, `${persona}-demo-2026`));
    config = { port: webPort, db: `file:${directory}/mastra.db`, hooks: hooksOrigin, gateway: gateway.url, emails, proof: join(directory, "model-observation.json"), session: { origin: web, idp, clientId: browserClient.client_id, clientSecret: browserClient.client_secret, secret: "local-web-session-secret-longer-than-32-characters", emails, demoMode: true } };
    const operator = new HooksClient(hooksOrigin, "operator-test");
    // Verification travels through the same gateway and actual Python Lead tool.
    const filtered = await gateway.call("Lead.GetLead", { lead_id: "LD-2291" }, verification);
    expect(JSON.stringify(filtered)).not.toContain("+1-415-555-0137");
    const probe = await gateway.call(names.route, { lead_id: "LD-2291", estimated_acv: 95000, owner_email: emails.riley, rationale: "Operator proof", operation_key: "verification-1" }, verification) as any;
    expect(probe.code).toBe("CHECK_FAILED");
    expect((await operator.request("/operator/activate", {})).active).toBe(true);
    await launch("start");
    const browser = new OAuthBrowser();
    expect((await browser.login(web, "dana", emails.dana, "dana-demo-2026")).status).toBe(303);
    async function post(path: string, body: unknown) {
      const session = await (await browser.fetch(`${web}/api/session`)).json() as any;
      const response = await browser.fetch(`${web}${path}`, { method: "POST", headers: { origin: web, "x-csrf-token": session.session.csrf, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as any };
    }
    const started = await post("/api/agent", { stage: "governed", message: "Research and route Northwind Robotics with source citations" });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.status).toBe("waiting");
    const waiting = await (await browser.fetch(`${web}/api/runs/${started.body.runId}`)).json() as any;
    const requestId = waiting.run.request_id;
    const before = await (await browser.fetch(`${web}/api/approvals/${requestId}`)).json() as any;
    expect(before.approval.status).toBe("pending");
    expect(before.approval.grant_id).toBeNull();
    expect(before.approval.approver_id).toBe(emails.riley);

    // Expire the actual stored request using the hooks clock. The next approval
    // operation is the authenticated decision POST, with no intervening GET or
    // resume that could materialize expiry before the tool handles the vote.
    hooksNow = Date.parse(before.approval.expires_at) + 1;
    expect((await browser.login(web, "riley", emails.riley, "riley-demo-2026")).status).toBe(303);
    const vote = await post(`/api/approvals/${requestId}/decision`, { decision: "approve" });
    expect(vote.status).toBeGreaterThanOrEqual(400);
    expect(vote.body.error).toContain("HTTP 409");
    expect(gateway.toolExecutions.filter((call) => call.name === "Approvals_Decide")).toEqual([{ name: "Approvals_Decide", actor: emails.riley }]);

    const after = await (await browser.fetch(`${web}/api/approvals/${requestId}`)).json() as any;
    expect(after.approval.status).toBe("expired");
    expect(after.approval.grant_id).toBeNull();
    expect((await fetch(`${leadOrigin}/internal/operations/${encodeURIComponent(waiting.run.operation_key)}`, { headers: { authorization: "Bearer lead-test" } })).status).toBe(404);
    expect(gateway.calls.filter((call) => call.name === names.route && call.actor === emails.dana && !call.denied)).toEqual([]);
    const leadAfter = await (await fetch(`${leadOrigin}/leads/LD-2291`, { headers: { authorization: `Bearer ${tokens.get(emails.dana)}` } })).json() as any;
    expect(leadAfter.decisions.filter((decision: any) => decision.decided_by === emails.dana)).toEqual([]);
    expect(JSON.stringify(vote.body)).toMatch(/expired/i);
  } finally {
    if (child) { child.kill(); await child.exited; }
    idpChild.kill(); await idpChild.exited;
    await gateway.close(); hooks.stop(true); lead.stop(true); hooksApp.close(); leadApp.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
