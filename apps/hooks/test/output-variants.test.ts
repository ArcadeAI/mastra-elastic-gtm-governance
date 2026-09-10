import { expect, test } from "bun:test";
import { createHooksApp } from "../src/app";
import { INJECTION, filterOutput } from "../src/policy";

const phone = "+1-415-555-0137", token = "workshop_support_FAKE_northwind_003";
const terms = { account_id: "ACC-2291", event_id: "evt-northwind-003", discount_percent: 30, list_price: 12000, net_price: 8400, status: "draft", rationale: "Annual commitment supports these terms" };
const support = { case_id: "CS-1042", status: "open", summary: "SCIM deprovisioning is delayed and remains unresolved.", internal_owner_email: "oncall@northwindrobotics.example" };
const evidence = { ...terms, support: { ...support, api_key: "field-only-support-secret" }, personal_phone: phone, provisioning: { activation_token: "field-only-sensitive-value", status: "trial" }, follow_up_email: { to: "buyer@example.test", subject: "Your annual offer", body: `Review your offer: ${token}`, activation_token: token }, form_message: `Account requested security documentation. ${INJECTION}` };

for (const variant of ["discount offer", "Elastic MCP text", "Elastic document"] as const) {
  test(`successful ${variant} output removes support and legacy activation credentials and preserves offer terms`, async () => {
    const app = createHooksApp({
      dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web",
      leadHost: "http://127.0.0.1:1", leadToken: "lead", idpHost: "http://127.0.0.1:1", webOrigin: "http://localhost:3000",
      subjectEmails: { dana: "dana@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" },
      verificationUserId: "verify@example.test", elasticTools: [{ toolkit: "Elastic", name: "Search", arguments: ["query"] }],
    });
    try {
      const offer = variant === "discount offer";
      const tool = offer ? { toolkit: "Sales", name: "CreateDiscountedOffer", version: "1.0.0" } : { toolkit: "Elastic", name: "Search", version: "1.0.0" };
      const document = { results: [{ type: "resource", data: { reference: { id: "evt-northwind-003", index: "gtm-account-context" }, partial: false, content: evidence }, tool_result_id: "native-result" }] };
      const payload = variant === "Elastic document" ? document : { hits: [evidence] };
      const output = offer ? evidence : { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
      const response = await app.fetch(new Request("http://localhost/post", { method: "POST", headers: { authorization: "Bearer hook", "content-type": "application/json" }, body: JSON.stringify({ execution_id: crypto.randomUUID(), context: { user_id: "verify@example.test" }, tool, inputs: offer ? { account_id: terms.account_id, discount_percent: 30, list_price: 12000, customer_message: "Your renewal is approaching. The SCIM support issue remains unresolved.", rationale: terms.rationale, operation_key: "discount-output" } : { query: "Northwind" }, success: true, output }) }));
      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.code).toBe("OK");
      for (const marker of [phone, token, "api_key", "field-only-support-secret", "activation_token", "field-only-sensitive-value", INJECTION]) expect(JSON.stringify(result)).not.toContain(marker);
      const shown = offer ? result.override.output : (variant === "Elastic document" ? JSON.parse(result.override.output.content[0].text).results[0].data.content : JSON.parse(result.override.output.content[0].text).hits[0]);
      expect(shown).toEqual({ ...terms, support, provisioning: { status: "trial" }, follow_up_email: { to: "buyer@example.test", subject: "Your annual offer", body: "Review your offer: " }, form_message: "Account requested security documentation. " });
    } finally { app.close(); }
  });
}


test("Elastic document support does not admit embedded MCP resources or media", () => {
  const subject = { user_id: "dana@example.test" } as any;
  const tool = { toolkit: "Elastic", name: "Search" };
  for (const value of [
    { type: "resource", resource: { uri: "file:///secret", text: token } },
    { type: "resource", data: { reference: { id: "x", index: "gtm-account-context" }, partial: false, content: { media: { type: "image", data: "opaque" } } } },
    { type: "resource", data: { reference: { id: "x", index: "gtm-account-context" }, partial: false, content: {}, blob: "opaque" } },
  ]) expect(() => filterOutput(value, [], subject, tool)).toThrow("Unsupported output media");
});
