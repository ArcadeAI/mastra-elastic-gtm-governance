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
const marker = (value: unknown) => JSON.stringify(value)?.includes(GOVERNED_INSTRUCTION) || /workshop_(?:support|activation)_FAKE_[A-Za-z0-9_-]+|\+1-\d{3}-555-\d{4}|"personal_phone"|"activation_token"|"api_key"/.test(JSON.stringify(value) ?? "");
export function safeArtifact(value: unknown): unknown {
  if (typeof value === "string") return value.split(GOVERNED_INSTRUCTION).join("[removed]").replace(/workshop_(?:support|activation)_FAKE_[A-Za-z0-9_-]+|\+1-\d{3}-555-\d{4}/g, "[removed]");
  if (Array.isArray(value)) return value.map(safeArtifact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(personal_phone|api_key|activation_token|authorization|access_token|refresh_token|client_secret)$/i.test(key)).map(([key, entry]) => [key, safeArtifact(entry)]));
  return value;
}

function toolOutput(value: any): any {
  if (value && typeof value === "object") {
    if (value.structuredContent !== undefined) return value.structuredContent;
    if (Array.isArray(value.content)) for (const item of value.content) {
      if (item.type !== "text" || typeof item.text !== "string") continue;
      try { return JSON.parse(item.text); } catch { /* A later text block may contain the structured result. */ }
    }
  }
  return value;
}

export function verifyEvidence(evidence: any, receipt: any, expected: { runId: string; dana: string; riley: string; discountName: string; discountHook: string; getOfferName: string; getOfferHook: string; elasticNames: string[]; elasticHooks: string[] }): EvidenceCheck[] {
  const checks: EvidenceCheck[] = [];
  const verify = (boundary: string, valid: unknown, detail: string) => checks.push({ boundary, status: valid ? "verified" : "failed", detail });
  const { run = {}, approval = {}, action = {} } = evidence;
  const events: any[] = Array.isArray(evidence.events) ? evidence.events : [];
  const calls: any[] = Array.isArray(run.tool_calls) ? run.tool_calls : [];
  const name = (call: any) => call.mcpName ?? call.name;
  verify("run_binding", run.run_id === expected.runId && run.stage === "governed" && run.requester_user_id === expected.dana && present(run.request_id) && present(run.operation_key) && present(run.tool_call_id), "Run, requester, approval, operation and suspension IDs must identify this governed exercise.");
  verify("resumed_run", run.status === "completed" && !run.error && time(run.resumed_at) >= time(run.created_at) && time(run.resumed_at) >= time(approval.decided_at), "Only a completed result recorded through a valid resume lease proves continuation.");
  verify("approval_binding", approval.request_id === run.request_id && approval.operation_key === run.operation_key && approval.requester_id === expected.dana && approval.approver_id === expected.riley && approval.approver_id !== approval.requester_id && approval.status === "approved" && present(approval.grant_id), "The approved request must bind Dana, assigned Riley, this operation and one grant.");
  const receiptHash = receipt ? hash({ actor: receipt.actor, action: receipt.action, account_id: receipt.account_id, body: receipt.body }) : "";
  verify("operation_receipt", receipt && receipt.operation_key === run.operation_key && receipt.actor === expected.dana && receipt.action === "discount" && receipt.account_id === approval.resource_id && action?.operation_key === run.operation_key && action?.tool_name === expected.discountName && action?.receipt_binding_hash === receiptHash && time(receipt.completed_at) >= time(approval.decided_at) && time(receipt.completed_at) <= time(run.resumed_at), "The Sales owner's durable receipt must match the original action fingerprint and approval, including its complete body. Its globally unique key represents one committed operation.");
  const requested = events.find(event => event.decision === "approval_requested" && event.request_id === run.request_id && event.operation_key === run.operation_key && event.user_id === expected.dana);
  const deniedAction = evidence.denial;
  const denialBinding = deniedAction?.operation_key === run.operation_key && deniedAction?.request_id === run.request_id && deniedAction?.requester_id === expected.dana && deniedAction?.tool_name === expected.discountHook;
  const denial = events.find(event => event.hook === "pre" && event.decision === "deny" && event.tool === expected.discountHook && event.user_id === expected.dana && present(event.execution_id) && event.execution_id === deniedAction?.execution_id && event.seq < requested?.seq);
  const allowed = events.find(event => event.hook === "pre" && event.decision === "allow" && event.tool === expected.discountHook && event.operation_key === run.operation_key && event.user_id === expected.dana && present(event.execution_id));
  verify("gateway_denial", denialBinding && denial && requested && allowed && allowed.seq > requested.seq, "The denied action must bind this requester, request, tool and operation to its exact gateway execution ID, preceding the approved operation's allow.");
  const decision = events.find(event => event.decision === "approved" && event.request_id === run.request_id && event.operation_key === run.operation_key && event.grant_id === approval.grant_id && event.approver_id === expected.riley && event.user_id === expected.dana && present(event.verified_subject));
  verify("authenticated_approval", decision && decision.seq > requested?.seq && decision.seq < allowed?.seq, "The recorded decision must include independently verified identity and this request, grant and operation, before the allowed write.");
  const notification = events.find(event => event.decision === "notification" && event.request_id === run.request_id && event.status === "sent" && event.channel === approval.channel && event.ts === approval.ts && event.user_id === expected.dana);
  verify("slack_acknowledgement", approval.notification_status === "sent" && present(approval.channel) && present(approval.ts) && notification && notification.seq > requested?.seq && notification.seq < decision?.seq, "A saved Slack channel/timestamp and matching notification acknowledgement must precede the authenticated decision.");
  verify("tool_trace", calls.some(call => expected.elasticNames.includes(name(call))) && calls.some(call => name(call) === expected.discountName && call.args?.operation_key === run.operation_key && typeof call.arguments_hash === "string" && /^[a-f0-9]{64}$/.test(call.arguments_hash) && call.arguments_hash === action?.arguments_hash), "The stored Mastra trace must name configured observed Elastic and discount tools, with the same operation key and a hooks-attested fingerprint of the original arguments before display filtering.");
  const price = receipt?.body?.list_price, discount = receipt?.body?.discount_percent;
  const netPrice = typeof price === "number" && Number.isFinite(price) && price > 0 && typeof discount === "number" && Number.isFinite(discount) && discount >= 0 && discount <= 100 ? Math.round((price * (100 - discount) / 100 + Number.EPSILON) * 100) / 100 : NaN;
  const savedOffer = events.find(event => {
    if (event.tool !== expected.getOfferHook || event.user_id !== expected.dana || event.hook !== "post" || event.success !== true || !["allow", "modify"].includes(event.decision) || event.after?.isError === true || !present(event.execution_id) || !(event.seq > allowed?.seq)) return false;
    const offer = toolOutput(event.after);
    return offer?.isError !== true && !offer?.error && offer?.account_id === receipt?.account_id && present(offer?.offer_id) && offer?.discount_percent === discount && offer?.list_price === price && offer?.net_price === netPrice && offer?.status === "draft" && present(offer?.follow_up_email?.to) && present(offer?.follow_up_email?.subject) && present(offer?.follow_up_email?.body);
  });
  verify("saved_offer_check", savedOffer && calls.some(call => name(call) === expected.getOfferName && call.args?.account_id === receipt?.account_id), "A successful configured GetOffer after the allowed write must read back the same account, discount, list and net prices, draft status and follow-up email draft, and appear in the stored Mastra trace.");
  const outputs = events.filter(event => expected.elasticHooks.includes(event.tool) && event.user_id === expected.dana && event.hook === "post" && event.success === true && present(event.execution_id) && event.after !== undefined);
  const sources = new Set((JSON.stringify(outputs.map(event => event.after)).match(/evt-[a-z0-9-]+/g) ?? []));
  const citations = [...new Set<string>((typeof run.text === "string" ? run.text.match(/evt-[a-z0-9-]+/g) : null) ?? [])];
  verify("source_citations", outputs.length && citations.length && citations.every(id => sources.has(id)), "Every cited event ID must occur in this run's successful Elastic post-hook output, including JSON carried in MCP text.");
  verify("filtered_evidence", outputs.some(event => event.decision === "modify") && !marker({ run, events }), "A modified Elastic result must retain source evidence while support API-key, phone and instruction markers are absent from the stored model trace and safe audit.");
  return checks;
}
