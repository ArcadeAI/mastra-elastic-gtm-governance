import { expect, test } from "bun:test";
import { createHooksApp } from "../apps/hooks/src/app";
import { createApp } from "../apps/lead-app/src/index";

// The gateway and OAuth provider are external boundaries. The Lead API,
// SQLite, hooks and spawned attendee CLI are the production implementations.
for (const mode of ["connected", "missing-pre", "needs-consent", "ignored-pre-decision", "ignored-post-override", "unfiltered-text-copy"]) test(`governance verification: ${mode}`, async () => {
  const omitPre = mode === "missing-pre", needsConsent = mode === "needs-consent";
  const actor = "verification@example.test";
  const idp = Bun.serve({ port: 0, fetch: () => Response.json({ email: actor }) });
  const business = createApp({ dbPath: ":memory:", idpHost: idp.url.host, internalToken: "lead-internal" });
  const lead = Bun.serve({ port: 0, fetch: business.fetch });
  const controls = createHooksApp({ dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web", leadHost: lead.url.origin, leadToken: "lead-internal", idpHost: idp.url.origin, webOrigin: "http://localhost:3000", subjectEmails: { dana: "dana@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" }, verificationUserId: actor, elasticTools: [] });
  const hooks = Bun.serve({ port: 0, fetch: controls.fetch });
  const requested: string[] = [];
  const names = { "Actual_Get": "GetAccount", "Actual_Route": "CreateDiscountedOffer" } as const;
  const gateway = Bun.serve({ port: 0, async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const rpc = await request.json() as any;
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    let result: any;
    if (rpc.method === "initialize") result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "external-gateway", version: "1" } };
    else if (rpc.method === "tools/list") result = { tools: Object.keys(names).map(name => ({ name, description: name, inputSchema: { type: "object", additionalProperties: true } })) };
    else if (rpc.method === "tools/call") {
      expect(request.headers.get("Arcade-User-ID")).toBe(actor);
      const name = names[rpc.params.name as keyof typeof names];
      const inputs = rpc.params.arguments;
      requested.push(name);
      if (needsConsent) return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ authorization_url: "https://cloud.arcade.dev/auth?id=probe", untrusted_url: "https://evil.example/auth", access_token: "SECRET_NOT_FOR_OUTPUT" }) }] } });
      const event = { execution_id: crypto.randomUUID(), tool: { toolkit: "Sales", name, version: "1" }, inputs, context: { user_id: actor } };
      const hook = async (path: string, body: unknown) => (await fetch(new URL(path, hooks.url), { method: "POST", headers: { authorization: "Bearer hook", "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<any>;
      const pre = omitPre ? { code: "OK" } : await hook("/pre", event);
      if (pre.code !== "OK" && mode !== "ignored-pre-decision") result = { isError: true, content: [{ type: "text", text: JSON.stringify(pre) }] };
      else {
        const response = name === "GetAccount" ? await fetch(new URL(`/accounts/${inputs.account_id}`, lead.url), { headers: { authorization: "Bearer setup-oauth" } }) : await fetch(new URL(`/accounts/${inputs.account_id}/offers`, lead.url), { method: "POST", headers: { authorization: "Bearer setup-oauth", "content-type": "application/json", "Idempotency-Key": inputs.operation_key }, body: JSON.stringify({ list_price: inputs.list_price, discount_percent: inputs.discount_percent, rationale: inputs.rationale }) });
        const output = await response.json();
        const post = await hook("/post", { ...event, success: response.ok, output });
        result = { isError: !response.ok, content: [{ type: "text", text: JSON.stringify(mode === "ignored-post-override" ? output : post.override?.output ?? output) }] };
        if (mode === "unfiltered-text-copy" && name === "GetAccount") result = { isError: false, structuredContent: post.override.output, content: [{ type: "text", text: JSON.stringify(output) }] };
      }
    } else result = {};
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
  } });
  async function cli(...args: string[]) {
    const child = Bun.spawn([process.execPath, "--no-env-file", "scripts/workshop.ts", ...args], { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH!, ARCADE_API_KEY: "test-key", ARCADE_MCP_URL: gateway.url.origin, WORKSHOP_VERIFICATION_USER_ID: actor, ARCADE_DISCOUNT_TOOL_NAME: "Actual_Route", HOOKS_PUBLIC_HOST: hooks.url.origin, WORKSHOP_OPERATOR_TOKEN: "operator" }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, report: JSON.parse(out), err };
  }
  try {
    expect((await cli("activate")).code).toBe(1);
    const result = await cli("verify-governance", "--read-tool", "Actual_Get");
    expect(result.code, JSON.stringify(result)).toBe(mode === "connected" ? 0 : 1);
    if (needsConsent) {
      expect(result.report.authorizationUrls).toEqual(["https://cloud.arcade.dev/auth?id=probe"]);
      expect(JSON.stringify(result.report)).not.toContain("SECRET_NOT_FOR_OUTPUT");
      expect(result.err).not.toContain("SECRET_NOT_FOR_OUTPUT");
    }
    expect(requested).toEqual(["GetAccount", "CreateDiscountedOffer"]);
    const record = await (await fetch(new URL("/accounts/ACC-2291", lead.url), { headers: { authorization: "Bearer setup-oauth" } })).json() as any;
    expect(record.decisions).toHaveLength(0);
    expect((await cli("activate")).code).toBe(mode === "connected" ? 0 : 1);
    expect(result.report.live_proof).toBe(false);
  } finally { gateway.stop(true); hooks.stop(true); controls.close(); lead.stop(true); business.close(); idp.stop(true); }
});
