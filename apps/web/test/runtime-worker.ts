import { LibSQLStore } from "@mastra/libsql";
import { MCPClient } from "@mastra/mcp";
import { createRuntime } from "../lib/agent-runtime";
import { HooksClient } from "../lib/hooks-client";
import { names, routeArguments, scriptedModel } from "./helpers";

const [phase, db, gateway, hooks, runId] = process.argv.slice(2);
const steps = phase === "start" ? [
  { name: "Elastic.Search", args: { query: "Northwind" } },
  { name: names.route, args: routeArguments },
  { name: names.requestApproval, args: { denial_id: "denial-1", justification: "Enterprise evidence" } },
] : [{ name: names.route, args: routeArguments }, "Routed LD-2291. Evidence: evt-1."];
const storage = new LibSQLStore({ id: "restart-proof", url: db! });
const runtime = createRuntime({ model: scriptedModel(steps), names, storage,
  hooks: new HooksClient(hooks!, "web-test-token"),
  clientFor: (userId) => new MCPClient({ id: crypto.randomUUID(), servers: { arcade: { url: new URL(gateway!), allowedHosts: [new URL(gateway!).host], requestInit: { headers: { "Arcade-User-ID": userId } } } } }),
});
const result = phase === "start" ? await runtime.start({ stage: "governed", message: "Research and route Northwind", userId: "dana@example.test" }) : await runtime.resume(runId!, "riley@example.test");
console.log(`RESULT ${JSON.stringify(result)}`);
await storage.close();
