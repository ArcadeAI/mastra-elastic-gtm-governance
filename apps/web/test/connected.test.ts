import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHooksApp } from "../../hooks/src/app";
import { createApp as createLeadApp } from "../../lead-app/src/index";
import { HooksClient } from "../lib/hooks-client";
import { OAuthBrowser } from "./oauth-browser";
import { connectedGateway } from "./connected-gateway";
import { names } from "./helpers";
import { GOVERNED_PHONE, GOVERNED_INSTRUCTION } from "../../../scripts/seed-elastic";

function freePort() { const server = Bun.serve({ port: 0, fetch: () => new Response() }); const port = server.port; server.stop(true); return port!; }
async function ready(url: string, process: ReturnType<typeof Bun.spawn>) {
  const end = Date.now() + 15_000;
  for (;;) {
    try { if ((await fetch(url)).ok) return; } catch { /* Local process boot. */ }
    if (process.exitCode !== null || Date.now() > end) { process.kill(); throw new Error(`Process did not start: ${await new Response(process.stderr as ReadableStream).text()}`); }
    await Bun.sleep(25);
  }
}

test("ATT1.R6 / APR1.R2 real IdP, hooks, Python MCP and Lead survive the waiting web process restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "workshop-connected-"));
  const idpPort = freePort(), webPort = freePort();
  const idp = `http://127.0.0.1:${idpPort}`, web = `http://127.0.0.1:${webPort}`;
  const emails = { dana: "attendee@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" };
  const verification = "verification@example.test";
  const privateMarker = "PRIVATE-ROUTE-DISPLAY-MARKER";
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
    for (const [persona, email] of [...Object.entries(emails), ["verification", verification]]) tokens.set(email!, await new OAuthBrowser().token(idp, arcade, email!, `${persona}-demo-2026`));
    config = { port: webPort, privateMarker, db: `file:${directory}/mastra.db`, hooks: hooksOrigin, gateway: gateway.url, emails, proof: join(directory, "model-observation.json"), session: { origin: web, idp, clientId: browserClient.client_id, clientSecret: browserClient.client_secret, secret: "local-web-session-secret-longer-than-32-characters", emails, demoMode: true } };
    const operator = new HooksClient(hooksOrigin, "operator-test");
    // Verification travels through the same gateway and actual Python Lead tool.
    const filtered = await gateway.call("Lead.GetLead", { lead_id: "LD-2291" }, verification);
    expect(JSON.stringify(filtered)).not.toContain("+1-415-555-0137");
    const probe = await gateway.call(names.route, { lead_id: "LD-2291", estimated_acv: 95000, owner_email: emails.riley, rationale: "Operator proof", operation_key: "verification-1" }, verification) as any;
    expect(probe.code).toBe("CHECK_FAILED");
    expect((await operator.request("/operator/activate", {})).active).toBe(true);
    // This restriction deliberately matches RouteLead only. The combined run
    // display must honor it without replacing canonical pending-action inputs.
    const displayPolicy = await operator.request("/operator/policy");
    displayPolicy.output_rules.push({ ...displayPolicy.output_rules[0], id: "private-route-display", match: { toolkit: "Lead", tool: "RouteLead" }, fields: [], patterns: [{ id: "private-route-marker", regex: privateMarker, strategy: "remove", replacement: "", flags: "" }] });
    const policySaved = await fetch(`${hooksOrigin}/operator/policy`, { method: "PUT", headers: { authorization: "Bearer operator-test", "content-type": "application/json" }, body: JSON.stringify(displayPolicy) });
    expect(policySaved.status).toBe(200);
    await launch("start");
    const browser = new OAuthBrowser();
    expect((await browser.login(web, "dana", emails.dana, "dana-demo-2026")).status).toBe(303);
    async function post(path: string, body: unknown) {
      const session = await (await browser.fetch(`${web}/api/session`)).json() as any;
      const response = await browser.fetch(`${web}${path}`, { method: "POST", headers: { origin: web, "x-csrf-token": session.session.csrf, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as any };
    }
    const started = await post("/api/agent", { stage: "governed", message: "Research and route Northwind Robotics with source citations" });
    expect(started.status, JSON.stringify(started.body)).toBe(200); expect(started.body.status).toBe("waiting");
    const runId = started.body.runId;
    const elasticResult = gateway.elasticOutputs.find((result) => result.actor === emails.dana)!;
    expect(elasticResult).toBeDefined();
    for (const marker of [GOVERNED_PHONE, GOVERNED_INSTRUCTION]) {
      expect(JSON.stringify(elasticResult.before)).toContain(marker);
      expect(JSON.stringify(elasticResult.after)).not.toContain(marker);
    }
    expect((elasticResult.after as any).hits.map((row: any) => row.event_id)).toEqual(["evt-northwind-001", "evt-northwind-002", "evt-northwind-003", "evt-northwind-004"]);
    expect(JSON.parse(readFileSync(config.proof, "utf8")).filtered_model_observation).toBe(true);
    expect(JSON.parse(readFileSync(config.proof, "utf8")).offered_tools).toEqual(["Elastic.Search", "Lead.SearchLeads", "Lead.GetLead", names.route, names.classify, names.requestApproval].sort());
    expect(gateway.posts).toHaveLength(1); expect(gateway.posts[0].channel).toBe("DSELF");
    expect(JSON.stringify(gateway.posts)).toContain("Riley");
    const waiting = await (await browser.fetch(`${web}/api/runs/${runId}`)).json() as any;
    expect(waiting.run.status).toBe("waiting"); expect(waiting.run.tool_calls.length).toBeGreaterThan(1);
    expect(JSON.stringify(started.body.toolCalls)).not.toContain(privateMarker);
    expect(started.body.toolCalls).toEqual(waiting.run.tool_calls);
    expect(started.body.model).toEqual(waiting.run.model);
    const originalAttempt = gateway.calls.find((call) => call.name === names.route && call.actor === emails.dana);
    expect(originalAttempt?.args.rationale).toContain(privateMarker);
    const receiptBefore = await fetch(`${leadOrigin}/internal/operations/${encodeURIComponent(waiting.run.operation_key)}`, { headers: { authorization: "Bearer lead-test" } }); expect(receiptBefore.status).toBe(404);
    expect((await post(`/api/runs/${runId}/resume`, {})).status).toBe(409);
    // The self-DM link plus valid CSRF never turns Dana into the assigned Riley.
    const selfVote = await post(`/api/approvals/${waiting.run.request_id}/decision?persona=riley`, { decision: "approve" });
    expect(selfVote.status).toBeGreaterThanOrEqual(400); expect(selfVote.body.error).toBeString();
    const selfVoteCall = gateway.toolExecutions.filter((call) => call.name === "Approvals_Decide").at(-1);
    expect(selfVoteCall?.actor).toBe(emails.dana);
    const afterSelfVote = await (await browser.fetch(`${web}/api/approvals/${waiting.run.request_id}`)).json() as any;
    expect(afterSelfVote.approval.status).toBe("pending"); expect(afterSelfVote.approval.grant_id).toBeNull();
    expect(gateway.calls.filter((call) => call.name === names.route && call.actor === emails.dana && !call.denied)).toHaveLength(0);
    expect((await post(`/api/approvals/${waiting.run.request_id}/decision`, { decision: "approve", persona: "riley" })).status).toBe(400);
    // Process termination closes LibSQL. The replacement reads its disk snapshot.
    await launch("resume");
    expect((await browser.login(web, "riley", emails.riley, "riley-demo-2026")).status).toBe(303);
    // A gateway execution refusal happens before the actual Decide tool and
    // cannot be mistaken for a committed approval just because OAuth succeeded.
    const beforeRejectedExecution = gateway.toolExecutions.length;
    gateway.setRejectDecide(true);
    const rejectedDecision = await post(`/api/approvals/${waiting.run.request_id}/decision`, { decision: "approve" });
    gateway.setRejectDecide(false);
    expect(rejectedDecision.status).toBeGreaterThanOrEqual(400); expect(rejectedDecision.body.error).toMatch(/gateway|execution/i);
    expect(gateway.toolExecutions).toHaveLength(beforeRejectedExecution);
    const afterRejectedExecution = await (await browser.fetch(`${web}/api/approvals/${waiting.run.request_id}`)).json() as any;
    expect(afterRejectedExecution.approval.status).toBe("pending"); expect(afterRejectedExecution.approval.grant_id).toBeNull();
    expect((await post(`/api/runs/${runId}/resume`, {})).status).toBe(409);
    expect((await fetch(`${leadOrigin}/internal/operations/${encodeURIComponent(waiting.run.operation_key)}`, { headers: { authorization: "Bearer lead-test" } })).status).toBe(404);
    const approved = await post(`/api/approvals/${waiting.run.request_id}/decision`, { decision: "approve" });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200); expect(approved.body.approval.status).toBe("approved");
    const resumed = await post(`/api/runs/${runId}/resume`, {});
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200); expect(resumed.body.status).toBe("completed"); expect(resumed.body.text).toContain("evt-northwind-001");
    const repeated = await post(`/api/runs/${runId}/resume`, {}); expect(repeated.status).toBe(200); expect(repeated.body.status).toBe("completed");
    const persisted = await (await browser.fetch(`${web}/api/runs/${runId}`)).json() as any;
    expect(persisted.run.requester_user_id).toBe(emails.dana); expect(persisted.run.resumed_at).toBeString();
    expect(resumed.body.text).not.toContain(privateMarker);
    expect(JSON.stringify(resumed.body.toolCalls)).not.toContain(privateMarker);
    expect(resumed.body.text).toBe(persisted.run.text);
    expect(resumed.body.toolCalls).toEqual(persisted.run.tool_calls);
    expect(resumed.body.model).toEqual(persisted.run.model);
    expect(persisted.run.tool_calls.some((call: any) => call.name.includes("Elastic"))).toBe(true);
    const receipt = await (await fetch(`${leadOrigin}/internal/operations/${encodeURIComponent(waiting.run.operation_key)}`, { headers: { authorization: "Bearer lead-test" } })).json() as any;
    expect(receipt.actor).toBe(emails.dana); expect(receipt.operation_key).toBe(waiting.run.operation_key);
    expect(receipt.body.rationale).toBe(originalAttempt!.args.rationale);
    expect(receipt.body.rationale).toContain(privateMarker);
    expect(gateway.calls.filter((call) => call.name === names.route && call.actor === emails.dana && !call.denied)).toHaveLength(1);
    expect(gateway.posts).toHaveLength(1);
    const leadAfter = await (await fetch(`${leadOrigin}/leads/LD-2291`, { headers: { authorization: `Bearer ${tokens.get(emails.dana)}` } })).json() as any;
    expect(leadAfter.decisions.filter((decision: any) => decision.decided_by === emails.dana)).toHaveLength(1);
    const safeAudit = await (await browser.fetch(`${web}/api/audit?run_id=${runId}`)).json() as any;
    expect(safeAudit.events.length).toBeGreaterThan(4); expect(JSON.stringify(safeAudit)).not.toContain("+1-415-555-0137");
    expect(persisted.run.tool_calls.find((call: any) => call.mcpName === names.route).args.operation_key).toBe(waiting.run.operation_key);
    expect(persisted.run.model.source).toBe("injected-model");
    // A denied wait closes without running its action and releases the requester slot.
    await launch("start");
    await browser.login(web, "dana", emails.dana, "dana-demo-2026");
    const rejectedRun = await post("/api/agent", { stage: "governed", message: "Research Northwind and request the route" });
    expect(rejectedRun.body.status).toBe("waiting");
    const rejectedId = rejectedRun.body.runId;
    const rejectedState = await (await browser.fetch(`${web}/api/runs/${rejectedId}`)).json() as any;
    await browser.login(web, "riley", emails.riley, "riley-demo-2026");
    expect((await post(`/api/approvals/${rejectedState.run.request_id}/decision`, { decision: "deny" })).status).toBe(200);
    expect((await post(`/api/runs/${rejectedId}/resume`, {})).status).toBe(409);
    expect((await post(`/api/runs/${rejectedId}/close`, {})).body.run.status).toBe("failed");
    expect((await post(`/api/runs/${rejectedId}/resume`, {})).status).toBe(409);
    await launch("start");
    await browser.login(web, "dana", emails.dana, "dana-demo-2026");
    const expiryRun = await post("/api/agent", { stage: "governed", message: "Start a new Northwind exercise" });
    expect(expiryRun.body.status).toBe("waiting");
    const expiryState = await (await browser.fetch(`${web}/api/runs/${expiryRun.body.runId}`)).json() as any;
    hooksNow += 16 * 60_000;
    const expiredResume = await post(`/api/runs/${expiryRun.body.runId}/resume`, {});
    expect(expiredResume.status).toBe(409); expect(expiredResume.body.error).toContain("expired");
    const expiredApproval = await (await browser.fetch(`${web}/api/approvals/${expiryState.run.request_id}`)).json() as any;
    expect(expiredApproval.approval.status).toBe("expired"); expect(expiredApproval.approval.grant_id).toBeNull();
    expect((await fetch(`${leadOrigin}/internal/operations/${encodeURIComponent(expiryState.run.operation_key)}`, { headers: { authorization: "Bearer lead-test" } })).status).toBe(404);
    expect(gateway.calls.filter((call) => call.name === names.route && call.actor === emails.dana && !call.denied)).toHaveLength(1);
    // Owner reset refuses stale/unreset hooks; native API deletes only after reset.
    async function resetWeb(epoch: number) { return fetch(`${web}/api/operator/reset`, { method: "POST", headers: { authorization: "Bearer operator-test", "content-type": "application/json" }, body: JSON.stringify({ reset_epoch: epoch }) }); }
    expect((await resetWeb(1)).status).toBe(409);
    const reset = await operator.request("/operator/reset", {});
    const resetResponse = await resetWeb(reset.reset_epoch); expect(resetResponse.status).toBe(200); expect((await resetResponse.json() as any).deleted_snapshots).toBe(1);
    expect((await fetch(`${idp}/internal/reset`, { method: "POST" })).status).toBe(401);
    const idpReset = await fetch(`${idp}/internal/reset`, { method: "POST", headers: { authorization: "Bearer operator-test" } }); expect(idpReset.status).toBe(200); expect((await idpReset.json() as any).oauth_clients_preserved).toBe(2);
    expect(await credentials()).toEqual(arcade); expect(await credentials(true)).toEqual(browserClient);
  } finally {
    if (child) { child.kill(); await child.exited; }
    idpChild.kill(); await idpChild.exited;
    await gateway.close(); hooks.stop(true); lead.stop(true); hooksApp.close(); leadApp.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
