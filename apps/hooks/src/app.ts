import { createHash, timingSafeEqual } from "node:crypto";
import { AccessHookRequest, Grant, PostHookRequest, PreHookRequest } from "@cg/policy-schema";
import { attestGrantValidated, evaluatePermission, resolveVisibility, routeApproval, type ToolRef } from "@cg/governance-core";
import { baseline, baseUrl, catalogue, filterOutput, validatePolicy, type HooksConfig, type PolicyDocument } from "./policy";
import { canonical, Store } from "./store";

type Inputs = Record<string, unknown>;
type Denial = { id: string; requester: string; tool: ToolRef; inputs: Inputs; value: number; execution_id: string; expires_at: number; request_id: string | null };
type Approval = { id: string; denial_id: string; requester_id: string; approver_id: string; candidate_approver_ids: string[]; tool: ToolRef; inputs: Inputs; required_clearance: number; status: "pending" | "approved" | "denied" | "expired"; justification: string; note: string | null; expires_at: number; grant_id: string | null; decided_at: string | null; notification_status: "pending" | "sending" | "sent" | "failed" | "uncertain"; claim_id: string | null; slack_user_id?: string; slack_team_id?: string; channel?: string; ts?: string; notification_error?: string };
type SavedGrant = { grant: Grant; value: number; claimed_operation: string | null };
type Action = { operation_key: string; tool_name: string; arguments: Inputs };
type ModelEvidence = { source: "configured-provider" | "injected-model"; model_id: string | null; response_id: string | null };
type Run = { run_id: string; requester_user_id: string; stage: "governed"; status: "running" | "awaiting_snapshot" | "waiting" | "resuming" | "completed" | "failed"; message: string; request_id: string | null; operation_key: string | null; tool_call_id: string | null; action: Action | null; text: string; error: string | null; tool_calls: unknown[]; lease_id: string | null; lease_until: number | null; created_at: string; resumed_at: string | null; model?: ModelEvidence | null };
type Receipt = { operation_key: string; actor: string; action: string; account_id: string; body: Inputs; completed_at: string };
type State = { active: boolean; verified_denial: boolean; verified_filter: boolean; reset_epoch: number };
type Verification = { operation_key: string; prior_filter_id: string | null; policy_version: number; reset_epoch: number; confirmed: boolean };
type ObservedTool = { toolkit: string; name: string; arguments: string[] };
const activeStatuses = new Set(["running", "awaiting_snapshot", "waiting", "resuming"]);
const keyPattern = /^[A-Za-z0-9._:-]{1,128}$/;
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function requireThat(value: unknown, status: number, message: string): asserts value { if (!value) throw new HttpError(status, message); }
function string(value: unknown, name: string): string { requireThat(typeof value === "string" && value.length > 0 && value.length <= 10000, 400, `${name} must be a nonempty string.`); return value; }
function object(value: unknown): Inputs { requireThat(value !== null && typeof value === "object" && !Array.isArray(value), 400, "Expected a JSON object."); return value as Inputs; }
function modelEvidence(value: unknown): ModelEvidence | null {
  if (value === undefined || value === null) return null;
  const model = object(value);
  requireThat(Object.keys(model).every(key => ["source", "model_id", "response_id"].includes(key)), 400, "Unexpected model evidence fields.");
  requireThat(model.source === "configured-provider" || model.source === "injected-model", 400, "Unknown model evidence source.");
  for (const field of ["model_id", "response_id"]) requireThat(model[field] === null || (typeof model[field] === "string" && model[field].length > 0 && model[field].length <= 256), 400, "Model evidence identifiers must be null or bounded strings.");
  return { source: model.source, model_id: model.model_id as string | null, response_id: model.response_id as string | null };
}

export function createHooksApp(config: HooksConfig) {
  const secrets = [config.hookSecret, config.operatorToken, config.approvalsToken, config.webToken, config.leadToken];
  requireThat(secrets.every(Boolean) && new Set(secrets).size === secrets.length, 500, "Distinct hook, operator, approvals, web and lead credentials are required.");
  const store = new Store(config.dbPath), clock = config.now ?? Date.now;
  const iso = () => new Date(clock()).toISOString();
  const salesToolkit = config.salesToolkit ?? "Sales";
  const qualified = (tool: ToolRef) => `${tool.toolkit}.${tool.name}`;
  const initial = baseline(config);
  if (!store.get("policy", "current")) store.transaction(() => { store.put("policy", "current", initial); store.put("state", "current", { active: false, verified_denial: false, verified_filter: false, reset_epoch: 0 }); });
  const policy = () => validatePolicy(store.get<PolicyDocument>("policy", "current"), config);
  const state = () => { const value = store.get<State>("state", "current")!; return { ...value, reset_epoch: value.reset_epoch ?? 0 }; };
  const subject = (id: string) => policy().doc.subjects.find(s => s.user_id === id) ?? null;
  function safe(value: unknown, actor: string, tool: ToolRef = { toolkit: salesToolkit, name: "GetAccount" }) {
    return filterOutput(value, policy().doc.output_rules, subject(actor) ?? initial.subjects[0]!, tool);
  }
  function authentication(req: Request, secret: string) {
    const actual = Buffer.from(req.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${secret}`);
    requireThat(actual.length === expected.length && timingSafeEqual(actual, expected), 401, "A valid service bearer is required.");
  }
  function observeTool(tool: ToolRef, inputs: Inputs = {}) {
    // Metadata comes from parsed, authenticated gateway callbacks. Record it
    // before policy checks so an unconfigured remote tool can be identified.
    // Values, authorization, actor identity and output never enter this record.
    const id = JSON.stringify([tool.toolkit, tool.name]);
    store.transaction(() => {
      const previous = store.get<ObservedTool>("observed_tool", id);
      store.put("observed_tool", id, { toolkit: tool.toolkit, name: tool.name, arguments: [...new Set([...(previous?.arguments ?? []), ...Object.keys(inputs)])].sort() } satisfies ObservedTool);
    });
  }
  function normalizedTool(name: string): string {
    const map = config.mcpToolNames;
    if (map?.discount && name === map.discount) return `${salesToolkit}.CreateDiscountedOffer`;
    return name;
  }
  function currentRun(actor: string) { return store.all<Run>("run").find(r => r.requester_user_id === actor && activeStatuses.has(r.status)) ?? null; }
  function audit(actor: string, tool: ToolRef, decision: string, details: Inputs, executionId = "") {
    store.event(currentRun(actor)?.run_id ?? null, { id: crypto.randomUUID(), ts: iso(), user_id: actor, tool: qualified(tool), decision, execution_id: executionId, ...safe(details, actor, tool) as Inputs });
  }
  function getApproval(id: string) {
    const request = store.get<Approval>("approval", id);
    requireThat(request, 404, "Approval not found.");
    if (request.status === "pending" && request.expires_at <= clock()) { request.status = "expired"; store.put("approval", id, request); }
    return request;
  }
  function publicApproval(request: Approval) {
    return {
      request_id: request.id, requester_id: request.requester_id, approver_id: request.approver_id,
      requester_name: subject(request.requester_id)?.display_name ?? request.requester_id,
      approver_name: subject(request.approver_id)?.display_name ?? request.approver_id,
      operation_key: request.inputs.operation_key, tool_name: qualified(request.tool), inputs: safe(request.inputs, request.requester_id, request.tool),
      resource_id: request.inputs.account_id, required_clearance: request.required_clearance,
      status: request.status, notification_status: request.notification_status,
      approval_url: `${config.webOrigin.replace(/\/+$/, "")}/approvals/${encodeURIComponent(request.id)}`,
      grant_id: request.grant_id, expires_at: new Date(request.expires_at).toISOString(), decided_at: request.decided_at,
      channel: request.channel ?? null, ts: request.ts ?? null, notification_error: request.notification_error ?? null,
    };
  }
  function readRun(id: string) { const run = store.get<Run>("run", id); requireThat(run, 404, "Run not found."); return run; }
  function canView(run: Run, actor: string) { return run.requester_user_id === actor || (run.request_id && getApproval(run.request_id).approver_id === actor); }
  // Run displays combine multiple tools. Apply this actor's output restrictions
  // conservatively across the display; canonical action arguments stay private.
  function safeRunDisplay(value: unknown, actor: string) {
    const rules = policy().doc.output_rules.map(rule => ({ ...rule, match: { toolkit: "*", tool: "*" } }));
    return filterOutput(value, rules, subject(actor) ?? initial.subjects[0]!, { toolkit: salesToolkit, name: "GetAccount" });
  }
  function publicRun(run: Run) { const { lease_id: _lease, lease_until: _until, action: _action, ...view } = run; return safeRunDisplay({ ...view, resumed_at: view.resumed_at ?? null }, run.requester_user_id); }
  function safeTrace(value: unknown, actor: string): unknown[] {
    requireThat(Array.isArray(value), 400, "tool_calls must be an array.");
    const attested = value.map(entry => {
      const { arguments_hash: _supplied, ...call } = object(entry);
      // Only the authenticated web owner submits raw tool arguments. Attest
      // those arguments before display filtering; never accept a caller's hash.
      return { ...call, ...(Object.hasOwn(call, "args") ? { arguments_hash: createHash("sha256").update(canonical(call.args)).digest("hex") } : {}) };
    });
    return safeRunDisplay(attested, actor) as unknown[];
  }
  async function lead(path: string): Promise<Response> {
    try { return await fetch(`${baseUrl(config.leadHost)}${path}`, { headers: { authorization: `Bearer ${config.leadToken}` }, signal: AbortSignal.timeout(8000) }); }
    catch { throw new HttpError(503, "Sales service could not be reached."); }
  }
  async function currentValue(id: string) {
    const response = await lead(`/internal/accounts/${encodeURIComponent(id)}/value`);
    requireThat(response.ok, 503, "Authoritative value could not be read.");
    const result = object(await response.json());
    requireThat(result.account_id === id && typeof result.list_price === "number" && Number.isFinite(result.list_price) && result.list_price >= 0, 503, "Invalid authoritative value response.");
    return result.list_price;
  }
  async function receipt(key: string): Promise<Receipt | null> {
    const response = await lead(`/internal/operations/${encodeURIComponent(key)}`);
    if (response.status === 404) return null;
    requireThat(response.ok, 503, "Operation receipt could not be read.");
    return await response.json() as Receipt;
  }
  function actionBody(inputs: Inputs) { return { discount_percent: inputs.discount_percent, list_price: inputs.list_price, rationale: inputs.rationale, customer_message: inputs.customer_message }; }
  function exactReceipt(saved: Receipt, inputs: Inputs, actor: string) { return saved.operation_key === inputs.operation_key && saved.actor === actor && saved.account_id === inputs.account_id && saved.action === "discount" && canonical(saved.body) === canonical(actionBody(inputs)); }
  function deny(actor: string, tool: ToolRef, reason: string, executionId: string) { audit(actor, tool, "deny", { hook: "pre", reason }, executionId); return { code: "CHECK_FAILED", error_message: reason }; }
  function stageAllows(actor: string, tool: ToolRef) { return state().active || actor === config.verificationUserId || config.elasticTools.some(t => t.toolkit === tool.toolkit && t.name === tool.name); }
  async function pre(raw: unknown) {
    const request = PreHookRequest.parse(raw), actor = request.context.user_id ?? "", tool = request.tool, inputs = request.inputs;
    observeTool(tool, inputs);
    let person = subject(actor), { compiled } = policy();
    if (!person || !stageAllows(actor, tool)) return deny(actor, tool, "This identity or stage cannot use this tool. Do not retry.", request.execution_id);
    if (request.context.authorization?.some(a => a.provider_id === "cg-idp" && a.oauth2?.user_info?.email && a.oauth2.user_info.email !== actor)) return deny(actor, tool, "OAuth identity does not match the requester. Do not retry.", request.execution_id);
    const visibility = resolveVisibility(person, [tool], compiled)[0]!;
    if (visibility.decision.effect === "deny") return deny(actor, tool, visibility.decision.reason, request.execution_id);
    const write = tool.toolkit === salesToolkit && tool.name === "CreateDiscountedOffer";
    let value: number | null = null;
    if (write) {
      if (Object.keys(inputs).some(key => !["account_id", "discount_percent", "list_price", "rationale", "customer_message", "operation_key"].includes(key))) return deny(actor, tool, "Unexpected offer arguments. Email draft recipients are determined by the account. Do not retry.", request.execution_id);
      if (typeof inputs.operation_key !== "string" || !keyPattern.test(inputs.operation_key) || typeof inputs.account_id !== "string") return deny(actor, tool, "A valid operation_key and account_id are required. Do not retry.", request.execution_id);
      if (typeof inputs.customer_message !== "string" || !inputs.customer_message.trim() || inputs.customer_message.length > 4000) return deny(actor, tool, "A nonblank customer_message of at most 4000 characters is required. Do not retry.", request.execution_id);
      const existing = await receipt(inputs.operation_key);
      person = subject(actor); compiled = policy().compiled;
      if (!person || !stageAllows(actor, tool)) return deny(actor, tool, "This identity or stage cannot use this tool. Do not retry.", request.execution_id);
      const currentVisibility = resolveVisibility(person, [tool], compiled)[0]!;
      if (currentVisibility.decision.effect === "deny") return deny(actor, tool, currentVisibility.decision.reason, request.execution_id);
      if (existing) {
        if (!exactReceipt(existing, inputs, actor)) return deny(actor, tool, "Operation key conflicts with a completed action. Do not retry.", request.execution_id);
        audit(actor, tool, "allow", { hook: "pre", reason: "Exact completed operation replay.", operation_key: inputs.operation_key }, request.execution_id);
        return { code: "OK" };
      }
      const run = currentRun(actor);
      if (run?.action && run.action.operation_key === inputs.operation_key && (normalizedTool(run.action.tool_name) !== qualified(tool) || canonical(run.action.arguments) !== canonical(inputs))) return deny(actor, tool, "The saved run action cannot change. Do not retry.", request.execution_id);
      const bound = store.all<SavedGrant>("grant").find(g => g.grant.pinned_inputs.operation_key === inputs.operation_key);
      if (bound && (bound.grant.subject_id !== actor || qualified({ toolkit: bound.grant.match.toolkit, name: bound.grant.match.tool }) !== qualified(tool) || canonical(bound.grant.pinned_inputs) !== canonical(inputs))) return deny(actor, tool, "Approval does not bind this action. Do not retry.", request.execution_id);
      if (tool.name === "CreateDiscountedOffer") {
        const price = await currentValue(inputs.account_id);
        person = subject(actor); compiled = policy().compiled;
        if (!person || !stageAllows(actor, tool)) return deny(actor, tool, "This identity or stage cannot use this tool. Do not retry.", request.execution_id);
        const currentVisibility = resolveVisibility(person, [tool], compiled)[0]!;
        if (currentVisibility.decision.effect === "deny") return deny(actor, tool, currentVisibility.decision.reason, request.execution_id);
        if (inputs.list_price !== price) return deny(actor, tool, "Asserted list price differs from the authoritative value. Do not retry.", request.execution_id);
        if (typeof inputs.discount_percent !== "number" || !Number.isFinite(inputs.discount_percent) || inputs.discount_percent < 0 || inputs.discount_percent > 100) return deny(actor, tool, "Discount percentage must be between 0 and 100. Do not retry.", request.execution_id);
        value = inputs.discount_percent;
      }
    }
    let decision = evaluatePermission({ subject: person, tool, inputs, policy: compiled });
    if (decision.effect === "deny" && decision.rule_id === "authority-limit" && value !== null) {
      const match = store.all<SavedGrant>("grant").find(g => g.grant.subject_id === actor && g.grant.match.toolkit === tool.toolkit && g.grant.match.tool === tool.name && canonical(g.grant.pinned_inputs) === canonical(inputs));
      if (match) {
        const grant = match.grant, approver = subject(grant.granted_by), approval = getApproval(grant.request_id);
        const valid = grant.granted_by !== actor && grant.revoked_at === null && Date.parse(grant.expires_at) > clock() && match.value === value && approver?.attributes.can_approve === true && approver.clearance >= value && approval.status === "approved" && grant.resource_id === inputs.account_id && (match.claimed_operation === inputs.operation_key || (match.claimed_operation === null && (grant.uses_remaining ?? 1) > 0));
        if (!valid) return deny(actor, tool, "Approval is expired, consumed, or no longer matches current authority. Do not retry.", request.execution_id);
        store.transaction(() => { const current = store.get<SavedGrant>("grant", grant.id)!; requireThat(current.claimed_operation === null || current.claimed_operation === inputs.operation_key, 409, "Grant is already claimed."); current.claimed_operation = string(inputs.operation_key, "operation_key"); current.grant.uses_remaining = 0; store.put("grant", grant.id, current); });
        decision = evaluatePermission({ subject: person, tool, inputs, policy: compiled, grants: [attestGrantValidated(grant)] });
      } else {
        let denial = store.all<Denial>("denial").find(d => d.requester === actor && qualified(d.tool) === qualified(tool) && d.value === value && canonical(d.inputs) === canonical(inputs) && d.expires_at > clock());
        if (!denial) { denial = { id: crypto.randomUUID(), requester: actor, tool, inputs, value, execution_id: request.execution_id, expires_at: clock() + 15 * 60_000, request_id: null }; store.put("denial", denial.id, denial); }
        if (actor === config.verificationUserId) { const s = state(); s.verified_denial = true; store.put("state", "current", s); }
        return deny(actor, tool, `This discount exceeds your authority. The workshop will request human review of this exact action (denial_id="${denial.id}"). Wait for approval before retrying.`, request.execution_id);
      }
    }
    if (decision.effect === "deny") return deny(actor, tool, decision.reason, request.execution_id);
    audit(actor, tool, "allow", { hook: "pre", reason: decision.reason, operation_key: inputs.operation_key ?? null }, request.execution_id);
    return { code: "OK" };
  }
  function post(raw: unknown) {
    const request = PostHookRequest.parse(raw), actor = request.context.user_id ?? "";
    observeTool(request.tool, request.inputs);
    const person = subject(actor);
    requireThat(person && stageAllows(actor, request.tool), 403, "Unknown identity or inactive tool.");
    requireThat(Boolean(catalogue(config)[request.tool.toolkit]?.[request.tool.name]), 403, "Unknown tool.");
    try {
      const filtered = filterOutput(request.output, policy().doc.output_rules, person, request.tool), changed = canonical(request.output) !== canonical(filtered);
      audit(actor, request.tool, changed ? "modify" : "allow", { hook: "post", after: filtered, reason: changed ? "Output policy removed restricted fixture content." : "Output inspected.", success: request.success !== false }, request.execution_id);
      if (actor === config.verificationUserId && changed && request.success !== false) { const s = state(); s.verified_filter = true; store.put("state", "current", s); store.put("verification", "filter", { execution_id: request.execution_id }); }
      return { code: "OK", override: { output: filtered } };
    } catch {
      audit(actor, request.tool, "deny", { hook: "post", reason: "Output could not be safely inspected." }, request.execution_id);
      return { code: "CHECK_FAILED", error_message: "Output could not be safely inspected. Do not retry." };
    }
  }
  function access(raw: unknown) {
    const request = AccessHookRequest.parse(raw);
    for (const [toolkit, group] of Object.entries(request.toolkits)) for (const name of Object.keys(group.tools ?? {})) observeTool({ toolkit, name });
    const person = subject(request.user_id), { compiled } = policy();
    const only: AccessHookRequest["toolkits"] = {};
    for (const [toolkit, group] of Object.entries(request.toolkits)) for (const [name, versions] of Object.entries(group.tools ?? {})) { const tool = { toolkit, name }; if (person && stageAllows(person.user_id, tool) && resolveVisibility(person, [tool], compiled)[0]?.decision.effect === "allow") ((only[toolkit] ??= { tools: {} }).tools ??= {})[name] = versions; }
    return { only };
  }
  function requestApproval(body: Inputs) {
    const requester = string(body.requester_id, "requester_id"), justification = string(body.justification, "justification");
    return store.transaction(() => {
      let id: string;
      if (body.run_id !== undefined) {
        const run = readRun(string(body.run_id, "run_id"));
        requireThat(run.requester_user_id === requester, 403, "Run belongs to another requester.");
        requireThat(["running", "awaiting_snapshot", "waiting"].includes(run.status) && run.action, 409, "Run has no pending action.");
        const denied = store.all<Denial>("denial").find(d => d.requester === requester && d.expires_at > clock() && qualified(d.tool) === normalizedTool(run.action!.tool_name) && canonical(d.inputs) === canonical(run.action!.arguments));
        requireThat(denied, 409, "This action has no matching live authority denial.");
        id = denied.id;
      } else id = string(body.denial_id, "denial_id");
      const denial = store.get<Denial>("denial", id);
      requireThat(denial, 404, "Denial not found."); requireThat(denial.requester === requester, 403, "Denial belongs to another requester."); requireThat(denial.expires_at > clock(), 410, "Denial expired.");
      if (denial.request_id) return publicApproval(getApproval(denial.request_id));
      const routed = routeApproval(denial.value, requester, policy().doc.subjects.filter(s => s.attributes.can_approve === true));
      requireThat(routed.outcome === "routed", 409, "No eligible approver.");
      const request: Approval = { id: crypto.randomUUID(), denial_id: id, requester_id: requester, approver_id: routed.approver.user_id, candidate_approver_ids: routed.candidates.map(s => s.user_id), tool: denial.tool, inputs: denial.inputs, required_clearance: denial.value, status: "pending", justification, note: null, expires_at: denial.expires_at, grant_id: null, decided_at: null, notification_status: "pending", claim_id: null };
      denial.request_id = request.id; store.put("denial", id, denial); store.put("approval", request.id, request);
      audit(requester, denial.tool, "approval_requested", { request_id: request.id, approver_id: request.approver_id, candidate_approver_ids: request.candidate_approver_ids, operation_key: denial.inputs.operation_key });
      return publicApproval(request);
    });
  }
  function notification(id: string, action: string, body: Inputs) {
    return store.transaction(() => {
      const request = getApproval(id);
      requireThat(request.requester_id === body.requester_id, 403, "Only the requester can deliver this request.");
      if (action === "claim") {
        requireThat(config.soloSlackDelivery === true, 409, "Explicit solo Slack delivery mapping is not configured.");
        const user = string(body.slack_user_id, "slack_user_id"), team = string(body.slack_team_id, "slack_team_id");
        requireThat(!config.allowedSlackTeamId || config.allowedSlackTeamId === team, 403, "Slack account belongs to a different workshop workspace.");
        requireThat(request.status === "pending", 409, "Request is no longer pending.");
        if (["sending", "sent", "uncertain"].includes(request.notification_status)) return { claim_id: null, notification_status: request.notification_status };
        request.slack_user_id = user; request.slack_team_id = team; request.claim_id = crypto.randomUUID(); request.notification_status = "sending"; store.put("approval", id, request);
        return { claim_id: request.claim_id, notification_status: request.notification_status };
      }
      requireThat(action === "result" && request.claim_id !== null && request.claim_id === body.claim_id, 409, "Notification claim does not match.");
      requireThat(["sent", "failed", "uncertain"].includes(String(body.outcome)), 400, "Invalid notification outcome.");
      if (request.notification_status !== "sending") { requireThat(request.notification_status === body.outcome && (body.outcome !== "sent" || (request.channel === body.channel && request.ts === body.ts)), 409, "Notification result conflicts with the saved acknowledgement."); return publicApproval(request); }
      request.notification_status = body.outcome as Approval["notification_status"];
      if (body.outcome === "sent") { request.channel = string(body.channel, "channel"); request.ts = string(body.ts, "ts"); }
      if (body.error) request.notification_error = String(safe(string(body.error, "error"), request.requester_id)).slice(0, 500);
      store.put("approval", id, request);
      audit(request.requester_id, request.tool, "notification", { request_id: id, status: request.notification_status, channel: request.channel ?? null, ts: request.ts ?? null });
      return publicApproval(request);
    });
  }
  async function decide(id: string, body: Inputs, token: string | null) {
    const actor = string(body.actor_id, "actor_id"); requireThat(token, 401, "An IdP actor token is required.");
    let response: Response;
    try { response = await fetch(`${baseUrl(config.idpHost)}/oauth2/userinfo`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }); } catch { throw new HttpError(503, "Identity provider could not be reached."); }
    requireThat(response.ok, 401, "Identity provider rejected the actor token."); const identity = object(await response.json()); requireThat(identity.email === actor, 403, "Verified identity does not match the decision actor.");
    requireThat(body.decision === "approve" || body.decision === "deny", 400, "Decision must be approve or deny.");
    const before = getApproval(id); requireThat(actor === before.approver_id && actor !== before.requester_id, 403, "Only the assigned approver can decide; requester self-votes are forbidden.");
    const price = await currentValue(string(before.inputs.account_id, "account_id"));
    const value = before.inputs.discount_percent;
    requireThat(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100, 409, "Request has an invalid discount percentage.");
    return store.transaction(() => {
      const request = getApproval(id), approver = subject(actor), wanted = body.decision === "approve" ? "approved" : "denied";
      if (request.status !== "pending") { requireThat(request.status === wanted, 409, "Request already has a different or expired decision."); return publicApproval(request); }
      requireThat(approver?.attributes.can_approve === true && approver.clearance >= value && value === request.required_clearance && price === request.inputs.list_price, 403, "Current authority or account list price no longer matches this request.");
      requireThat(request.notification_status === "sent", 409, "Complete Slack delivery before deciding this workshop request.");
      request.status = wanted; request.decided_at = iso(); request.note = body.note == null ? null : string(body.note, "note");
      if (wanted === "approved") { const grant = Grant.parse({ id: crypto.randomUUID(), subject_id: request.requester_id, granted_by: actor, request_id: id, match: { toolkit: request.tool.toolkit, tool: request.tool.name }, resource_id: request.inputs.account_id, pinned_inputs: request.inputs, ceiling: null, issued_at: iso(), expires_at: new Date(request.expires_at).toISOString(), uses_remaining: 1, revoked_at: null }); request.grant_id = grant.id; store.put("grant", grant.id, { grant, value, claimed_operation: null } satisfies SavedGrant); }
      store.put("approval", id, request); audit(request.requester_id, request.tool, wanted, { request_id: id, grant_id: request.grant_id, approver_id: actor, verified_subject: identity.sub ?? actor, operation_key: request.inputs.operation_key });
      return publicApproval(request);
    });
  }
  function runs(id: string, operation: string, body: Inputs) {
    return store.transaction(() => {
      const run = readRun(id);
      if (operation === "action") {
        requireThat(run.status === "running" || run.status === "resuming", 409, "Run cannot record a write in this state.");
        const next: Action = { operation_key: string(body.operation_key, "operation_key"), tool_name: string(body.tool_name, "tool_name"), arguments: object(body.arguments) };
        requireThat(keyPattern.test(next.operation_key) && next.arguments.operation_key === next.operation_key, 400, "Operation key must match the exact action.");
        requireThat(normalizedTool(next.tool_name) === `${salesToolkit}.CreateDiscountedOffer`, 400, "Action tool is not configured.");
        requireThat(!run.action || canonical(run.action) === canonical(next), 409, "The run's attempted action cannot change.");
        requireThat(!store.all<Run>("run").some(r => r.run_id !== id && r.operation_key === next.operation_key), 409, "Operation belongs to another run."); run.action = next; run.operation_key = next.operation_key;
      } else if (operation === "approval") {
        requireThat(run.status === "running" || run.status === "awaiting_snapshot", 409, "Run cannot bind an approval in this state."); const request = getApproval(string(body.request_id, "request_id"));
        requireThat(run.action && run.requester_user_id === request.requester_id && body.operation_key === run.operation_key && request.inputs.operation_key === run.operation_key && normalizedTool(run.action.tool_name) === qualified(request.tool) && canonical(run.action.arguments) === canonical(request.inputs), 409, "Approval does not match the run's exact denied action.");
        requireThat(!store.all<Run>("run").some(r => r.run_id !== id && r.request_id === request.id), 409, "Approval already belongs to another run."); run.request_id = request.id; run.tool_call_id = string(body.tool_call_id, "tool_call_id"); run.status = "awaiting_snapshot";
      } else if (operation === "suspended") {
        requireThat(run.status === "awaiting_snapshot" && run.tool_call_id === body.tool_call_id && run.request_id, 409, "No matching suspension is being persisted.");
        run.text = typeof body.text === "string" ? String(safeRunDisplay(body.text, run.requester_user_id)) : "";
        run.tool_calls = safeTrace(body.tool_calls ?? [], run.requester_user_id);
        run.model = modelEvidence(body.model);
        run.status = "waiting";
      } else if (operation === "resume") {
        const actor = string(body.actor_user_id, "actor_user_id"); requireThat(canView(run, actor), 403, "Run is not visible to this actor.");
        if (run.status === "completed") return { lease_id: null, run: publicRun(run), approval: null, action: null };
        requireThat(run.status === "waiting" && run.request_id && run.action, 409, run.status === "resuming" ? "Run already resuming; a lost lease requires operator recovery." : "Run is not ready to resume.");
        const approval = getApproval(run.request_id); requireThat(approval.status === "approved" && approval.notification_status === "sent" && approval.expires_at > clock(), 409, "Approval is pending, undelivered, denied or expired.");
        run.status = "resuming"; run.lease_id = crypto.randomUUID(); run.lease_until = clock() + 5 * 60_000; store.put("run", id, run);
        return { lease_id: run.lease_id, run: publicRun(run), approval: publicApproval(approval), action: run.action };
      } else if (operation === "result") {
        requireThat(body.status === "completed" || body.status === "failed", 400, "Invalid terminal run status.");
        const resumed = run.status === "resuming";
        if (resumed) requireThat(run.lease_id === body.lease_id && run.lease_until! > clock(), 409, "Resume lease is missing, stale or expired."); else requireThat(run.status === "running" && !body.lease_id, 409, "Run cannot accept an initial result in this state.");
        const trace = safeTrace(body.tool_calls ?? [], run.requester_user_id);
        const model = modelEvidence(body.model);
        run.status = body.status; run.text = typeof body.text === "string" ? String(safeRunDisplay(body.text, run.requester_user_id)) : ""; run.error = typeof body.error === "string" ? String(safeRunDisplay(body.error, run.requester_user_id)) : null;
        run.tool_calls = resumed ? [...run.tool_calls, ...trace] : trace;
        run.model = model;
        if (resumed) run.resumed_at = iso();
      } else if (operation === "close") {
        const actor = string(body.actor_user_id, "actor_user_id"); requireThat(canView(run, actor), 403, "Run is not visible to this actor."); const request = run.request_id ? getApproval(run.request_id) : null;
        requireThat(run.status !== "completed", 409, "A completed run cannot be closed or changed.");
        const rejected = request && (request.status === "denied" || request.status === "expired" || request.expires_at <= clock()), deliveryFailed = actor === run.requester_user_id && request && request.notification_status !== "sent";
        requireThat(run.status !== "resuming" && (run.status === "failed" || rejected || deliveryFailed), 409, "Only a failed or rejected wait can be closed; active resume cannot be interrupted."); run.status = "failed"; run.error = "Exercise closed without resuming its pending action.";
      } else throw new HttpError(404, "Unknown run operation.");
      store.put("run", id, run); return { run: publicRun(run) };
    });
  }
  async function handle(req: Request): Promise<unknown> {
    const url = new URL(req.url), path = url.pathname;
    if (path === "/health" && req.method === "GET") return { status: "ok", service: "hooks", failure_mode: "fail-closed" };
    const hookPath = ["/access", "/pre", "/post"].includes(path);
    const deliveryPath = /^\/internal\/approvals\/([^/]+)\/delivery$/.exec(path);
    if (hookPath) authentication(req, config.hookSecret); else if (path.startsWith("/operator/")) authentication(req, config.operatorToken); else if (path.startsWith("/internal/approvals/") && (req.method === "POST" || deliveryPath)) authentication(req, config.approvalsToken); else authentication(req, config.webToken);
    if (deliveryPath && req.method === "GET") {
      const approval = getApproval(decodeURIComponent(deliveryPath[1]!));
      requireThat(approval.requester_id === url.searchParams.get("requester_id"), 403, "Only the requester can deliver this request.");
      return publicApproval(approval);
    }
    const body = req.method === "GET" ? {} : object(await req.json().catch(() => { throw new HttpError(400, "Invalid JSON body."); }));
    if (hookPath) { requireThat(req.method === "POST", 405, "Use POST."); return path === "/access" ? access(body) : path === "/pre" ? pre(body) : post(body); }
    if (path === "/operator/observed-tools" && req.method === "GET") return { tools: store.all<ObservedTool>("observed_tool").sort((a, b) => a.toolkit < b.toolkit ? -1 : a.toolkit > b.toolkit ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0) };
    if (path === "/operator/state" && req.method === "GET") return { ...state(), active_run_count: store.all<Run>("run").filter(run => activeStatuses.has(run.status)).length };
    if (path === "/operator/verification" && req.method === "GET") {
      const key = string(url.searchParams.get("operation_key"), "operation_key");
      const denial = store.all<Denial>("denial").find(d => d.requester === config.verificationUserId && d.inputs.operation_key === key && d.expires_at > clock());
      return { denial: denial ? { execution_id: denial.execution_id, denial_id: denial.id, operation_key: denial.inputs.operation_key } : null, filter: store.get("verification", "filter") };
    }
    if (path === "/operator/verification" && req.method === "POST") {
      const operation_key = string(body.operation_key, "operation_key");
      requireThat(keyPattern.test(operation_key), 400, "Invalid verification operation key.");
      store.put("verification", "attempt", { operation_key, prior_filter_id: store.get<{ execution_id: string }>("verification", "filter")?.execution_id ?? null, policy_version: policy().doc.version, reset_epoch: state().reset_epoch, confirmed: false } satisfies Verification);
      return { started: true };
    }
    if (path === "/operator/verification/confirm" && req.method === "POST") {
      const attempt = store.get<Verification>("verification", "attempt");
      const denial = store.all<Denial>("denial").find(d => d.requester === config.verificationUserId && d.inputs.operation_key === body.operation_key && d.expires_at > clock());
      const filter = store.get<{ execution_id: string }>("verification", "filter");
      requireThat(attempt && attempt.operation_key === body.operation_key && attempt.policy_version === policy().doc.version && attempt.reset_epoch === state().reset_epoch && denial && denial.execution_id === body.denial_execution_id && filter && filter.execution_id === body.filter_execution_id && filter.execution_id !== attempt.prior_filter_id, 409, "A fresh matching gateway verification is required.");
      // The authenticated operator CLI attests the outputs it actually received.
      // Hook callbacks alone cannot prove that the gateway enforced their results.
      store.put("verification", "attempt", { ...attempt, confirmed: true });
      return { confirmed: true };
    }
    const operatorRun = /^\/operator\/runs\/([^/]+)\/(evidence|recover)$/.exec(path);
    if (operatorRun) {
      const run = readRun(decodeURIComponent(operatorRun[1]!));
      if (operatorRun[2] === "evidence" && req.method === "GET") {
        const events: ReturnType<Store["audit"]> = [];
        let cursor = 0;
        while (true) { const page = store.audit(run.run_id, cursor); events.push(...page); if (page.length < 200) break; cursor = page.at(-1)!.seq; }
        const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
        let action = null;
        if (run.action) {
          const inputs = run.action.arguments;
          action = { operation_key: run.action.operation_key, tool_name: run.action.tool_name, arguments_hash: hash(inputs), receipt_binding_hash: hash({ actor: run.requester_user_id, action: "discount", account_id: inputs.account_id, body: actionBody(inputs) }) };
        }
        const approval = run.request_id ? getApproval(run.request_id) : null;
        const denied = approval ? store.get<Denial>("denial", approval.denial_id) : null;
        const denial = denied && approval ? { execution_id: denied.execution_id, operation_key: denied.inputs.operation_key, request_id: approval.id, requester_id: denied.requester, tool_name: qualified(denied.tool) } : null;
        return { run: publicRun(run), approval: approval ? publicApproval(approval) : null, denial, action, events };
      }
      if (operatorRun[2] === "recover" && req.method === "POST") return store.transaction(() => {
        const current = readRun(run.run_id);
        requireThat(body.worker_stopped === true && current.status === "resuming" && current.lease_id !== null && body.lease_id === current.lease_id && current.lease_until !== null && current.lease_until <= clock(), 409, "Recovery requires the stopped worker and its current expired resume lease.");
        current.status = "waiting"; current.lease_id = null; current.lease_until = null; store.put("run", current.run_id, current);
        return { run: publicRun(current) };
      });
    }
    if (path === "/operator/policy" && req.method === "GET") return { ...policy().doc, ...state() };
    if (path === "/operator/policy" && req.method === "PUT") { const { active: _active, verified_denial: _denial, verified_filter: _filter, reset_epoch: _epoch, ...candidate } = body; const next = validatePolicy(candidate, config).doc; store.transaction(() => { requireThat(next.version === policy().doc.version, 409, "Policy version changed; reload before editing."); next.version++; store.put("policy", "current", next); }); return next; }
    if (path === "/operator/activate" && req.method === "POST") {
      const s = state(), attempt = store.get<Verification>("verification", "attempt");
      requireThat(s.verified_denial && s.verified_filter && attempt?.confirmed && attempt.policy_version === policy().doc.version && attempt.reset_epoch === s.reset_epoch, 409, "Complete verify-governance through the gateway before activation.");
      s.active = true; store.put("state", "current", s); return s;
    }
    if (path === "/operator/reset" && req.method === "POST") return store.transaction(() => {
      requireThat(!store.all<Run>("run").some(r => ["running", "awaiting_snapshot", "resuming"].includes(r.status)), 409, "Stop active run or snapshot writers before resetting.");
      const reset_epoch = state().reset_epoch + 1;
      store.reset(); store.put("policy", "current", initial); store.put("state", "current", { active: false, verified_denial: false, verified_filter: false, reset_epoch });
      return { reset: true, active: false, reset_epoch };
    });
    if (path === "/internal/policy" && req.method === "GET") return policy().doc;
    if (path === "/internal/approvals/request" && req.method === "POST") return requestApproval(body);
    const approvalPath = /^\/internal\/approvals\/([^/]+)(?:\/(notification\/(claim|result)|decision))?$/.exec(path);
    if (approvalPath) {
      const id = decodeURIComponent(approvalPath[1]!);
      if (req.method === "POST" && approvalPath[3]) return notification(id, approvalPath[3], body);
      if (req.method === "POST" && approvalPath[2] === "decision") return decide(id, body, req.headers.get("X-Actor-Token"));
      if (req.method === "GET" && !approvalPath[2]) { const approval = getApproval(id), viewer = url.searchParams.get("viewer_user_id"); requireThat(viewer === approval.requester_id || viewer === approval.approver_id, 403, "Approval is not visible to this actor."); return { approval: publicApproval(approval), run_id: store.all<Run>("run").find(r => r.request_id === id)?.run_id ?? null }; }
    }
    if (path === "/internal/runs" && req.method === "POST") return store.transaction(() => {
      const id = string(body.run_id, "run_id"), requester = string(body.requester_user_id, "requester_user_id"); requireThat(body.stage === "governed" && subject(requester), 400, "Known governed requester is required."); requireThat(state().active, 409, "Hooks are not activated."); requireThat(!store.get("run", id) && !currentRun(requester), 409, "Requester already has a run or this run ID was used.");
      const run: Run = { run_id: id, requester_user_id: requester, stage: "governed", status: "running", message: String(safe(string(body.message, "message"), requester)), request_id: null, operation_key: null, tool_call_id: null, action: null, text: "", error: null, tool_calls: [], lease_id: null, lease_until: null, created_at: iso(), resumed_at: null }; store.put("run", id, run); return { run: publicRun(run) };
    });
    const runPath = /^\/internal\/runs\/([^/]+)(?:\/(action|approval|suspended|resume|result|close))?$/.exec(path);
    if (runPath) { const id = decodeURIComponent(runPath[1]!); if (req.method === "POST" && runPath[2]) return runs(id, runPath[2], body); if (req.method === "GET" && !runPath[2]) { const run = readRun(id); requireThat(canView(run, string(url.searchParams.get("viewer_user_id"), "viewer_user_id")), 403, "Run is not visible to this actor."); return { run: publicRun(run) }; } }
    if (path === "/internal/audit" && req.method === "GET") { const id = string(url.searchParams.get("run_id"), "run_id"), run = readRun(id); requireThat(canView(run, string(url.searchParams.get("viewer_user_id"), "viewer_user_id")), 403, "Run is not visible to this actor."); const after = Number(url.searchParams.get("after") ?? 0); requireThat(Number.isSafeInteger(after) && after >= 0, 400, "Invalid audit cursor."); const events = store.audit(id, after); return { events, next_cursor: events.at(-1)?.seq ?? after }; }
    throw new HttpError(404, "Not found.");
  }
  return {
    async fetch(req: Request) {
      try { return Response.json(await handle(req), { headers: { "cache-control": "no-store" } }); }
      catch (error) { return Response.json({ error: error instanceof HttpError ? error.message : "Request or policy validation failed.", code: "CHECK_FAILED" }, { status: error instanceof HttpError ? error.status : 400, headers: { "cache-control": "no-store" } }); }
    },
    close: () => store.close(),
  };
}
