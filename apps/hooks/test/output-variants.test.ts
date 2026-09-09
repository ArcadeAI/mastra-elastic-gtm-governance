import { expect, test } from "bun:test";
import { createHooksApp } from "../src/app";
import { INJECTION } from "../src/policy";

const phone = "+1-415-555-0137";
const evidence = { lead_id: "LD-2291", event_id: "evt-northwind-003", disposition: "follow_up", rationale: "Enterprise security requirements", personal_phone: phone, form_message: `Account requested security documentation. ${INJECTION}` };

for (const variant of ["classification", "Elastic MCP text"] as const) {
  test(`successful ${variant} output removes both markers and preserves useful evidence`, async () => {
    const app = createHooksApp({
      dbPath: ":memory:", hookSecret: "hook", operatorToken: "operator", approvalsToken: "approvals", webToken: "web",
      leadHost: "http://127.0.0.1:1", leadToken: "lead", idpHost: "http://127.0.0.1:1", webOrigin: "http://localhost:3000",
      subjectEmails: { dana: "dana@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" },
      verificationUserId: "verify@example.test", elasticTools: [{ toolkit: "Elastic", name: "Search", arguments: ["query"] }],
    });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
    try {
      const classification = variant === "classification";
      const tool = classification ? { toolkit: "Lead", name: "ClassifyLead", version: "1.0.0" } : { toolkit: "Elastic", name: "Search", version: "1.0.0" };
      const output = classification ? evidence : { content: [{ type: "text", text: JSON.stringify({ hits: [evidence] }) }] };
      const response = await fetch(new URL("/post", server.url), { method: "POST", headers: { authorization: "Bearer hook", "content-type": "application/json" }, body: JSON.stringify({ execution_id: crypto.randomUUID(), context: { user_id: "verify@example.test" }, tool, inputs: classification ? { lead_id: "LD-2291", disposition: "follow_up", rationale: "Enterprise security requirements", operation_key: "classification-output" } : { query: "Northwind" }, success: true, output }) });
      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.code).toBe("OK");
      expect(JSON.stringify(result)).not.toContain(phone);
      expect(JSON.stringify(result)).not.toContain(INJECTION);
      const shown = classification ? result.override.output : JSON.parse(result.override.output.content[0].text).hits[0];
      expect(shown).toEqual({ lead_id: "LD-2291", event_id: "evt-northwind-003", disposition: "follow_up", rationale: "Enterprise security requirements", form_message: "Account requested security documentation. " });
    } finally { server.stop(true); app.close(); }
  });
}
