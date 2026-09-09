import { expect, test } from "bun:test";
import { createHooksApp } from "../src/app";
import { INJECTION } from "../src/policy";

const phone = "+1-415-555-0137", token = "workshop_activation_FAKE_northwind_trial";
const terms = { account_id: "ACC-2291", event_id: "evt-northwind-003", discount_percent: 30, list_price: 12000, net_price: 8400, status: "draft", rationale: "Annual commitment supports these terms" };
const evidence = { ...terms, personal_phone: phone, provisioning: { activation_token: "field-only-sensitive-value", status: "trial" }, activation_email: { to: "buyer@example.test", subject: "Your annual offer", body: `Review your offer: ${token}`, activation_token: token }, form_message: `Account requested security documentation. ${INJECTION}` };

for (const variant of ["discount offer", "Elastic MCP text"] as const) {
  test(`successful ${variant} output removes activation credentials and preserves offer terms`, async () => {
    const app = createHooksApp({
      dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web",
      leadHost: "http://127.0.0.1:1", leadToken: "lead", idpHost: "http://127.0.0.1:1", webOrigin: "http://localhost:3000",
      subjectEmails: { dana: "dana@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" },
      verificationUserId: "verify@example.test", elasticTools: [{ toolkit: "Elastic", name: "Search", arguments: ["query"] }],
    });
    try {
      const offer = variant === "discount offer";
      const tool = offer ? { toolkit: "Sales", name: "CreateDiscountedOffer", version: "1.0.0" } : { toolkit: "Elastic", name: "Search", version: "1.0.0" };
      const output = offer ? evidence : { content: [{ type: "text", text: JSON.stringify({ hits: [evidence] }) }] };
      const response = await app.fetch(new Request("http://localhost/post", { method: "POST", headers: { authorization: "Bearer hook", "content-type": "application/json" }, body: JSON.stringify({ execution_id: crypto.randomUUID(), context: { user_id: "verify@example.test" }, tool, inputs: offer ? { account_id: terms.account_id, discount_percent: 30, list_price: 12000, rationale: terms.rationale, operation_key: "discount-output" } : { query: "Northwind" }, success: true, output }) }));
      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.code).toBe("OK");
      for (const marker of [phone, token, "activation_token", "field-only-sensitive-value", INJECTION]) expect(JSON.stringify(result)).not.toContain(marker);
      const shown = offer ? result.override.output : JSON.parse(result.override.output.content[0].text).hits[0];
      expect(shown).toEqual({ ...terms, provisioning: { status: "trial" }, activation_email: { to: "buyer@example.test", subject: "Your annual offer", body: "Review your offer: " }, form_message: "Account requested security documentation. " });
    } finally { app.close(); }
  });
}
