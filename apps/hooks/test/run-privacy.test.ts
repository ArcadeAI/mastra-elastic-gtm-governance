import { expect, test } from "bun:test";
import { createHooksApp } from "../src/app";

test("run reads and stored traces apply tool-scoped output restrictions", async () => {
  const lead = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => new URL(request.url).pathname.startsWith("/internal/operations/") ? new Response("Missing", { status: 404 }) : Response.json({ account_id: "ACC-2291", list_price: 12000 }) });
  const actor = "dana@example.test";
  const app = createHooksApp({ dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web", leadToken: "lead", leadHost: lead.url.origin, idpHost: lead.url.origin, webOrigin: "http://localhost:3000", subjectEmails: { dana: actor, riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" }, verificationUserId: "verify@example.test", elasticTools: [] });
  async function call(path: string, token: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const response = await app.fetch(new Request(`http://localhost${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    expect(response.status).toBe(200);
    return response.json() as Promise<any>;
  }
  try {
    const hook = { execution_id: "verify", context: { user_id: "verify@example.test" }, tool: { toolkit: "Sales", name: "CreateDiscountedOffer", version: "1.0.0" }, inputs: { account_id: "ACC-2291", discount_percent: 30, list_price: 12000, customer_message: "Your renewal is approaching. The SCIM support issue remains unresolved.", rationale: "Fit", operation_key: "verify" } };
    await call("/operator/verification", "operator", { operation_key: hook.inputs.operation_key });
    await call("/pre", "hook", hook);
    await call("/post", "hook", { ...hook, execution_id: "verify-filter", success: true, output: { personal_phone: "+1-415-555-0137" } });
    await call("/operator/verification/confirm", "operator", { operation_key: hook.inputs.operation_key, denial_execution_id: hook.execution_id, filter_execution_id: "verify-filter" });
    await call("/operator/activate", "operator", {});
    await call("/internal/runs", "web", { run_id: "privacy", requester_user_id: actor, stage: "governed", message: "Research" });
    await call("/internal/runs/privacy/result", "web", { status: "completed", text: "Finished", tool_calls: [{ mcpName: "Sales.CreateDiscountedOffer", name: "Sales_CreateDiscountedOffer", args: { rationale: "Enterprise SOURCE_SECRET", account_id: "ACC-2291" } }] });
    const doc = await call("/operator/policy", "operator");
    doc.output_rules.push({ ...doc.output_rules[0], id: "route-only-secret", match: { toolkit: "Sales", tool: "CreateDiscountedOffer" }, fields: [], patterns: [{ id: "secret", regex: "SOURCE_SECRET", strategy: "remove" }] });
    await call("/operator/policy", "operator", doc, "PUT");
    const shown = await call(`/internal/runs/privacy?viewer_user_id=${actor}`, "web");
    expect(JSON.stringify(shown)).not.toContain("SOURCE_SECRET");
    expect(shown.run.tool_calls[0].args.rationale).toContain("Enterprise");
    expect(shown.run.tool_calls[0].args.account_id).toBe("ACC-2291");
    const evidence = await call("/operator/runs/privacy/evidence", "operator");
    expect(JSON.stringify(evidence)).not.toContain("SOURCE_SECRET");
    await call("/internal/runs", "web", { run_id: "privacy-write", requester_user_id: actor, stage: "governed", message: "Research" });
    const stored = await call("/internal/runs/privacy-write/result", "web", { status: "completed", text: "SOURCE_SECRET", tool_calls: [{ mcpName: "Sales.CreateDiscountedOffer", args: { rationale: "Enterprise SOURCE_SECRET" } }] });
    expect(JSON.stringify(stored)).not.toContain("SOURCE_SECRET");
  } finally { app.close(); lead.stop(true); }
});
