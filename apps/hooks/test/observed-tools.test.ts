import { afterEach, expect, test } from "bun:test";
import { createHooksApp } from "../src/app";

const apps: ReturnType<typeof createHooksApp>[] = [];
afterEach(() => { while (apps.length) apps.pop()!.close(); });

function fixture() {
  const app = createHooksApp({ dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web", leadToken: "lead", leadHost: "http://localhost:1", idpHost: "http://localhost:1", webOrigin: "http://localhost:3000", subjectEmails: { dana: "dana@example.test", sam: "sam@example.test", riley: "riley@example.test", morgan: "morgan@example.test" }, verificationUserId: "verify@example.test", elasticTools: [] });
  apps.push(app);
  return async (path: string, token: string, body?: unknown) => {
    const response = await app.fetch(new Request(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    return { status: response.status, body: await response.json() as any };
  };
}
const unknownSearch = { execution_id: "elastic-local-execution", tool: { toolkit: "Remote_Elastic", name: "Observed.Search", version: "1.0.0" }, inputs: { query: "PRIVATE_QUERY", index: "PRIVATE_INDEX", options: { token: "PRIVATE_INPUT_TOKEN" } }, context: { user_id: "verify@example.test", authorization: [{ provider_id: "elastic", oauth2: { access_token: "PRIVATE_OAUTH_TOKEN" } }] } };

test("unknown Elastic calls remain denied while exposing only observed names and argument keys", async () => {
  const call = fixture();
  const denied = await call("/pre", "hook", unknownSearch);
  expect(denied.status).toBe(200);
  expect(denied.body.code).toBe("CHECK_FAILED");
  const catalogue = await call("/operator/observed-tools", "operator");
  expect(catalogue.status).toBe(200);
  expect(catalogue.body).toEqual({ tools: [{ toolkit: "Remote_Elastic", name: "Observed.Search", arguments: ["index", "options", "query"] }] });
  expect(JSON.stringify(catalogue.body)).not.toContain("PRIVATE_");
  expect(JSON.stringify(catalogue.body)).not.toContain("verify@example.test");
});

test("access metadata adds deterministically sorted names without guessing arguments", async () => {
  const call = fixture();
  const access = await call("/access", "hook", { user_id: "verify@example.test", toolkits: {
    "A.B": { tools: { C: [{ version: "1.0.0", metadata: { extras: { token: "PRIVATE_METADATA" } } }] } },
    ZElastic: { tools: { Search: [{ version: "1.0.0" }] } },
    A: { tools: { "B.C": [{ version: "1.0.0" }] } },
  } });
  expect(access.status).toBe(200);
  expect(access.body.only).toEqual({});
  expect((await call("/operator/observed-tools", "operator")).body).toEqual({ tools: [
    { toolkit: "A", name: "B.C", arguments: [] },
    { toolkit: "A.B", name: "C", arguments: [] },
    { toolkit: "ZElastic", name: "Search", arguments: [] },
  ] });
});

test("denied post callbacks merge only top-level argument keys with earlier observations", async () => {
  const call = fixture();
  await call("/pre", "hook", unknownSearch);
  const post = await call("/post", "hook", { ...unknownSearch, inputs: { query: "PRIVATE_NEXT_QUERY", limit: 5 }, success: true, output: { personal_phone: "PRIVATE_OUTPUT_PHONE", token: "PRIVATE_OUTPUT_TOKEN" } });
  expect(post.status).toBe(403);
  await call("/access", "hook", { user_id: "verify@example.test", toolkits: { Remote_Elastic: { tools: { "Observed.Search": [{ version: "2.0.0" }] } } } });
  const catalogue = await call("/operator/observed-tools", "operator");
  expect(catalogue.body).toEqual({ tools: [{ toolkit: "Remote_Elastic", name: "Observed.Search", arguments: ["index", "limit", "options", "query"] }] });
  expect(JSON.stringify(catalogue.body)).not.toContain("PRIVATE_");
});

test.each(["/access", "/pre", "/post"])("unauthenticated %s callbacks cannot add observed metadata", async (path) => {
  const call = fixture();
  const body = path === "/access" ? { user_id: "verify@example.test", toolkits: { Remote_Elastic: { tools: { "Observed.Search": [{ version: "1.0.0" }] } } } } : unknownSearch;
  expect((await call(path, "wrong", body)).status).toBe(401);
  expect((await call("/operator/observed-tools", "operator")).body).toEqual({ tools: [] });
});

test("the observed catalog is operator-only and reset clears it", async () => {
  const call = fixture();
  await call("/pre", "hook", unknownSearch);
  for (const token of ["hook", "web", "approvals", "wrong"]) {
    const denied = await call("/operator/observed-tools", token);
    expect(denied.status).toBe(401);
    expect(JSON.stringify(denied.body)).not.toContain("Remote_Elastic");
  }
  expect((await call("/operator/observed-tools", "operator")).body.tools).toHaveLength(1);
  expect((await call("/operator/reset", "operator", {})).status).toBe(200);
  expect((await call("/operator/observed-tools", "operator")).body).toEqual({ tools: [] });
});

test("invalid callback structure is rejected before any observation is saved", async () => {
  const call = fixture();
  for (const path of ["/pre", "/post"]) expect((await call(path, "hook", { ...unknownSearch, inputs: [] })).status).toBe(400);
  expect((await call("/access", "hook", { user_id: "verify@example.test", toolkits: { Remote_Elastic: { tools: { "Observed.Search": "invalid-version-list" } } } })).status).toBe(400);
  expect((await call("/operator/observed-tools", "operator")).body).toEqual({ tools: [] });
});
