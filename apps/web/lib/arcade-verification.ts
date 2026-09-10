import { z } from "zod";
import { ServiceError } from "./hooks-client";
import { createSessions, type SessionConfig } from "./session";

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function page(title: string, content: string, status: number) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><body style="font:18px system-ui;max-width:40rem;margin:4rem auto;padding:1rem"><h1>${escape(title)}</h1>${content}</body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });
}

export async function verifyArcade(request: Request, config: SessionConfig, key: string, endpoints: { confirmUrl?: string; authStatusUrl?: string }) {
  const url = new URL(request.url);
  const statusOnly = url.pathname === "/auth/arcade/status";
  let authId = statusOnly ? z.string().min(1).max(500).parse(url.searchParams.get("auth_id")) : "";
  const flowId = statusOnly ? "" : z.string().min(1).max(500).parse(url.searchParams.get("flow_id"));
  let session;
  try { session = await createSessions(config).current(request); }
  catch (error) { if (!(error instanceof ServiceError) || error.status !== 401) throw error; }
  if (!session) {
    const roles = [...Object.keys(config.emails), ...(config.verificationEmail && config.demoMode ? ["verification"] : [])];
    const links = roles.map(persona => `<li><a href="/auth/login?${escape(new URLSearchParams({ persona, returnTo: url.pathname + url.search }).toString())}">Sign in as ${escape(persona)}</a></li>`).join("");
    return page("Sign in to continue authorization", `<p>Choose the identity that requested this connection. Your pending authorization will be preserved.</p><ul>${links}</ul>`, 401);
  }
  if (url.searchParams.has("user_id") && url.searchParams.get("user_id") !== session.email) throw new ServiceError("Sign in as the identity requesting Arcade authorization.", 403);
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  if (!statusOnly) {
    const response = await fetch(endpoints.confirmUrl ?? "https://cloud.arcade.dev/api/v1/oauth/confirm_user", { method: "POST", headers, body: JSON.stringify({ flow_id: flowId, user_id: session.email }), redirect: "error", signal: AbortSignal.timeout(15_000) });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (result?.error === "user_mismatch") throw new ServiceError("Arcade authorization belongs to a different identity. Return to the workshop and start authorization in the matching role.", 403);
      throw new ServiceError("Arcade could not confirm this flow. It may have expired or already been used. Return to the workshop and start a fresh authorization.", 409);
    }
    authId = z.object({ auth_id: z.string().min(1).max(500) }).parse(result).auth_id;
  }
  const statusUrl = new URL(endpoints.authStatusUrl ?? "https://api.arcade.dev/v1/auth/status");
  statusUrl.searchParams.set("id", authId);
  const response = await fetch(statusUrl, { headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new ServiceError("Authorization status could not be checked. Return to the workshop and retry the connection check.", 502);
  const result = z.object({ id: z.string(), user_id: z.string(), status: z.string() }).parse(await response.json());
  // A completed request may resolve to its connection ID (ar_ -> ac_).
  // The authenticated status endpoint resolves the supplied ID; bind its user to the session.
  if (result.user_id !== session.email) throw new ServiceError("This authorization belongs to a different identity.", 403);
  if (result.status === "completed") return page("Authorization complete", '<p>Return to the workshop and retry the pending action.</p><a href="/">Return to workshop</a>', 200);
  if (["pending", "not_started"].includes(result.status)) return page("Authorization is still pending", `<p>Your identity was confirmed, but Arcade has not completed the connection.</p><a href="/auth/arcade/status?${escape(new URLSearchParams({ auth_id: authId }).toString())}">Check connection again</a>`, 202);
  return page("Authorization did not complete", '<p>Return to the workshop and start a fresh authorization in the same role.</p><a href="/">Return to workshop</a>', 409);
}
