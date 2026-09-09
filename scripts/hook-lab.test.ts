import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHooksApp } from "../apps/hooks/src/app";
import accounts from "../apps/lead-app/src/fixtures/accounts.json";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function cli(args: string[], config: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "scripts/workshop.ts", "hook-lab", ...args], { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH!, ...config }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(out + err).not.toContain("workshop_support_FAKE_northwind_003");
  expect(out + err).not.toContain("oncall@northwindrobotics.example");
  expect(out + err).not.toContain("operator-secret");
  return { code, out, err, result: JSON.parse(out) };
}
async function ruleFile() {
  const dir = await mkdtemp(join(tmpdir(), "hook-lab-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "rule.json");
  const result = await cli(["init", "--output", file]);
  expect(result.code, result.out + result.err).toBe(0);
  const rule = JSON.parse(await readFile(file, "utf8"));
  expect(rule).toMatchObject({ id: "renewal-contact-redaction", match: { toolkit: "Sales", tool: "GetAccount" }, fields: [] });
  return { file, rule, save: (value: any) => writeFile(file, JSON.stringify(value)) };
}
test("starter fails until attendee adds the scoped field removal; unrelated destructive rules fail", async () => {
  const { file, rule, save } = await ruleFile();
  expect((await cli(["test", "--file", file])).code).toBe(1);
  for (const path of ["support.owner_email", "support", "list_price"]) {
    await save({ ...rule, fields: [{ path, strategy: "remove" }] });
    expect((await cli(["test", "--file", file])).code).toBe(1);
  }
  await save({ ...rule, priority: 0, fields: [{ path: "support.internal_owner_email", strategy: "remove" }, { path: "billing_contact.email", strategy: "replace", replacement: accounts.accounts[0]!.billing_contact.email }] });
  expect((await cli(["test", "--file", file])).code).toBe(1);
  await save({ ...rule, fields: [{ path: "support.internal_owner_email", strategy: "remove" }] });
  const passed = await cli(["test", "--file", file]);
  expect(passed.code, passed.out).toBe(0);
  expect(passed.result).toMatchObject({ status: "passed", proof_scope: "local_fixture", live_proof: false });
});
test("apply preserves live authority and baseline, is idempotent, and rejects a failing candidate before contacting hooks", async () => {
  const { file, rule, save } = await ruleFile();
  const app = createHooksApp({ dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator-secret", approvalsToken: "approvals", webToken: "web", leadHost: "http://127.0.0.1:1", leadToken: "lead", idpHost: "http://127.0.0.1:1", webOrigin: "http://localhost:3000", subjectEmails: { dana: "dana@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" }, verificationUserId: "verify@example.test", elasticTools: [] });
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { requests.push(request.method); return app.fetch(request); } });
  cleanups.push(() => { server.stop(true); app.close(); });
  const config = { HOOKS_PUBLIC_HOST: server.url.origin, WORKSHOP_OPERATOR_TOKEN: "operator-secret" };
  expect((await cli(["apply", "--file", file], config)).code).toBe(1);
  expect(requests).toEqual([]);
  const policy = async () => await (await app.fetch(new Request("http://localhost/operator/policy", { headers: { authorization: "Bearer operator-secret" } }))).json() as any;
  const before = await policy();
  await save({ ...rule, fields: [{ path: "support.internal_owner_email", strategy: "remove" }] });
  const applied = await cli(["apply", "--file", file], config);
  expect(applied.code, applied.out).toBe(0);
  const after = await policy();
  expect(after.subjects).toEqual(before.subjects);
  expect(after.rules).toEqual(before.rules);
  expect(after.output_rules.filter((r: any) => r.id !== rule.id)).toEqual(before.output_rules);
  expect(after.version).toBe(before.version + 1);
  expect(after.active).toBe(before.active);
  expect((await cli(["apply", "--file", file], config)).code).toBe(0);
  expect((await policy()).version).toBe(after.version);
  expect(requests.filter(method => method === "PUT")).toHaveLength(1);
});
test.each(["valid", "owner-present", "missing-support", "wrong-terms", "error", "no-result", "hidden-leak", "hidden-phone", "metadata-phone"])("gateway verification checks an actual observed read as Dana: %s", async variant => {
  const account: any = structuredClone(accounts.accounts[0]);
  delete account.support.api_key;
  delete account.support.internal_owner_email;
  delete account.billing_contact.personal_phone;
  if (variant === "owner-present") account.support.internal_owner_email = "oncall@northwindrobotics.example";
  if (variant === "missing-support") delete account.support.summary;
  if (variant === "wrong-terms") account.list_price = 1;
  const calls: any[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    expect(request.headers.get("arcade-user-id")).toBe("dana@example.test");
    const body = await request.json() as any;
    if (body.id === undefined) return new Response(null, { status: 202 });
    let result: any;
    if (body.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "local", version: "1" } };
    if (body.method === "tools/list") result = { tools: [{ name: "Observed_GetAccount", description: "Observed account read", inputSchema: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"] } }] };
    if (body.method === "tools/call") {
      calls.push(body.params);
      result = variant === "error" ? { isError: true, content: [{ type: "text", text: "Upstream private failure" }] } : variant === "no-result" ? { content: [] } : { structuredContent: account, content: [{ type: "text", text: JSON.stringify(variant === "hidden-leak" ? { ...account, private: "workshop_support_FAKE_northwind_003" } : variant === "hidden-phone" ? { ...account, note: "+1-415-555-0137" } : account) }], ...(variant === "metadata-phone" ? { _meta: { note: "+1-415-555-0137" } } : {}) };
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  } });
  cleanups.push(() => { server.stop(true); });
  const config = { ARCADE_MCP_URL: server.url.origin, ARCADE_API_KEY: "local-test-key", PERSONA_DANA_EMAIL: "dana@example.test" };
  const unobserved = await cli(["verify", "--read-tool", "Guessed_GetAccount"], config);
  expect(unobserved.code).toBe(1);
  expect(calls).toHaveLength(0);
  const result = await cli(["verify", "--read-tool", "Observed_GetAccount"], config);
  expect(result.code, result.out + result.err).toBe(variant === "valid" ? 0 : 1);
  expect(calls).toEqual([{ name: "Observed_GetAccount", arguments: { account_id: "ACC-2291" } }]);
  if (variant === "valid") expect(result.result).toMatchObject({ status: "passed", proof_scope: "gateway_read", connection_scope: "local", live_proof: false });
}, 15000);
