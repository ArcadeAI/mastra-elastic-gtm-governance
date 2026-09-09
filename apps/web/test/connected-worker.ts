import { readFileSync, writeFileSync } from "node:fs";
import { LibSQLStore } from "@mastra/libsql";
import { MCPClient } from "@mastra/mcp";
import { createRuntime } from "../lib/agent-runtime";
import { createWebApp } from "../lib/web-app";
import { HooksClient } from "../lib/hooks-client";
import { resetSnapshots } from "../lib/snapshot-reset";
import { names, scriptedModel } from "./helpers";
import { GOVERNED_PHONE, GOVERNED_INSTRUCTION } from "../../../scripts/seed-elastic";

const config = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const storage = new LibSQLStore({ id: "connected-proof", url: config.db });
const hooks = new HooksClient(config.hooks, "web-test");
const action = { lead_id: "LD-2291", estimated_acv: 95000, owner_email: config.emails.riley, rationale: `Enterprise qualification supported by evt-northwind-001 and evt-northwind-003 ${config.privateMarker ?? ""}`.trim(), operation_key: "untrusted-model-key" };
const observed: any[] = [];
const steps = config.phase === "start" ? [
  { name: "Elastic.Search", args: { query: "Northwind Robotics" } },
  { name: "Lead.GetLead", args: { lead_id: "LD-2291" } },
  (input: any) => {
    const offered = input.tools.map((tool: any) => tool.description).sort();
    const expected = ["Elastic.Search", "Lead.SearchLeads", "Lead.GetLead", names.route, names.classify, names.requestApproval].sort();
    if (JSON.stringify(offered) !== JSON.stringify(expected)) throw new Error(`Unexpected governed model toolset: ${JSON.stringify(offered)}`);
    const data = JSON.stringify(input.prompt);
    if (data.includes(GOVERNED_PHONE) || data.includes(GOVERNED_INSTRUCTION)) throw new Error("Unfiltered governed Elastic fixture reached the model");
    for (const id of ["evt-northwind-001", "evt-northwind-002", "evt-northwind-003", "evt-northwind-004"]) if (!data.includes(id)) throw new Error(`Governed evidence ${id} was lost before the model`);
    if (!data.includes("evt-northwind-001") || !data.includes("184 preview deployments")) throw new Error("Real evidence was lost before the model");
    writeFileSync(config.proof, JSON.stringify({ filtered_model_observation: true, source_id: "evt-northwind-001", offered_tools: offered }));
    return { name: names.route, args: action };
  },
  (input: any) => {
    // Find the actual opaque denial in the real hook result, not a minted fixture.
    function denial(value: any): string | undefined {
      if (typeof value === "string") { try { return denial(JSON.parse(value)); } catch { return value.match(/denial_id="([^"]+)"/)?.[1]; } }
      if (value && typeof value === "object") for (const item of Object.values(value)) { const found = denial(item); if (found) return found; }
    }
    const denialId = denial(input.prompt);
    if (!denialId) throw new Error("The model did not receive the approval remediation");
    return { name: names.requestApproval, args: { denial_id: denialId, justification: "Account evidence supports enterprise qualification." } };
  },
] : [{ name: names.route, args: action }, (input: any) => {
  const prompt = JSON.stringify(input.prompt);
  if (!prompt.includes("evt-northwind-001") || !prompt.includes("184 preview deployments")) throw new Error("Native snapshot did not restore original evidence context");
  return `Routed LD-2291 to Riley after approval. Evidence: evt-northwind-001 (184 preview deployments), evt-northwind-003 (enterprise security requirements). ${config.privateMarker ?? ""}`.trim();
}];
const runtime = createRuntime({ model: scriptedModel(steps, observed), hooks, storage, names,
  clientFor: (userId) => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(config.gateway), allowedHosts: [new URL(config.gateway).host], requestInit: { headers: { "Arcade-User-ID": userId } } } } }),
});
const app = createWebApp({ runtime: () => runtime, hooks: () => hooks, session: () => config.session, arcadeKey: () => "local-key", operatorToken: () => "operator-test", resetSnapshots: (epoch) => resetSnapshots(storage, new HooksClient(config.hooks, "operator-test"), epoch) });
const server = Bun.serve({ port: config.port, idleTimeout: 120, fetch: app.fetch });
console.log(`READY ${server.port}`);
process.on("SIGTERM", async () => { server.stop(true); await storage.close(); process.exit(0); });
