import { Mastra } from "@mastra/core";
import type { AgentConfig } from "@mastra/core/agent";
import type { MastraCompositeStore } from "@mastra/core/storage";
import { type Tool } from "@mastra/core/tools";
import type { MCPClient } from "@mastra/mcp";
import { z } from "zod";
import { toStandardSchema } from "@mastra/core/schema";
import { createLeadAgent } from "./lead-agent";
import { HooksClient, ServiceError } from "./hooks-client";
import type { ApprovalClient, ApprovalClientResult } from "./approval-client";

export type Stage = "supplied" | "elastic" | "governed";
export type ToolNames = { discount: string; getOffer: string };
export interface RuntimeOptions {
  model?: AgentConfig["model"];
  clientFor?: (userId: string) => MCPClient;
  danaUserId?: string;
  elasticTools?: string[];
  names?: ToolNames;
  hooks?: HooksClient;
  storage?: MastraCompositeStore;
  approvals?: ApprovalClient;
}
type Action = { operation_key: string; tool_name: string; arguments: Record<string, unknown> };
type ToolMap = Record<string, Record<string, Tool<any, any, any, any>>>;
const draftText = z.string().refine(value => value.trim().length > 0);
const emailDraftSchema = z.object({ to: draftText, subject: draftText, body: draftText });

export function parseToolResult(output: unknown): any {
  if (output && typeof output === "object") {
    const value = output as any;
    if (value.structuredContent !== undefined) return value.structuredContent;
    if (Array.isArray(value.content)) {
      for (const item of value.content) if (item.type === "text" && typeof item.text === "string") {
        try { return JSON.parse(item.text); } catch { /* Other text remains available to the caller. */ }
      }
    }
  }
  return output;
}

export function authorizationLinks(output: unknown): string[] {
  const links = JSON.stringify(output)?.match(/https:\/\/[^\s"<>\\]+/g) ?? [];
  return [...new Set(links.filter((url) => {
    try { const host = new URL(url).hostname; return host === "arcade.dev" || host.endsWith(".arcade.dev"); } catch { return false; }
  }))];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

function cloneTool(tool: Tool<any, any, any, any>, execute: NonNullable<Tool<any, any, any, any>["execute"]>) {
  const copy = Object.create(Object.getPrototypeOf(tool), Object.getOwnPropertyDescriptors(tool)) as typeof tool;
  copy.execute = execute;
  return copy;
}

export function createRuntime(options: RuntimeOptions) {
  const hooks = () => {
    if (!options.hooks || !options.storage || !options.names) throw new ServiceError("Governed stage needs hooks, persistent storage, and observed tool names.", 503);
    return options.hooks;
  };
  function agent(stage: Stage) {
    const current = createLeadAgent(stage, options.model);
    if (stage !== "governed") return current;
    hooks();
    return new Mastra({ agents: { lead: current }, storage: options.storage!, logger: false }).getAgent("lead");
  }
  async function connect(userId: string, stage: Stage, requireDiscount = false) {
    if (requireDiscount && options.names?.discount && options.names.discount === options.names.getOffer) throw new ServiceError("The discount tool and saved-offer read tool names must be different. Select their exact observed names before running the agent.", 503);
    if (!options.clientFor) throw new ServiceError("Arcade gateway is not configured.", 503);
    const client = options.clientFor(userId);
    try {
      const toolsets = await client.listToolsets();
      if (requireDiscount && (!options.names?.discount || !options.names.getOffer || [options.names.discount, options.names.getOffer].some(name => !Object.values(toolsets).some(tools => tools[name]?.execute)))) throw new ServiceError("The configured discount tool or saved-offer read tool is not available to this role. Check their exact observed names and gateway permissions before running the agent.", 503);
      if (stage === "elastic") {
        if (!options.elasticTools?.length) throw new ServiceError("Configure exact observed Elastic tool names.", 503);
        const found = new Set<string>();
        for (const [server, tools] of Object.entries(toolsets)) {
          toolsets[server] = Object.fromEntries(Object.entries(tools).filter(([name]) => {
            if (!options.elasticTools!.includes(name)) return false;
            found.add(name); return true;
          }));
        }
        if (found.size !== options.elasticTools.length) throw new ServiceError("Configured Elastic tools are missing from gateway discovery.", 503);
      }
      if (!Object.values(toolsets).some((tools) => Object.keys(tools).length)) throw new ServiceError("Gateway discovery returned no tools.", 503);
      const calls = new Map<string, { name: string; args: unknown }>();
      for (const tools of Object.values(toolsets)) for (const [name, tool] of Object.entries(tools)) {
        if (!tool.execute) continue;
        const execute = tool.execute.bind(tool);
        tools[name] = cloneTool(tool, async (args, context) => {
          if (context.agent?.toolCallId) calls.set(context.agent.toolCallId, { name, args });
          return execute(args, context);
        });
      }
      return { client, toolsets, calls };
    } catch (error) { await client.disconnect(); throw error; }
  }
  function wrap(toolsets: ToolMap, runId: string, requesterId: string, existingAction?: Action, resume?: any) {
    const names = options.names!;
    let action: Action | undefined = existingAction;
    const execution: { toolsets: ToolMap; attemptedWrite: boolean; committedWrite: boolean; verifiedOffer: boolean; approval?: ApprovalClientResult } = { toolsets, attemptedWrite: false, committedWrite: false, verifiedOffer: false };
    let savedOfferId: string | undefined;
    let savedEmail: z.infer<typeof emailDraftSchema> | undefined;
    for (const tools of Object.values(toolsets)) for (const [name, tool] of Object.entries(tools)) {
      if (tool.execute && name === names.getOffer) {
        const read = tool.execute.bind(tool);
        tools[name] = cloneTool(tool, async (input, context) => {
          if (execution.committedWrite) execution.verifiedOffer = false;
          const output = await read(input, context), offer = parseToolResult(output);
          if (execution.committedWrite && action) {
            const terms = action.arguments;
            const netPrice = Math.round((Number(terms.list_price) * (100 - Number(terms.discount_percent)) / 100 + Number.EPSILON) * 100) / 100;
            const email = emailDraftSchema.safeParse(offer?.follow_up_email);
            const sameEmail = email.success && savedEmail !== undefined && email.data.to === savedEmail.to && email.data.subject === savedEmail.subject && email.data.body === savedEmail.body;
            execution.verifiedOffer = !output?.isError && !offer?.error && offer?.offer_id === savedOfferId && offer?.account_id === terms.account_id && offer?.discount_percent === terms.discount_percent && offer?.list_price === terms.list_price && offer?.net_price === netPrice && offer?.status === "draft" && sameEmail;
            if (!execution.verifiedOffer) throw new ServiceError("The offer was saved, but its read-back did not verify the exact terms and follow-up email draft.", 409);
          }
          return output;
        });
        continue;
      }
      if (!tool.execute || name !== names.discount) continue;
      const execute = tool.execute.bind(tool);
      const wrapped = cloneTool(tool, async (input, context) => {
        execution.attemptedWrite = true;
        const proposed = { ...input, operation_key: action?.operation_key ?? `run:${runId}` };
        if (action && (action.tool_name !== name || canonical(action.arguments) !== canonical(proposed))) {
          return { isError: true, error: "The proposed action differs from the original pending action. Start a new request." };
        }
        action ??= { operation_key: proposed.operation_key, tool_name: name, arguments: proposed };
        if (context.agent?.resumeData && (!resume || context.agent.resumeData.request_id !== resume.request_id || context.agent.resumeData.operation_key !== action.operation_key)) throw new Error("Approval continuation binding mismatch.");
        await hooks().request(`/internal/runs/${runId}/action`, action);
        let output: any, executionError: unknown;
        try { output = await execute(action.arguments, context); } catch (error) { executionError = error; }
        const payload = parseToolResult(output);
        execution.committedWrite = !executionError && !output?.isError && !payload?.error && payload?.account_id === action.arguments.account_id && typeof payload?.offer_id === "string";
        if (execution.committedWrite) {
          savedOfferId = payload.offer_id;
          const email = emailDraftSchema.safeParse(payload.follow_up_email);
          // Compare only the model-safe draft fields. Extra metadata never
          // participate in verification and need not survive output filtering.
          savedEmail = email.success ? email.data : undefined;
          execution.verifiedOffer = false;
        }
        if (!execution.committedWrite && !resume) {
          if (!options.approvals) throw new ServiceError("Host approvals are not configured.", 503);
          let pending: ApprovalClientResult | undefined;
          try { pending = await options.approvals.request(runId, requesterId); }
          catch (error) {
            // Hooks, not the model or an arbitrary gateway error, determines
            // whether this exact run has a live authority denial to approve.
            if (!(error instanceof ServiceError && error.status === 409)) throw error;
          }
          if (pending) {
            const request = pending.approval;
            if (request.operation_key !== action.operation_key || request.requester_id !== requesterId) throw new Error("Approval does not match this run's denied action.");
            if (!context.agent) throw new Error("Approval suspension requires an agent run.");
            execution.approval = pending;
            await hooks().request(`/internal/runs/${runId}/approval`, { request_id: request.request_id, operation_key: action.operation_key, tool_call_id: context.agent.toolCallId });
            // Consent and notification failures retain this same durable wait.
            return context.agent.suspend({ request_id: request.request_id, operation_key: action.operation_key });
          }
        }
        if (executionError) throw executionError;
        return output;
      });
      wrapped.suspendSchema = toStandardSchema(z.object({ request_id: z.string(), operation_key: z.string() }));
      wrapped.resumeSchema = wrapped.suspendSchema;
      tools[name] = wrapped;
    }
    return execution;
  }
  function publicResult(output: any, runId?: string, executed = new Map<string, { name: string; args: unknown }>()) {
    return { runId, status: output.finishReason === "suspended" ? "waiting" : "completed", text: output.text,
      finishReason: output.finishReason,
      model: { source: options.model ? "injected-model" : "configured-provider", model_id: output.response?.modelId ?? null, response_id: output.response?.id ?? null },
      toolCalls: output.toolCalls.map((call: any) => ({ name: call.payload.toolName, mcpName: executed.get(call.payload.toolCallId)?.name ?? null, args: executed.get(call.payload.toolCallId)?.args ?? call.payload.args })),
      toolResults: output.toolResults.map((result: any) => {
        const payload = parseToolResult(result.payload.result);
        const error = payload?.error_message ?? payload?.error;
        return { name: result.payload.toolName, isError: result.payload.isError, authorizationUrls: authorizationLinks(result.payload.result), notificationStatus: payload?.notification_status, error: error === undefined ? null : (typeof error === "string" ? error : JSON.stringify(error)).slice(0, 4000) };
      }),
      authorizationUrls: authorizationLinks(output.toolResults),
      pending: output.suspendPayload?.suspendPayload ?? null };
  }
  return {
    async start(input: { stage: Stage; message: string; userId?: string; signal?: AbortSignal }) {
      if (input.stage === "supplied") return publicResult(await agent(input.stage).generate(input.message, { maxSteps: 1, ...(input.signal ? { abortSignal: input.signal } : {}) }));
      const userId = input.stage === "elastic" ? options.danaUserId : input.userId;
      if (!userId) throw new ServiceError("The stage's gateway identity is not configured or signed in.", 401);
      const { client, toolsets, calls } = await connect(userId, input.stage, input.stage === "governed");
      const runId = crypto.randomUUID();
      let created = false;
      try {
        if (input.stage === "governed") { await hooks().request("/internal/runs", { run_id: runId, requester_user_id: userId, stage: input.stage, message: input.message }); created = true; }
        const execution = input.stage === "governed" ? wrap(toolsets, runId, userId) : undefined;
        const output = await agent(input.stage).generate(input.message, {
          toolsets: execution?.toolsets ?? toolsets,
          runId, maxSteps: 12, toolCallConcurrency: 1, autoResumeSuspendedTools: false,
          ...(input.signal ? { abortSignal: input.signal } : {}),
          modelSettings: { temperature: 0, maxOutputTokens: 1800 },
        });
        const result = publicResult(output, input.stage === "governed" ? runId : undefined, calls);
        if (input.stage === "governed") {
          if (execution?.approval) result.authorizationUrls = [...new Set([...result.authorizationUrls, ...execution.approval.authorizationUrls])];
          let persisted;
          if (result.status === "waiting") persisted = await hooks().request(`/internal/runs/${runId}/suspended`, { tool_call_id: output.suspendPayload?.toolCallId, text: result.text, tool_calls: result.toolCalls, model: result.model });
          else {
            const failed = result.authorizationUrls.length > 0 || (execution!.attemptedWrite && (!execution!.committedWrite || !execution!.verifiedOffer));
            if (failed) result.status = "failed";
            persisted = await hooks().request(`/internal/runs/${runId}/result`, { status: result.status, text: result.text, tool_calls: result.toolCalls, model: result.model, ...(failed ? { error: execution!.committedWrite ? "The offer was saved, but GetOffer did not verify its terms and follow-up email draft. Inspect the saved offer before starting another exercise." : "The pending action did not complete. Finish required authorization or inspect delivery status, then start a new exercise." } : {}) });
          }
          // The control plane owns display filtering. Keep canonical action
          // arguments private and return its stored display copy to the browser.
          return { ...result, error: persisted.run.error, text: persisted.run.text, toolCalls: persisted.run.tool_calls, ...(execution?.approval ? { approval: execution.approval.approval } : {}) };
        }
        return result;
      } catch (error) {
        if (input.stage === "governed") {
          if (!created) throw error;
          // Running failures release the exercise slot. An awaiting snapshot stays
          // associated for explicit recovery because /result refuses that state.
          if (created) await hooks().request(`/internal/runs/${runId}/result`, { status: "failed", text: "", tool_calls: [], error: "Agent execution failed before completion." }).catch(() => undefined);
          throw new ServiceError(error instanceof Error ? error.message : "Agent failed", 502, { run_id: runId });
        }
        throw error;
      } finally { await client.disconnect(); }
    },
    async resume(runId: string, actor: string) {
      const claim = await hooks().request(`/internal/runs/${runId}/resume`, { actor_user_id: actor });
      if (!claim.lease_id) return claim.run;
      const { client, toolsets, calls } = await connect(claim.run.requester_user_id, "governed", true);
      try {
        const execution = wrap(toolsets, runId, claim.run.requester_user_id, claim.action, claim.approval);
        const output = await agent("governed").resumeGenerate({ request_id: claim.approval.request_id, operation_key: claim.action.operation_key }, {
          runId, toolCallId: claim.run.tool_call_id,
          toolsets: execution.toolsets, maxSteps: 8, toolCallConcurrency: 1, autoResumeSuspendedTools: false,
        });
        const result = publicResult(output, runId, calls);
        const failed = result.status !== "completed" || !execution.committedWrite || !execution.verifiedOffer;
        if (failed) result.status = "failed";
        const persisted = await hooks().request(`/internal/runs/${runId}/result`, { lease_id: claim.lease_id, status: result.status, text: result.text, tool_calls: result.toolCalls, model: result.model, ...(failed ? { error: execution.committedWrite ? "The offer was saved, but GetOffer did not verify its terms and follow-up email draft. Inspect the saved offer before starting another exercise." : "The approved action did not complete. Inspect authorization and the operation receipt before retrying." } : {}) });
        return { ...result, error: persisted.run.error, text: persisted.run.text, toolCalls: persisted.run.tool_calls };
      } finally { await client.disconnect(); }
    },
    async close(runId: string, actor: string) {
      const result = await hooks().request(`/internal/runs/${runId}/close`, { actor_user_id: actor });
      const workflows = await options.storage!.getStore("workflows");
      await workflows?.deleteWorkflowRunById({ workflowName: "agentic-loop", runId });
      return result;
    },
    async tools(stage: Stage, actor?: string) {
      if (stage === "supplied") return [];
      const userId = stage === "elastic" ? options.danaUserId : actor;
      if (!userId) throw new ServiceError("Sign in to discover governed tools.", 401);
      const { client, toolsets } = await connect(userId, stage);
      try { return Object.values(toolsets).flatMap((tools) => Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description }))); }
      finally { await client.disconnect(); }
    },
  };
}
