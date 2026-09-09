type ModelStep = { name: string; args: Record<string, unknown> } | string;
export function scriptedModel(steps: Array<ModelStep | ((input: any) => ModelStep)>, observed: unknown[] = []) {
  let position = 0;
  return { specificationVersion: "v2" as const, provider: "workshop-test", modelId: "scripted", supportedUrls: {},
    async doGenerate(input: any) {
      observed.push(input);
      const next = steps[position++];
      const step = typeof next === "function" ? next(input) : next;
      if (step === undefined) throw new Error("Scripted model exhausted");
      const exposed = typeof step === "string" ? null : input.tools.find((tool: any) => tool.name === step.name || tool.description === step.name);
      if (typeof step !== "string" && !exposed) throw new Error(`Model cannot discover ${step.name}`);
      return { content: typeof step === "string" ? [{ type: "text" as const, text: step }] : [{ type: "tool-call" as const, toolCallId: `call-${position}`, toolName: exposed.name, input: JSON.stringify(step.args) }],
        finishReason: typeof step === "string" ? "stop" as const : "tool-calls" as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, warnings: [] };
    },
    async doStream(): Promise<never> { throw new Error("Unexpected streaming model request"); },
  };
}

/** The external Arcade transport boundary, using real MCP wire messages. */
export function mcpBoundary(tools: Record<string, { schema: Record<string, unknown>; execute: (args: any, user: string) => Promise<unknown> | unknown }>, observe?: (request: { headers: Record<string, string>; rpc: unknown }) => void) {
  return Bun.serve({ port: 0, async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const rpc = await request.json() as any;
    observe?.({ headers: Object.fromEntries(request.headers), rpc });
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    let result: unknown;
    if (rpc.method === "initialize") result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "arcade-boundary", version: "1" } };
    else if (rpc.method === "tools/list") result = { tools: Object.entries(tools).map(([name, tool]) => ({ name, description: name, inputSchema: tool.schema })) };
    else if (rpc.method === "tools/call") {
      const tool = tools[rpc.params.name];
      if (!tool) return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Unknown tool" } });
      const output = await tool.execute(rpc.params.arguments, request.headers.get("Arcade-User-ID") ?? "");
      result = { content: [{ type: "text", text: JSON.stringify(output) }] };
    } else result = {};
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
  } });
}

export const discountArguments = { account_id: "ACC-2291", list_price: 12000, discount_percent: 30, rationale: "Enterprise interest documented in evt-1", operation_key: "model-forged-key" };
export const names = { discount: "Sales.CreateDiscountedOffer", getOffer: "Sales.GetOffer" };
export const objectSchema = { type: "object", additionalProperties: true };
