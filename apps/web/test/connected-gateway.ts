import { MCPClient } from "@mastra/mcp";
import { RequestContext } from "@mastra/core/request-context";
import { noopObserve } from "@mastra/core/tools";
import { join } from "node:path";
import { HooksClient } from "../lib/hooks-client";
import { parseToolResult } from "../lib/agent-runtime";
import { fixtureEvents } from "../../../scripts/seed-elastic";

/** Only the external Arcade, Elastic and Slack network boundaries are controlled.
 * The nested tools are the actual registered Python MCP servers. */
export function connectedGateway(config: { hooks: string; lead: string; directory: string; tokens: Map<string, string> }) {
  const posts: any[] = []; const calls: Array<{ name: string; actor: string; args: any; denied: boolean }> = [];
  const toolExecutions: Array<{ name: string; actor: string }> = [];
  const elasticOutputs: Array<{ actor: string; before: unknown; after: unknown }> = [];
  let rejectDecide = false;
  const clients = new Map<string, MCPClient>();
  const tokenServer = Bun.serve({ port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = await request.json() as any;
    if (path.endsWith("/auth/authorize")) {
      const token = body.auth_requirement.provider_id === "slack" ? "local-slack-token" : config.tokens.get(body.user_id);
      return token ? Response.json({ id: "local-authorization", status: "completed", context: { token } }) : Response.json({ error: "Identity has not completed real OAuth" }, { status: 401 });
    }
    if (path === "/slack/auth.test") return Response.json({ ok: true, user_id: "UATTENDEE", team_id: "TWORKSHOP" });
    if (path === "/slack/conversations.open") return Response.json({ ok: true, channel: { id: "DSELF" } });
    if (path === "/slack/chat.postMessage") { posts.push(body); return Response.json({ ok: true, channel: "DSELF", ts: "100.001" }); }
    return Response.json({ error: `Unexpected boundary: ${path}` }, { status: 404 });
  } });
  const boundary = `http://127.0.0.1:${tokenServer.port}`;
  const root = join(import.meta.dir, "../../..");
  const hook = new HooksClient(config.hooks, "hook-test");
  const definitions = {
    "Elastic.Search": { toolkit: "Elastic", name: "Search", python: null },
    "Lead.GetLead": { toolkit: "Lead", name: "GetLead", python: "Lead_GetLead" },
    "Lead.SearchLeads": { toolkit: "Lead", name: "SearchLeads", python: "Lead_SearchLeads" },
    "Lead.RouteLead": { toolkit: "Lead", name: "RouteLead", python: "Lead_RouteLead" },
    "Lead.ClassifyLead": { toolkit: "Lead", name: "ClassifyLead", python: "Lead_ClassifyLead" },
    "Approvals.RequestApproval": { toolkit: "Approvals", name: "RequestApproval", python: "Approvals_RequestApproval" },
    "Approvals.Decide": { toolkit: "Approvals", name: "Decide", python: "Approvals_Decide" },
  } as const;
  async function python(actor: string, name: string, args: any) {
    let client = clients.get(actor);
    if (!client) {
      const env = { ARCADE_USER_ID: actor, ARCADE_API_KEY: "local-test-key", ARCADE_API_URL: boundary, ARCADE_ENVIRONMENT: "test", ARCADE_WORK_DIR: config.directory, ARCADE_TELEMETRY_DISABLED: "true", HOOKS_PUBLIC_HOST: new URL(config.hooks).host, APPROVALS_SERVICE_TOKEN: "approvals-test", LEAD_APP_PUBLIC_HOST: new URL(config.lead).host, TEST_SLACK_URL: `${boundary}/slack` };
      client = new MCPClient({ id: crypto.randomUUID(), servers: {
        lead: { command: join(root, "tools/lead/.venv/bin/python"), args: [join(root, "tools/lead/server.py")], env: { ...env, PYTHONPATH: join(root, "tools/lead") } },
        approvals: { command: join(root, "tools/approvals/.venv/bin/python"), args: [join(root, "tools/approvals/tests/mcp_server.py")], env: { ...env, PYTHONPATH: join(root, "tools/approvals") } },
      } });
      clients.set(actor, client);
    }
    const toolsets = await client.listToolsets();
    const tool = Object.values(toolsets).map((tools) => tools[name]).find(Boolean);
    if (!tool?.execute) throw new Error(`Actual registered MCP tool ${name} is absent: ${Object.values(toolsets).flatMap(Object.keys)}`);
    toolExecutions.push({ name, actor });
    return tool.execute(args, { requestContext: new RequestContext(), observe: noopObserve });
  }
  async function call(name: string, args: any, actor: string) {
    const definition = definitions[name as keyof typeof definitions];
    if (!definition) throw new Error(`Unexpected tool ${name}`);
    const event = { execution_id: crypto.randomUUID(), tool: { toolkit: definition.toolkit, name: definition.name, version: "1.0.0" }, inputs: args, context: { user_id: actor } };
    const pre = await hook.request("/pre", event);
    calls.push({ name, actor, args, denied: pre.code !== "OK" });
    if (pre.code !== "OK") return pre;
    const output = definition.python ? await python(actor, definition.python, args) : { hits: fixtureEvents("governed").filter((row) => row.lead_id === "LD-2291") };
    const post = await hook.request("/post", { ...event, success: !(output as any)?.isError, output });
    if (post.code !== "OK") return post;
    if (!definition.python) elasticOutputs.push({ actor, before: output, after: post.override?.output ?? output });
    return post.override?.output ?? output;
  }
  const server = Bun.serve({ port: 0, async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const rpc = await request.json() as any;
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    const actor = request.headers.get("Arcade-User-ID") ?? "";
    try {
      let result: any;
      if (rpc.method === "initialize") result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "local-arcade", version: "1" } };
      else if (rpc.method === "tools/list") {
        const toolkits: any = {};
        for (const definition of Object.values(definitions)) ((toolkits[definition.toolkit] ??= { tools: {} }).tools)[definition.name] = [{ version: "1.0.0" }];
        const access = await hook.request("/access", { user_id: actor, toolkits });
        result = { tools: Object.entries(definitions).filter(([, d]) => access.only?.[d.toolkit]?.tools?.[d.name]?.length).map(([name]) => ({ name, description: name, inputSchema: { type: "object", additionalProperties: true } })) };
      } else if (rpc.method === "tools/call") {
        if (rejectDecide && rpc.params.name === "Approvals.Decide") return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32003, message: "Gateway rejected decision execution before the tool ran" } });
        const output = await call(rpc.params.name, rpc.params.arguments, actor);
        result = { content: [{ type: "text", text: JSON.stringify(parseToolResult(output)) }], ...((output as any)?.isError ? { isError: true } : {}) };
      } else result = {};
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
    } catch (error) { return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }); }
  } });
  return { url: `http://127.0.0.1:${server.port}`, call, calls, posts, toolExecutions, elasticOutputs, setRejectDecide(value: boolean) { rejectDecide = value; }, async close() { server.stop(true); for (const client of clients.values()) await client.disconnect(); tokenServer.stop(true); } };
}
