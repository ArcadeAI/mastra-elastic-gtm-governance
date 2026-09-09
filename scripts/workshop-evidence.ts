import { createHash } from "node:crypto";
import { GOVERNED_INSTRUCTION } from "./seed-elastic";

export type EvidenceCheck = { boundary: string; status: "verified" | "failed" | "unexercised"; detail: string };
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const present = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const marker = (value: unknown) => JSON.stringify(value)?.includes(GOVERNED_INSTRUCTION) || /\+1-\d{3}-555-\d{4}|"personal_phone"/.test(JSON.stringify(value) ?? "");
export function safeArtifact(value: unknown): unknown {
  if (typeof value === "string") return value.split(GOVERNED_INSTRUCTION).join("[removed]").replace(/\+1-\d{3}-555-\d{4}/g, "[removed]");
  if (Array.isArray(value)) return value.map(safeArtifact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(personal_phone|authorization|access_token|refresh_token|client_secret)$/i.test(key)).map(([key, entry]) => [key, safeArtifact(entry)]));
  return value;
}

export function verifyEvidence(evidence: any, receipt: any, expected: { runId: string; dana: string; riley: string; routeName: string; routeHook: string; elasticNames: string[]; elasticHooks: string[] }): EvidenceCheck[] {
  const checks: EvidenceCheck[] = [];
  const verify = (boundary: string, valid: unknown, detail: string) => checks.push({ boundary, status: valid ? "verified" : "failed", detail });
  const { run = {}, approval = {}, action = {} } = evidence;
  const events: any[] = Array.isArray(evidence.events) ? evidence.events : [];
  const calls: any[] = Array.isArray(run.tool_calls) ? run.tool_calls : [];
  const name = (call: any) => call.mcpName ?? call.name;
  verify("run_binding", run.run_id === expected.runId && run.stage === "governed" && run.requester_user_id === expected.dana && present(run.request_id) && present(run.operation_key) && present(run.tool_call_id), "Run, requester, approval, operation and suspension IDs must identify this governed exercise.");
  verify("resumed_run", run.status === "completed" && !run.error && time(run.resumed_at) >= time(run.created_at) && time(run.resumed_at) >= time(approval.decided_at), "Only a completed result recorded through a valid resume lease proves continuation.");
  verify("approval_binding", approval.request_id === run.request_id && approval.operation_key === run.operation_key && approval.requester_id === expected.dana && approval.approver_id === expected.riley && approval.approver_id !== approval.requester_id && approval.status === "approved" && present(approval.grant_id), "The approved request must bind Dana, assigned Riley, this operation and one grant.");
  const receiptHash = receipt ? hash({ actor: receipt.actor, action: receipt.action, lead_id: receipt.lead_id, body: receipt.body }) : "";
  verify("operation_receipt", receipt && receipt.operation_key === run.operation_key && receipt.actor === expected.dana && receipt.action === "route" && receipt.lead_id === approval.resource_id && action?.operation_key === run.operation_key && action?.tool_name === expected.routeName && action?.receipt_binding_hash === receiptHash && time(receipt.completed_at) >= time(approval.decided_at) && time(receipt.completed_at) <= time(run.resumed_at), "The Lead owner's durable receipt must match the original action fingerprint and approval, including its complete body. Its globally unique key represents one committed operation.");
  const requested = events.find(event => event.decision === "approval_requested" && event.request_id === run.request_id && event.operation_key === run.operation_key && event.user_id === expected.dana);
  const deniedAction = evidence.denial;
  const denialBinding = deniedAction?.operation_key === run.operation_key && deniedAction?.request_id === run.request_id && deniedAction?.requester_id === expected.dana && deniedAction?.tool_name === expected.routeHook;
  const denial = events.find(event => event.hook === "pre" && event.decision === "deny" && event.tool === expected.routeHook && event.user_id === expected.dana && present(event.execution_id) && event.execution_id === deniedAction?.execution_id && event.seq < requested?.seq);
  const allowed = events.find(event => event.hook === "pre" && event.decision === "allow" && event.tool === expected.routeHook && event.operation_key === run.operation_key && event.user_id === expected.dana && present(event.execution_id));
  verify("gateway_denial", denialBinding && denial && requested && allowed && allowed.seq > requested.seq, "The denied action must bind this requester, request, tool and operation to its exact gateway execution ID, preceding the approved operation's allow.");
  const decision = events.find(event => event.decision === "approved" && event.request_id === run.request_id && event.operation_key === run.operation_key && event.grant_id === approval.grant_id && event.approver_id === expected.riley && event.user_id === expected.dana && present(event.verified_subject));
  verify("authenticated_approval", decision && decision.seq > requested?.seq && decision.seq < allowed?.seq, "The recorded decision must include independently verified identity and this request, grant and operation, before the allowed write.");
  const notification = events.find(event => event.decision === "notification" && event.request_id === run.request_id && event.status === "sent" && event.channel === approval.channel && event.ts === approval.ts && event.user_id === expected.dana);
  verify("slack_acknowledgement", approval.notification_status === "sent" && present(approval.channel) && present(approval.ts) && notification && notification.seq > requested?.seq && notification.seq < decision?.seq, "A saved Slack channel/timestamp and matching notification acknowledgement must precede the authenticated decision.");
  verify("tool_trace", calls.some(call => expected.elasticNames.includes(name(call))) && calls.some(call => name(call) === expected.routeName && call.args?.operation_key === run.operation_key && hash(call.args) === action?.arguments_hash), "The stored Mastra trace must name configured observed Elastic and route tools, with the same operation key and exact original argument fingerprint.");
  const outputs = events.filter(event => expected.elasticHooks.includes(event.tool) && event.user_id === expected.dana && event.hook === "post" && event.success === true && present(event.execution_id) && event.after !== undefined);
  const sources = new Set((JSON.stringify(outputs.map(event => event.after)).match(/evt-[a-z0-9-]+/g) ?? []));
  const citations = [...new Set<string>((typeof run.text === "string" ? run.text.match(/evt-[a-z0-9-]+/g) : null) ?? [])];
  verify("source_citations", outputs.length && citations.length && citations.every(id => sources.has(id)), "Every cited event ID must occur in this run's successful Elastic post-hook output, including JSON carried in MCP text.");
  verify("filtered_evidence", outputs.some(event => event.decision === "modify") && !marker({ run, events }), "A modified Elastic result must retain source evidence while phone and instruction markers are absent from the stored model trace and safe audit.");
  return checks;
}
