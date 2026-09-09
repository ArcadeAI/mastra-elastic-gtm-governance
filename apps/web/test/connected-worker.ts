import { readFileSync, writeFileSync } from "node:fs";
import { LibSQLStore } from "@mastra/libsql";
import { MCPClient } from "@mastra/mcp";
import { createRuntime, parseToolResult } from "../lib/agent-runtime";
import { createWebApp } from "../lib/web-app";
import { HooksClient } from "../lib/hooks-client";
import { createApprovalClient } from "../lib/approval-client";
import { resetSnapshots } from "../lib/snapshot-reset";
import { names, scriptedModel } from "./helpers";
import { GOVERNED_PHONE, GOVERNED_INSTRUCTION } from "../../../scripts/seed-elastic";

const config = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const storage = new LibSQLStore({ id: "connected-proof", url: config.db });
const hooks = new HooksClient(config.hooks, "web-test");
const action = { account_id: "ACC-2291", list_price: 12000, discount_percent: 30, rationale: `Enterprise qualification supported by evt-northwind-001 and evt-northwind-003 ${config.privateMarker ?? ""}`.trim(), operation_key: "untrusted-model-key" };
const observed: any[] = [];
function latestToolResult(input: any, mcpName: string) {
  const exposed = input.tools.find((tool: any) => tool.description === mcpName);
  const result = input.prompt.filter((message: any) => message.role === "tool").flatMap((message: any) => message.content).filter((part: any) => part.type === "tool-result" && part.toolName === exposed?.name).at(-1);
  if (!result) throw new Error(`The model did not receive an actual ${mcpName} result`);
  return parseToolResult(result.output.value);
}
const steps = config.phase === "start" ? [
  { name: "Elastic.Search", args: { query: "Northwind Robotics" } },
  { name: "Sales.GetAccount", args: { account_id: "ACC-2291" } },
  (input: any) => {
    const offered = input.tools.map((tool: any) => tool.description).sort();
    const expected = ["Elastic.Search", "Sales.SearchAccounts", "Sales.GetAccount", names.discount, "Sales.GetOffer"].sort();
    if (JSON.stringify(offered) !== JSON.stringify(expected)) throw new Error(`Unexpected governed model toolset: ${JSON.stringify(offered)}`);
    const data = JSON.stringify(input.prompt);
    if (data.includes(GOVERNED_PHONE) || data.includes(GOVERNED_INSTRUCTION) || data.includes("workshop_activation_FAKE_") || data.includes("activation_token")) throw new Error("Unfiltered fixture data reached the model");
    for (const id of ["evt-northwind-001", "evt-northwind-002", "evt-northwind-003", "evt-northwind-004"]) if (!data.includes(id)) throw new Error(`Governed evidence ${id} was lost before the model`);
    if (!data.includes("evt-northwind-001") || !data.includes("85000 successful sign-ins")) throw new Error("Real evidence was lost before the model");
    writeFileSync(config.proof, JSON.stringify({ filtered_model_observation: true, source_id: "evt-northwind-001", offered_tools: offered }));
    return { name: names.discount, args: action };
  },
  (input: any) => {
    if (!JSON.stringify(input.prompt).includes("Sales service unavailable")) throw new Error("The denied write should have suspended before another model step");
    return "The Sales service is unavailable; the draft was not saved.";
  },
] : [(input: any) => {
  const prompt = JSON.stringify(input.prompt);
  if (!prompt.includes("evt-northwind-001") || !prompt.includes("85000 successful sign-ins")) throw new Error("Native snapshot did not restore original evidence context");
  if (prompt.includes("workshop_activation_FAKE_") || prompt.includes("activation_token")) throw new Error("Offer creation leaked an activation token to the model");
  if (!prompt.includes('8400')) throw new Error("Approved offer terms were lost");
  return { name: names.getOffer, args: { account_id: "ACC-2291" } };
}, (input: any) => {
  const offer = latestToolResult(input, names.getOffer);
  const created = latestToolResult(input, names.discount);
  const readback = JSON.stringify(offer);
  if (readback.includes("workshop_activation_FAKE_") || readback.includes("activation_token")) throw new Error("GetOffer leaked an activation token to the model");
  if (offer.account_id !== "ACC-2291" || typeof offer.offer_id !== "string" || offer.offer_id !== created.offer_id || offer.discount_percent !== 30 || offer.list_price !== 12000 || offer.net_price !== 8400 || offer.status !== "draft") throw new Error("GetOffer did not return the exact saved offer terms");
  if (offer.activation_email?.to !== "elena@northwindrobotics.example" || !offer.activation_email?.subject?.includes("Northwind Robotics") || !offer.activation_email?.body?.includes("not sent")) throw new Error("GetOffer lost the saved activation-email draft");
  for (const field of ["to", "subject", "body"]) if (offer.activation_email[field] !== created.activation_email?.[field]) throw new Error(`GetOffer changed the saved email ${field}`);
  return `Saved and checked ${offer.account_id} offer ${offer.offer_id} and activation-email draft to ${offer.activation_email.to}: ${offer.discount_percent}% off $${offer.list_price.toLocaleString("en-US")}, $${offer.net_price.toLocaleString("en-US")} annually. No email sent. Evidence: evt-northwind-001 (85000 successful sign-ins), evt-northwind-003 (budget request). ${config.privateMarker ?? ""}`.trim();
}];
const approvals = createApprovalClient({ hooksHost: config.hooks, serviceToken: "approvals-test", arcadeKey: "local-key", arcadeBaseUrl: config.boundary, slackBaseUrl: `${config.boundary}/slack` });
const runtime = createRuntime({ approvals, model: scriptedModel(steps, observed), hooks, storage, names,
  clientFor: (userId) => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(config.gateway), allowedHosts: [new URL(config.gateway).host], requestInit: { headers: { "Arcade-User-ID": userId } } } } }),
});
const app = createWebApp({ runtime: () => runtime, approvals: () => approvals, hooks: () => hooks, session: () => config.session, arcadeKey: () => "local-key", operatorToken: () => "operator-test", resetSnapshots: (epoch) => resetSnapshots(storage, new HooksClient(config.hooks, "operator-test"), epoch) });
const server = Bun.serve({ port: config.port, idleTimeout: 120, fetch: app.fetch });
console.log(`READY ${server.port}`);
process.on("SIGTERM", async () => { server.stop(true); await storage.close(); process.exit(0); });
