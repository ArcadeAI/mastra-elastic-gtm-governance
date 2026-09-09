"use client";
import { useEffect, useState } from "react";

const stages = [
  { id: "supplied", label: "1 · Build your agent", hint: "Mastra", prompt: "Does Northwind’s account evidence support a 30% renewal discount? What is still unverified?" },
  { id: "elastic", label: "2 · Connect evidence", hint: "Elastic through Arcade", prompt: "Does Northwind’s account evidence support a 30% renewal discount? What is still unverified? Search Elastic and cite source IDs." },
  { id: "governed", label: "3 · Act with approval", hint: "Arcade + Slack", prompt: "Prepare Northwind’s contract offer with a 30% discount and an activation-email draft. Use account ACC-2291, research the Elastic evidence, then double-check the saved offer and summarize the terms." },
] as const;
type Stage = typeof stages[number]["id"];
type Session = { persona: string; email: string; csrf: string };

export function Workshop({ approvalId }: { approvalId?: string }) {
  const [stage, setStage] = useState<Stage>(approvalId ? "governed" : "supplied");
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>(stages[0].prompt);
  const [result, setResult] = useState<any>(null);
  const [run, setRun] = useState<any>(null);
  const [approval, setApproval] = useState<any>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<any[]>([]);
  const [details, setDetails] = useState<any>(null);
  const [authUrls, setAuthUrls] = useState<string[]>([]);
  function rememberRun(id: string) { setRunId(id); localStorage.setItem("workshop-pending-run", id); }
  async function api(path: string, body?: unknown) {
    const response = await fetch(path, { ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), headers: { "content-type": "application/json", ...(session ? { "x-csrf-token": session.csrf } : {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { if (data.details?.run_id) rememberRun(data.details.run_id); throw new Error(data.error ?? `Request failed (${response.status})`); }
    if (data.authorizationUrls) setAuthUrls(data.authorizationUrls);
    return data;
  }
  async function refresh() {
    if (approvalId) { const current = await api(`/api/approvals/${encodeURIComponent(approvalId)}`); setApproval(current.approval); if (current.run_id) rememberRun(current.run_id); }
    if (runId) { const current = await api(`/api/runs/${encodeURIComponent(runId)}`); setRun(current.run); if (current.run.request_id && !approvalId) setApproval((await api(`/api/approvals/${encodeURIComponent(current.run.request_id)}`)).approval); }
  }
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const pendingId = query.get("run") ?? localStorage.getItem("workshop-pending-run");
    setRunId(pendingId);
    const selected = stages.find((item) => item.id === query.get("stage")) ?? (pendingId || approvalId ? stages[2] : stages[0]);
    setStage(selected.id); setMessage(selected.prompt);
    fetch("/api/session").then((response) => response.json()).then((data) => { setSession(data.session); setRoles(data.roles ?? {}); }).catch((cause) => setError(String(cause)));
  }, []);
  useEffect(() => {
    if (!session || (!runId && !approvalId)) return;
    void refresh().catch((cause) => setError(cause.message));
    const timer = setInterval(() => void refresh().catch((cause) => setError(cause.message)), 5000);
    return () => clearInterval(timer);
  }, [session, runId, approvalId]);
  async function perform(action: () => Promise<void>) { setBusy(true); setError(""); setAuthUrls([]); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }
  async function submit() { const next = await api("/api/agent", { stage, message }); setResult(next); if (next.approval) setApproval(next.approval); if (next.runId) rememberRun(next.runId); }
  async function notify() { const next = await api(`/api/approvals/${encodeURIComponent(approval.request_id)}/notify`, {}); setApproval(next.approval); await refresh(); }
  async function decide(decision: "approve" | "deny") {
    const next = await api(`/api/approvals/${encodeURIComponent(approval?.request_id ?? approvalId)}/decision`, { decision });
    if (next.authorizationUrls?.length) return;
    setApproval(next.approval); if (next.run_id) rememberRun(next.run_id);
    if (decision === "approve" && next.run_id) setResult(await api(`/api/runs/${encodeURIComponent(next.run_id)}/resume`, {}));
    await refresh();
  }
  function login(persona: string) { const query = new URLSearchParams(location.search); query.set("stage", "governed"); if (runId) query.set("run", runId); const returnTo = `${location.pathname}?${query}`; location.href = `/auth/login?persona=${persona}&returnTo=${encodeURIComponent(returnTo)}`; }
  return <main className="workshop-shell">
    <header className="workshop-header"><p className="eyebrow">MASTRA × ELASTIC × ARCADE</p><h1>Your discount agent, connected.</h1><p>Research the account. Propose the discount. Get the right approval.</p></header>
    <nav className="stage-nav" aria-label="Workshop stages">{stages.map((item) => <button key={item.id} className={stage === item.id ? "selected" : ""} onClick={() => { setStage(item.id); setMessage(item.prompt); setTools([]); }}><small>{item.hint}</small>{item.label}</button>)}</nav>
    <div className="workspace-grid"><section className="workshop-card">
      <h2>{stages.find((item) => item.id === stage)!.label}</h2>
      <p>{stage === "supplied" ? "Start with supplied practice input. Later sections add live evidence and actions to this same agent." : stage === "elastic" ? "Your agent reads Elastic through your Arcade gateway. Source IDs identify the evidence it retrieved." : "As Dana, request 30% off against a 15% limit. Review as Riley, then watch Dana’s original action continue. The offer and activation email are drafts."}</p>
      {stage === "governed" && <div className="identity-row"><strong>{session ? `Acting as ${session.persona}` : "Sign in to a demo role"}</strong><small>{session?.email}</small><div className="button-row">{Object.keys(roles).map((persona) => <button className="secondary compact" key={persona} onClick={() => login(persona)}>Sign in as {persona}</button>)}</div>{!Object.keys(roles).length && <p>Complete identity setup and enable workshop demo mode to show the supplied roles.</p>}</div>}
      <label htmlFor="agent-message">Your request</label><textarea id="agent-message" value={message} rows={5} onChange={(event) => setMessage(event.target.value)} />
      <div className="button-row"><button disabled={busy || (stage === "governed" && !session)} onClick={() => perform(submit)}>{busy ? "Working…" : "Run your agent"}</button><button className="secondary" disabled={busy} onClick={() => perform(async () => setTools((await api(`/api/tools?stage=${stage}`)).tools))}>Inspect available tools</button></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {result?.status === "failed" && <p className="error-message" role="alert">{result.error ?? "The action did not complete. Review authorization or delivery details before starting another exercise."}</p>}
      {result?.toolResults?.filter((item: any) => item.notificationStatus && item.notificationStatus !== "sent").map((item: any, index: number) => <p className="error-message" key={index}>Approval delivery: {item.notificationStatus}. {item.error ?? "Delivery is not confirmed. An uncertain delivery must not be reposted automatically."}</p>)}
      {authUrls.length > 0 && <div className="notice"><strong>Authorization needed</strong><p>{approval ? "Finish Slack consent as the requester, then retry notification below. Your pending action is saved." : "Finish consent in the matching role, then retry the action."}</p>{authUrls.map((url) => <p key={url}><a href={url} target="_blank" rel="noreferrer">Authorize with Arcade ↗</a></p>)}</div>}
      {tools.length > 0 && <details open><summary>Available tools ({tools.length})</summary><ul>{tools.map((tool) => <li key={tool.name}><code>{tool.name}</code><small>{tool.description}</small></li>)}</ul></details>}
      {(result || run?.text) && <article className="agent-answer"><p className="eyebrow">AGENT RESPONSE</p><pre>{result?.text ?? run?.text}</pre>{result?.toolCalls?.length > 0 && <details><summary>Tool activity</summary>{result.toolCalls.map((call: any, index: number) => <div className="trace" key={index}><strong>{call.name}</strong><pre>{JSON.stringify(call.args, null, 2)}</pre></div>)}</details>}</article>}
    </section><aside className="workshop-card workflow-panel"><p className="eyebrow">THE CONNECTED WORKFLOW</p><ol><li>Mastra researches the account</li><li>Elastic supplies the evidence</li><li>Arcade checks the discount</li><li>Slack delivers the approval request</li><li>Riley approves; Dana’s agent saves and checks the draft</li></ol>
      {runId && <div className="run-state"><h2>Pending workflow</h2><p><strong>{run?.status ?? "Loading…"}</strong></p>{run?.error && <p className="error-message">{run.error}</p>}<small>Requester: {run?.requester_user_id ?? "Loading…"}</small><code>{runId}</code><button className="secondary" disabled={busy || !session} onClick={() => perform(refresh)}>Refresh status</button></div>}
      {approval && <section className="approval-state"><h2>Human review</h2><p><strong>{approval.status}</strong> · Slack: {approval.notification_status}</p><p>{approval.requester_name} → {approval.approver_name}</p>{approval.notification_error && <p className="error-message">{approval.notification_error}</p>}{approval.status === "pending" && ["pending", "failed"].includes(approval.notification_status) && session?.email === approval.requester_id && <button className="secondary" disabled={busy} onClick={() => perform(notify)}>Retry Slack notification</button>}{["sending", "uncertain"].includes(approval.notification_status) && <p>Delivery is unresolved. Check Slack before closing this exercise; do not resend the request.</p>}<code>{approval.tool_name}</code><pre>{JSON.stringify(approval.inputs, null, 2)}</pre>{approval.status === "pending" && <div className="button-row"><button disabled={busy || !session || approval.notification_status !== "sent"} onClick={() => perform(() => decide("approve"))}>Approve exact action</button><button className="secondary" disabled={busy || !session || approval.notification_status !== "sent"} onClick={() => perform(() => decide("deny"))}>Deny</button></div>}{approval.status === "approved" && runId && <button disabled={busy || !session || run?.status === "completed"} onClick={() => perform(async () => { setResult(await api(`/api/runs/${runId}/resume`, {})); await refresh(); })}>Resume Dana’s agent</button>}</section>}
      {runId && session && <div className="button-row"><button className="secondary" disabled={busy} onClick={() => perform(async () => setDetails(await api(`/api/audit?run_id=${runId}`)))}>View safe audit</button><button className="secondary" disabled={busy} onClick={() => perform(async () => setDetails(await api("/api/policy")))}>View policy</button></div>}
      {runId && <button className="secondary" disabled={busy || !session || run?.status === "resuming"} onClick={() => perform(async () => { if (run?.status !== "completed") await api(`/api/runs/${runId}/close`, {}); localStorage.removeItem("workshop-pending-run"); setRunId(null); setRun(null); setApproval(null); setResult(null); })}>Start a new exercise</button>}
      {details && <details open><summary>Control-plane evidence</summary><pre>{JSON.stringify(details, null, 2)}</pre></details>}
    </aside></div>
  </main>;
}
