import { afterEach, expect, test } from "bun:test";
import { createHooksApp } from "../../hooks/src/app";
import { createApprovalClient, ApprovalClientError } from "../lib/approval-client";

// Real hooks/SQLite own claims and decisions. Only Arcade, Slack, Lead and IdP
// HTTP boundaries are local fixtures. No test can select a live Slack endpoint.
const dana = "dana@example.test", riley = "riley@example.test";
const apiKey = "private-arcade-credential", serviceToken = "private-approvals-credential", slackToken = "private-slack-credential";
const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

async function fixture(rationale = "Qualified account") {
  const state = {
    authorized: false, authFailure: 0, statusCompletes: false, authUrl: "https://api.arcade.dev/authorize/local", postError: "", postHttp: 200,
    malformedPost: false, wrongChannel: false, ackFailures: 0, lostAckResponses: 0, ackCalls: 0, rawClaim: undefined as unknown,
    posts: [] as Record<string, any>[], authorizations: [] as Record<string, any>[],
    statusIds: [] as string[], slackMethods: [] as string[], decisionError: null as { status: number; body: unknown } | null,
  };
  const dependency = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url), body = req.method === "POST" ? await req.json() as any : {};
    if (url.pathname.startsWith("/v1/auth/")) {
      if (req.headers.get("authorization") !== `Bearer ${apiKey}`) return new Response("Unauthorized", { status: 401 });
      if (state.authFailure) return Response.json({ error: slackToken }, { status: state.authFailure });
      if (url.pathname === "/v1/auth/authorize") state.authorizations.push(body);
      else if (url.pathname === "/v1/auth/status") { state.statusIds.push(url.searchParams.get("id")!); if (state.statusCompletes) state.authorized = true; }
      else return new Response("Missing", { status: 404 });
      return Response.json({ id: "auth-local", status: state.authorized ? "completed" : "pending", user_id: dana, url: state.authUrl, context: { token: state.authorized ? slackToken : null }, private_extra: apiKey });
    }
    if (url.pathname.startsWith("/slack/")) {
      if (req.headers.get("authorization") !== `Bearer ${slackToken}`) return Response.json({ ok: false, error: "invalid_auth" });
      const method = url.pathname.slice(7); state.slackMethods.push(method);
      if (method === "auth.test") return Response.json({ ok: true, user_id: "ULOCAL", team_id: "TLOCAL" });
      if (method === "conversations.open") return body.users === "ULOCAL" ? Response.json({ ok: true, channel: { id: "DSELF" } }) : Response.json({ ok: false, error: "invalid_user" });
      if (method === "chat.postMessage") {
        state.posts.push(body);
        if (state.malformedPost) return new Response("invalid-json");
        if (state.postError || state.postHttp !== 200) return Response.json({ ok: false, error: state.postError || slackToken }, { status: state.postHttp });
        return Response.json({ ok: true, channel: state.wrongChannel ? "DPUBLICOTHER" : "DSELF", ts: "100.002", token: slackToken });
      }
    }
    if (url.pathname === "/oauth2/userinfo") {
      const token = req.headers.get("authorization");
      return token === "Bearer riley-oauth" || token === "Bearer dana-oauth" ? Response.json({ email: token === "Bearer riley-oauth" ? riley : dana }) : new Response("Unauthorized", { status: 401 });
    }
    if (url.pathname.startsWith("/internal/accounts/")) return Response.json({ account_id: "ACC-2291", list_price: 12000 });
    return new Response("Missing", { status: 404 });
  } });
  cleanup.push(() => dependency.stop(true));
  const app = createHooksApp({ dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: serviceToken, webToken: "web", leadToken: "lead", leadHost: dependency.url.origin, idpHost: dependency.url.origin, webOrigin: "https://workshop.example", subjectEmails: { dana, riley, sam: "sam@example.test", morgan: "morgan@example.test" }, verificationUserId: "verify@example.test", elasticTools: [], soloSlackDelivery: true });
  cleanup.push(() => app.close());
  const hooks = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.endsWith("/notification/claim") && state.rawClaim !== undefined) return Response.json(state.rawClaim);
    if (path.endsWith("/notification/result")) {
      state.ackCalls++;
      if (state.ackFailures-- > 0) return Response.json({ error: serviceToken }, { status: 503 });
      if (state.lostAckResponses-- > 0) { await app.fetch(req); return Response.json({ error: serviceToken }, { status: 503 }); }
    }
    if (path.endsWith("/decision") && state.decisionError) return Response.json(state.decisionError.body, { status: state.decisionError.status });
    return app.fetch(req);
  } });
  cleanup.push(() => hooks.stop(true));
  async function hookCall(path: string, token: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(`${hooks.url.origin}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(`Fixture hook request ${path} failed: ${response.status}`);
    return result;
  }
  const action = { account_id: "ACC-2291", list_price: 12000, discount_percent: 30, rationale, customer_message: "Let us review your renewal and open support issue.", operation_key: "local-operation" };
  const pre = (user: string) => ({ execution_id: crypto.randomUUID(), context: { user_id: user }, tool: { toolkit: "Sales", name: "CreateDiscountedOffer", version: "1.0.0" }, inputs: action });
  const verificationDenial = pre("verify@example.test"), verificationFilter = pre("verify@example.test");
  await hookCall("/operator/verification", "operator", { operation_key: action.operation_key });
  await hookCall("/pre", "hook", verificationDenial);
  await hookCall("/post", "hook", { ...verificationFilter, success: true, output: { personal_phone: "+1-415-555-0137" } });
  await hookCall("/operator/verification/confirm", "operator", { operation_key: action.operation_key, denial_execution_id: verificationDenial.execution_id, filter_execution_id: verificationFilter.execution_id });
  await hookCall("/operator/activate", "operator", {});
  await hookCall("/internal/runs", "web", { run_id: "local-run", requester_user_id: dana, stage: "governed", message: "Route Northwind" });
  await hookCall("/internal/runs/local-run/action", "web", { operation_key: action.operation_key, tool_name: "Sales.CreateDiscountedOffer", arguments: action });
  await hookCall("/pre", "hook", pre(dana));
  if (dependency.url.hostname !== "127.0.0.1") throw new Error("Tests require a loopback Slack boundary.");
  const config = { hooksHost: hooks.url.origin, serviceToken, arcadeKey: apiKey, arcadeBaseUrl: dependency.url.origin, slackBaseUrl: `${dependency.url.origin}/slack` };
  return { state, client: createApprovalClient(config), config, hookCall };
}

test("pending Slack consent keeps a real approval without delivering a message", async () => {
  const { client, state } = await fixture();
  const result = await client.request("local-run", dana);
  expect(result.approval.operation_key).toBe("local-operation");
  expect(result.approval.approver_id).toBe(riley);
  expect(result.approval.notification_status).toBe("pending");
  expect(result.authorizationUrls).toEqual(["https://api.arcade.dev/authorize/local"]);
  expect(state.authorizations[0]).toEqual({ user_id: dana, auth_requirement: { provider_id: "slack", provider_type: "oauth2", oauth2: { scopes: ["chat:write", "im:write", "users:read", "users:read.email"] } } });
  expect(state.statusIds).toEqual(["auth-local"]);
  expect(state.slackMethods).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(apiKey);
  expect(JSON.stringify(result)).not.toContain(slackToken);
});

test("consent completion delivers one self-DM through a concurrent retry", async () => {
  const { client, state } = await fixture();
  const pending = await client.request("local-run", dana);
  state.authorized = true;
  await Promise.all(Array.from({ length: 4 }, () => client.notify(pending.approval.request_id, dana)));
  const result = await client.request("local-run", dana);
  expect(result.approval.request_id).toBe(pending.approval.request_id);
  expect(result.approval.notification_status).toBe("sent");
  expect(result.authorizationUrls).toEqual([]);
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]!.channel).toBe("DSELF");
  expect(state.posts[0]!.blocks[1].fields.map((field: any) => field.text).join(" ")).toContain("Riley Chen");
  expect(JSON.stringify(state.posts[0])).toContain("Discount\\n30%");
  expect(JSON.stringify(state.posts[0])).toContain(`/approvals/${pending.approval.request_id}`);
  expect(JSON.stringify(result)).not.toContain(slackToken);
});

test.each(["~ 🕷️ Anansi, Thierry's Agent", "~ Renewal workshop agent"])("self-DM includes configured signature %s in fallback text and its final visible block", async (signature) => {
  const { config, state } = await fixture();
  const client = createApprovalClient({ ...config, slackSignature: signature });
  state.authorized = true;
  const result = await client.request("local-run", dana);
  expect(result.approval.notification_status).toBe("sent");
  expect(state.posts).toHaveLength(1);
  const message = state.posts[0]!;
  expect(message.text.endsWith(`\n\n${signature}`)).toBe(true);
  expect(message.blocks.at(-1)).toEqual({
    type: "section", text: { type: "plain_text", text: signature },
  });
});

test("self-DM has no host attribution when the signature is not configured", async () => {
  const { client, state } = await fixture();
  state.authorized = true;
  const result = await client.request("local-run", dana);
  expect(result.approval.notification_status).toBe("sent");
  expect(state.posts).toHaveLength(1);
  const message = state.posts[0]!;
  expect(message.text).toContain("30% discount");
  expect(message.text).toContain("$8,400");
  expect(message.blocks.at(-1)).toEqual({
    type: "context", elements: [{ type: "plain_text", text: "Opens the workshop review page. Sign in as Riley to review the exact terms and customer draft." }],
  });
});

test("authorization failure retains the created approval for snapshot persistence", async () => {
  const { client, state } = await fixture();
  state.authFailure = 403;
  const result = await client.request("local-run", dana);
  expect(result.approval.request_id).toBeString();
  expect(result.approval.notification_status).toBe("pending");
  expect(result.approval.notification_error).toContain("HTTP 403");
  expect(result.authorizationUrls).toEqual([]);
  expect(state.posts).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(slackToken);
  state.authFailure = 0; state.authorized = true;
  const retried = await client.notify(result.approval.request_id, dana);
  expect(retried.approval.notification_status).toBe("sent");
});

test("provider consent links retain their challenge query", async () => {
  const { client, state } = await fixture();
  state.authUrl = "https://api.arcade.dev/authorize?flow_id=local-flow&state=challenge";
  const result = await client.request("local-run", dana);
  expect(result.authorizationUrls).toEqual([state.authUrl]);
  expect(result.approval.notification_status).toBe("pending");
});

test.each(["internal_error", "fatal_error", "credential-error", "malformed", "wrong-channel", "http-500"])("ambiguous Slack outcome %s never posts again", async (outcome) => {
  const { client, state } = await fixture(); state.authorized = true;
  if (outcome === "malformed") state.malformedPost = true;
  else if (outcome === "wrong-channel") state.wrongChannel = true;
  else if (outcome === "http-500") state.postHttp = 500;
  else state.postError = outcome === "credential-error" ? slackToken : outcome;
  const first = await client.request("local-run", dana);
  const retried = await client.notify(first.approval.request_id, dana);
  expect(first.approval.notification_status).toBe("uncertain");
  expect(retried.approval.notification_status).toBe("uncertain");
  expect(state.posts).toHaveLength(1);
  expect(JSON.stringify(first)).not.toContain(slackToken);
});

test.each(["missing_scope", "http-429"])("known no-send rejection %s allows explicit retry", async (outcome) => {
  const { client, state } = await fixture(); state.authorized = true;
  if (outcome === "http-429") state.postHttp = 429; else state.postError = outcome;
  const first = await client.request("local-run", dana);
  expect(first.approval.notification_status).toBe("failed");
  expect(state.posts).toHaveLength(1);
  state.postHttp = 200; state.postError = "";
  const retried = await client.notify(first.approval.request_id, dana);
  expect(retried.approval.notification_status).toBe("sent");
  expect(state.posts).toHaveLength(2);
});

test.each(["before-commit", "after-commit"])("lost acknowledgement %s retries only the receipt", async (failure) => {
  const { client, state } = await fixture(); state.authorized = true;
  if (failure === "before-commit") state.ackFailures = 2; else state.lostAckResponses = 2;
  const result = await client.request("local-run", dana);
  expect(result.approval.notification_status).toBe("sent");
  expect(state.posts).toHaveLength(1);
  expect(state.ackCalls).toBe(3);
});

test("exhausted acknowledgement preserves sending state without another post", async () => {
  const { client, state } = await fixture(); state.authorized = true; state.ackFailures = 10;
  const first = await client.request("local-run", dana);
  expect(first.approval.notification_status).toBe("sending");
  expect(first.approval.notification_error).toContain("do not resend");
  const again = await client.notify(first.approval.request_id, dana);
  expect(again.approval.notification_status).toBe("sending");
  expect(state.posts).toHaveLength(1);
  expect(state.ackCalls).toBe(3);
});

test("assigned IdP identity decides the delivered request idempotently", async () => {
  const { client, state } = await fixture(); state.authorized = true;
  const requested = await client.request("local-run", dana);
  const approved = await client.decide(requested.approval.request_id, riley, "riley-oauth", "approve", "Reviewed");
  expect(approved.approval.status).toBe("approved");
  expect(approved.approval.grant_id).toBeString();
  expect(approved.approval.operation_key).toBe("local-operation");
  const repeated = await client.decide(requested.approval.request_id, riley, "riley-oauth", "approve");
  expect(repeated.approval.grant_id).toBe(approved.approval.grant_id);
  await expect(client.decide(requested.approval.request_id, riley, "riley-oauth", "deny")).rejects.toMatchObject({ status: 409 });
  expect(JSON.stringify(approved)).not.toContain("riley-oauth");
  expect(state.posts).toHaveLength(1);
});

test.each([[dana, "dana-oauth"], [riley, "dana-oauth"], [riley, ""]])("decision rejects unauthorized identity %s with token %s", async (actor, token) => {
  const { client, state } = await fixture(); state.authorized = true;
  const requested = await client.request("local-run", dana);
  const error = await client.decide(requested.approval.request_id, actor!, token!, "approve").catch(error => error);
  expect(error).toBeInstanceOf(ApprovalClientError);
  expect([401, 403]).toContain(error.status);
  expect((await client.notify(requested.approval.request_id, dana)).approval.status).toBe("pending");
});

test.each([
  { status: 409, body: { error: "Request already has a different or expired decision.", detail: serviceToken }, knownExpiry: true },
  { status: 409, body: { error: serviceToken }, knownExpiry: false },
  { status: 409, body: [serviceToken], knownExpiry: false },
  { status: 403, body: { error: "Request already has a different or expired decision.", detail: serviceToken }, knownExpiry: false },
])("decision HTTP $status preserves only the known safe expiry explanation", async ({ status, body, knownExpiry }) => {
  const { client, state } = await fixture(); state.authorized = true;
  const requested = await client.request("local-run", dana);
  state.decisionError = { status, body };
  const error = await client.decide(requested.approval.request_id, riley, "riley-oauth", "approve").catch(error => error);
  expect(error).toBeInstanceOf(ApprovalClientError);
  expect(error.status).toBe(status);
  expect(error.message.includes("expired")).toBe(knownExpiry);
  expect(error.message).not.toContain(serviceToken);
  expect(error.details).toBeUndefined();
});

test("foreign request ownership fails before calling Arcade or Slack", async () => {
  const { client, state } = await fixture();
  await expect(client.request("local-run", riley)).rejects.toMatchObject({ status: 403 });
  expect(state.authorizations).toEqual([]);
  const pending = await client.request("local-run", dana);
  const authCount = state.authorizations.length;
  await expect(client.notify(pending.approval.request_id, riley)).rejects.toMatchObject({ status: 403 });
  expect(state.authorizations).toHaveLength(authCount);
  expect(state.slackMethods).toEqual([]);
});

test.each([{ claim_id: null, notification_status: "pending" }, { claim_id: "invalid", notification_status: "sent" }])("an inconsistent notification claim never posts", async (claim) => {
  const { client, state } = await fixture(); state.authorized = true; state.rawClaim = claim;
  const result = await client.request("local-run", dana);
  expect(result.approval.notification_status).toBe("pending");
  expect(result.approval.notification_error).toContain("invalid delivery claim");
  expect(state.posts).toEqual([]);
});

test("known server credentials cannot be reflected into the Slack display or response", async () => {
  const { client, state } = await fixture(`Qualified account ${apiKey} ${serviceToken} ${slackToken}`); state.authorized = true;
  const result = await client.request("local-run", dana);
  expect(result.approval.notification_status).toBe("sent");
  expect(JSON.stringify(state.posts)).toContain("Qualified account");
  for (const secret of [apiKey, serviceToken, slackToken]) {
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(state.posts)).not.toContain(secret);
  }
});

test("authorization completed by the status endpoint can deliver immediately", async () => {
  const { client, state } = await fixture(); state.statusCompletes = true;
  const result = await client.request("local-run", dana);
  expect(state.statusIds).toEqual(["auth-local"]);
  expect(result.approval.notification_status).toBe("sent");
  expect(result.authorizationUrls).toEqual([]);
  expect(state.posts).toHaveLength(1);
});

 test("approval DM summarizes terms without dumping action JSON or the customer draft", async () => {
  const {client,state} = await fixture("A long reason. ".repeat(300)); state.authorized = true;
  const result = await client.request("local-run", dana);
  const message = state.posts[0]!;
  const rendered = JSON.stringify(message.blocks);
  expect(rendered).toContain("$8,400");
  expect(rendered).toContain("$12,000");
  expect(rendered).not.toContain("customer_message");
  expect(rendered).not.toContain("operation_key");
  expect(rendered).not.toContain("Requested action details");
  expect(rendered.length).toBeLessThan(2000);
  expect(message.blocks.find((b: any) => b.type === "actions").elements[0].url).toBe(result.approval.approval_url);
 });
