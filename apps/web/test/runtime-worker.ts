import { LibSQLStore } from "@mastra/libsql";
import { MCPClient } from "@mastra/mcp";
import { createRuntime } from "../lib/agent-runtime";
import { HooksClient } from "../lib/hooks-client";
import { createApprovalClient } from "../lib/approval-client";
import { names, discountArguments, scriptedModel } from "./helpers";

const [phase, db, gateway, hooks, runId] = process.argv.slice(2);
const steps = phase === "start" ? [
  { name: "Elastic.Search", args: { query: "Northwind" } },
  { name: names.discount, args: discountArguments },
  "The host should pause this denied write.",
] : [{ name: names.getOffer, args: { account_id: "ACC-2291" } }, "Saved and checked the 30% offer for ACC-2291 at $8400 yearly. Evidence: evt-1."];
const storage = new LibSQLStore({ id: "restart-proof", url: db! });
const approvals = createApprovalClient({ hooksHost: hooks!, serviceToken: "web-test-token", arcadeKey: "local-key", arcadeBaseUrl: hooks!, slackBaseUrl: `${hooks}/slack` });
const runtime = createRuntime({ approvals, model: scriptedModel(steps), names, storage,
  hooks: new HooksClient(hooks!, "web-test-token"),
  clientFor: (userId) => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(gateway!), allowedHosts: [new URL(gateway!).host], requestInit: { headers: { "Arcade-User-ID": userId } } } } }),
});
const result = phase === "start" ? await runtime.start({ stage: "governed", message: "Research Northwind and prepare its 30% offer", userId: "dana@example.test" }) : await runtime.resume(runId!, "riley@example.test");
console.log(`RESULT ${JSON.stringify(result)}`);
await storage.close();
