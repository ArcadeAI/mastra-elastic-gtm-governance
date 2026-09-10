import { z } from "zod";
import { ServiceError } from "./hooks-client";

const notificationStatus = z.enum(["pending", "sending", "sent", "failed", "uncertain"]);
const publicApprovalSchema = z.object({
  request_id: z.string().min(1), requester_id: z.string().min(1), approver_id: z.string().min(1),
  requester_name: z.string(), approver_name: z.string(), operation_key: z.string().min(1),
  tool_name: z.string(), inputs: z.record(z.unknown()), resource_id: z.string().nullable(),
  required_clearance: z.number().finite(), status: z.enum(["pending", "approved", "denied", "expired"]),
  notification_status: notificationStatus, approval_url: z.string().min(1),
  grant_id: z.string().nullable().optional(), expires_at: z.string().optional(), decided_at: z.string().nullable().optional(),
  channel: z.string().nullable().optional(), ts: z.string().nullable().optional(), notification_error: z.string().nullable().optional(),
});
export type PublicApproval = z.infer<typeof publicApprovalSchema>;
export type ApprovalClientResult = { approval: PublicApproval; authorizationUrls: string[] };
export type ApprovalClientConfig = { hooksHost: string; serviceToken: string; arcadeKey: string; arcadeBaseUrl?: string; slackBaseUrl?: string; slackSignature?: string };
export interface ApprovalClient {
  request(runId: string, requesterId: string): Promise<ApprovalClientResult>;
  notify(requestId: string, requesterId: string): Promise<ApprovalClientResult>;
  decide(requestId: string, actorId: string, actorToken: string, decision: "approve" | "deny", note?: string): Promise<ApprovalClientResult>;
}
export class ApprovalClientError extends ServiceError {}

const scopes = ["chat:write", "im:write", "users:read", "users:read.email"];
const noSendErrors = new Set(["invalid_auth", "not_authed", "token_expired", "token_revoked", "account_inactive", "missing_scope", "no_permission", "channel_not_found", "not_in_channel", "is_archived", "restricted_action", "invalid_blocks", "invalid_blocks_format", "msg_blocks_too_long", "no_text", "rate_limited", "ratelimited"]);
class SlackFailure extends Error {
  constructor(readonly code: string, readonly outcome: "failed" | "uncertain") { super(code); }
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function loopback(host: string) { return ["localhost", "127.0.0.1", "[::1]"].includes(host); }
function baseUrl(value: string, name: string, allowPath = false) {
  let url: URL;
  try { url = new URL(value.includes("://") ? value : `${/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(value) ? "http" : "https"}://${value}`); }
  catch { throw new ApprovalClientError(`${name} must be a valid service URL.`, 503); }
  if (url.username || url.password || url.search || url.hash || (!allowPath && url.pathname !== "/") || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname)))) throw new ApprovalClientError(`${name} must use HTTPS or local HTTP without credentials.`, 503);
  return url.href.replace(/\/+$/, "");
}
function validLink(value: string) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && loopback(url.hostname)));
  } catch { return false; }
}
function text(value: string) { return { type: "plain_text", text: value.slice(0, 1900) }; }

/** Compact delivery summary; the authenticated review page holds the complete action. */
export function approvalMessage(display: PublicApproval, channel: string, signature = "") {
  const discount = display.required_clearance.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const price = display.inputs.list_price;
  const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
  const terms = typeof price === "number" && Number.isFinite(price)
    ? `${money(Math.round(price * (1 - display.required_clearance / 100) * 100) / 100)}/year (list ${money(price)})` : "See exact terms on review page";
  const reviewer = display.approver_name.split(" ")[0];
  const status = display.status === "pending" ? "Review needed" : display.status[0]!.toUpperCase() + display.status.slice(1);
  return { channel, text: `${status}: ${display.resource_id ?? "Renewal"}, ${discount}% discount, ${terms}. ${display.requester_name} → ${display.approver_name}.${signature ? `\n\n${signature}` : ""}`, unfurl_links: false, unfurl_media: false, mrkdwn: false, blocks: [
    { type: "header", text: text(`Renewal discount · ${status}`) },
    { type: "section", fields: [text(`Account\n${display.resource_id ?? "See review page"}`), text(`Reviewer\n${display.approver_name}`), text(`Discount\n${discount}%`), text(`Annual price\n${terms}`)] },
    { type: "section", text: text(display.status === "pending" ? `${display.requester_name} needs ${display.approver_name}’s approval before saving this discount and customer draft.` : `Request ${display.status}. Open the review page for the exact terms, customer draft and recorded decision.`) },
    { type: "actions", elements: [{ type: "button", text: text("Review request"), style: "primary", url: display.approval_url }] },
    { type: "context", elements: [text(`Opens the workshop review page. Sign in as ${reviewer} to review the exact terms and customer draft.`)] },
    ...(signature ? [{ type: "section", text: text(signature) }] : []),
  ] };
}

/** Host-owned orchestration. Only this server module sees delegated OAuth tokens. */
export function createApprovalClient(config: ApprovalClientConfig): ApprovalClient {
  const hooks = baseUrl(config.hooksHost, "HOOKS_PUBLIC_HOST"), arcade = baseUrl(config.arcadeBaseUrl ?? "https://api.arcade.dev", "Arcade URL"), slack = baseUrl(config.slackBaseUrl ?? "https://slack.com/api", "Slack URL", true);
  if (!config.serviceToken.trim() || !config.arcadeKey.trim()) throw new ApprovalClientError("Host approvals credentials are not configured.", 503);
  const secrets = new Set([config.serviceToken, config.arcadeKey]);
  function scrub(value: unknown): unknown {
    if (typeof value === "string") { let clean = value; for (const secret of secrets) clean = clean.split(secret).join("[redacted]"); return clean; }
    if (Array.isArray(value)) return value.map(scrub);
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    return value;
  }
  function view(value: unknown): PublicApproval {
    const result = publicApprovalSchema.safeParse(value);
    if (!result.success) throw new ApprovalClientError("The approvals service returned an invalid approval record.");
    if (!validLink(result.data.approval_url)) throw new ApprovalClientError("The approvals service returned an invalid approval URL.");
    return scrub(result.data) as PublicApproval;
  }
  const result = (approval: PublicApproval, authorizationUrls: string[] = []): ApprovalClientResult => ({ approval: view(approval), authorizationUrls });
  async function service(path: string, body?: unknown, actorToken?: string, acknowledge = false): Promise<unknown> {
    const attempts = acknowledge ? 3 : 1;
    const suffix = acknowledge ? " Delivery acknowledgement is unresolved; do not resend the Slack message." : "";
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response: Response;
      try { response = await fetch(`${hooks}${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${config.serviceToken}`, "content-type": "application/json", ...(actorToken ? { "X-Actor-Token": actorToken } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" }); }
      catch { if (attempt + 1 < attempts) continue; throw new ApprovalClientError(`The approvals service could not be reached.${suffix}`, 503); }
      if (response.status >= 500 && attempt + 1 < attempts) continue;
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = response.status === 409 && object(payload) && payload.error === "Request already has a different or expired decision."
          ? "This approval request has expired or was already decided differently (HTTP 409). Open the request to review its current status."
          : `The approvals service rejected the request (HTTP ${response.status}).`;
        throw new ApprovalClientError(message + suffix, response.status);
      }
      if (!object(payload)) throw new ApprovalClientError(`The approvals service returned an invalid response.${suffix}`);
      return payload;
    }
    throw new ApprovalClientError("Delivery acknowledgement is unresolved; do not resend the Slack message.");
  }
  async function authorization(path: string, body?: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try { response = await fetch(`${arcade}${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${config.arcadeKey}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" }); }
    catch { throw new ApprovalClientError("Arcade Slack authorization could not be reached.", 503); }
    if (!response.ok) throw new ApprovalClientError(`Arcade rejected Slack authorization (HTTP ${response.status}).`, response.status);
    const payload: unknown = await response.json().catch(() => null);
    if (!object(payload)) throw new ApprovalClientError("Arcade returned an invalid Slack authorization response.");
    return payload;
  }
  async function slackAuthorization(requesterId: string) {
    // Same provider API used by Arcade SDK auth.start(); status is a GET with id.
    // https://docs.arcade.dev/en/build/tool-calling/call-third-party-apis
    let auth = await authorization("/v1/auth/authorize", { user_id: requesterId, auth_requirement: { provider_id: "slack", provider_type: "oauth2", oauth2: { scopes } } });
    const initialUrl = auth.url;
    if (auth.status !== "completed" && typeof auth.id === "string" && auth.id) auth = await authorization(`/v1/auth/status?id=${encodeURIComponent(auth.id)}`);
    if (auth.user_id !== undefined && auth.user_id !== requesterId) throw new ApprovalClientError("Arcade returned authorization for a different user.");
    const token = object(auth.context) && typeof auth.context.token === "string" ? auth.context.token : "";
    if (token) secrets.add(token);
    if (auth.status === "completed") {
      if (!token.trim()) throw new ApprovalClientError("Arcade completed Slack authorization without a usable token.");
      return { token, urls: [] as string[] };
    }
    if (!["pending", "not_started"].includes(String(auth.status))) throw new ApprovalClientError("Slack authorization has failed. Start authorization again.", 409);
    const url = auth.url ?? initialUrl;
    if (typeof url !== "string" || scrub(url) !== url) throw new ApprovalClientError("Arcade returned an invalid Slack authorization link.");
    if (!validLink(url)) throw new ApprovalClientError("Arcade returned an invalid Slack authorization link.");
    return { token: null, urls: [url] };
  }
  async function slackCall(token: string, method: string, body: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try { response = await fetch(`${slack}/${method}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" }); }
    catch { throw new SlackFailure("transport_error", "uncertain"); }
    if (response.status === 429) throw new SlackFailure("rate_limited", "failed");
    if (!response.ok) throw new SlackFailure(`http_${response.status}`, "uncertain");
    const payload: unknown = await response.json().catch(() => null);
    if (!object(payload)) throw new SlackFailure("invalid_response", "uncertain");
    if (payload.ok !== true) {
      // No arbitrary upstream error text ever reaches hooks, Slack, or the browser.
      const code = typeof payload.error === "string" && noSendErrors.has(payload.error) ? payload.error : "unknown_provider_error";
      throw new SlackFailure(code, noSendErrors.has(code) ? "failed" : "uncertain");
    }
    return payload;
  }
  async function notify(requestId: string, requesterId: string): Promise<ApprovalClientResult> {
    const path = `/internal/approvals/${encodeURIComponent(requestId)}`;
    const approval = view(await service(`${path}/delivery?requester_id=${encodeURIComponent(requesterId)}`));
    if (approval.request_id !== requestId || approval.requester_id !== requesterId) throw new ApprovalClientError("The approval does not belong to the requesting identity.", 403);
    if (approval.status !== "pending" || ["sending", "sent", "uncertain"].includes(approval.notification_status)) return result(approval);
    const auth = await slackAuthorization(requesterId);
    if (!auth.token) return result(approval, auth.urls);
    let user: string, team: string, channel: string;
    try {
      const identity = await slackCall(auth.token, "auth.test", {});
      if (typeof identity.user_id !== "string" || !/^[UW][A-Z0-9]+$/.test(identity.user_id) || typeof identity.team_id !== "string" || !/^T[A-Z0-9]+$/.test(identity.team_id)) throw new SlackFailure("invalid_identity", "failed");
      user = identity.user_id; team = identity.team_id;
      const opened = await slackCall(auth.token, "conversations.open", { users: user });
      if (!object(opened.channel) || typeof opened.channel.id !== "string" || !/^D[A-Z0-9]+$/.test(opened.channel.id)) throw new SlackFailure("invalid_channel", "failed");
      channel = opened.channel.id;
    } catch (error) {
      if (error instanceof SlackFailure) throw new ApprovalClientError(`Slack delivery could not be prepared (${error.code}); no message was sent.`);
      throw error;
    }
    const claim = z.object({ claim_id: z.string().min(1).nullable(), notification_status: notificationStatus }).safeParse(await service(`${path}/notification/claim`, { requester_id: requesterId, slack_user_id: user, slack_team_id: team }));
    if (!claim.success || (claim.data.claim_id === null ? !["sending", "sent", "uncertain"].includes(claim.data.notification_status) : claim.data.notification_status !== "sending")) throw new ApprovalClientError("The approvals service returned an invalid delivery claim.");
    if (!claim.data.claim_id) return result(view(await service(`${path}/delivery?requester_id=${encodeURIComponent(requesterId)}`)));
    const receipt: Record<string, unknown> = { requester_id: requesterId, claim_id: claim.data.claim_id };
    const display = view(approval);
    const signature = (scrub(config.slackSignature?.trim() ?? "") as string).slice(0, 1900);
    const message = approvalMessage(display, channel, signature);
    try {
      const posted = await slackCall(auth.token, "chat.postMessage", message);
      if (posted.channel !== channel || typeof posted.ts !== "string" || !/^\d+\.\d+$/.test(posted.ts)) throw new SlackFailure("invalid_receipt", "uncertain");
      Object.assign(receipt, { outcome: "sent", channel, ts: posted.ts });
    } catch (error) {
      if (!(error instanceof SlackFailure)) throw error;
      Object.assign(receipt, { outcome: error.outcome, error: error.code });
    }
    return result(view(await service(`${path}/notification/result`, receipt, undefined, true)));
  }
  return {
    async request(runId, requesterId) {
      const approval = view(await service("/internal/approvals/request", { run_id: runId, requester_id: requesterId, justification: "Review the blocked workshop action" }));
      if (approval.requester_id !== requesterId) throw new ApprovalClientError("The approval does not belong to the requesting identity.", 403);
      try { return await notify(approval.request_id, requesterId); }
      catch (error) {
        // The exact request already exists. Keep its ID available to the native
        // suspension path even when authorization or notification cannot finish.
        let current = approval;
        try { current = view(await service(`/internal/approvals/${encodeURIComponent(approval.request_id)}/delivery?requester_id=${encodeURIComponent(requesterId)}`)); } catch { /* The durable creation response is still authoritative. */ }
        return result({ ...current, notification_error: error instanceof ApprovalClientError ? error.message : "Slack notification could not be completed. Retry notification from the saved request." });
      }
    },
    notify,
    async decide(requestId, actorId, actorToken, decision, note) {
      if (!actorToken.trim()) throw new ApprovalClientError("An authenticated IdP actor token is required.", 401);
      secrets.add(actorToken);
      const approval = view(await service(`/internal/approvals/${encodeURIComponent(requestId)}/decision`, { actor_id: actorId, decision, ...(note === undefined ? {} : { note }) }, actorToken));
      return result(approval);
    },
  };
}
