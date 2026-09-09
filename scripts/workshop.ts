#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { configFromEnv, seedElastic, verifyElastic, resetElastic, validateElasticConfig, type FixtureVariant } from "./seed-elastic";
import { hash, safeArtifact, verifyEvidence } from "./workshop-evidence";
import { starterRule, testRule, verifyRead, policyWithRule, LAB_RULE_ID } from "./hook-lab";

type Check = { boundary: string; status: "verified" | "configured" | "missing" | "failed" | "unexercised"; detail: string };
type Report = { command: string; status: string; live_proof: boolean; checks: Check[]; [name: string]: unknown };
type Options = Record<string, string | boolean>;
const requiredToolEnv = ["ARCADE_DISCOUNT_TOOL_NAME", "ARCADE_GET_OFFER_TOOL_NAME"];
const env = (name: string) => process.env[name]?.trim() || "";
const values = (value: string) => [...new Set(value.split(",").map(s => s.trim()).filter(Boolean))];

function parse(args: string[]) {
  const command = args.shift() ?? "setup";
  const options: Options = {};
  if (command === "hook-lab") options.action = args.shift() || "";
  for (let i = 0; i < args.length; i++) {
    const name = args[i]!;
    if (!name.startsWith("--") || name.slice(2) in options) throw new Error(`Unexpected or repeated argument: ${name}`);
    options[name.slice(2)] = name === "--live" ? true : args[++i] || "";
    if (options[name.slice(2)] === "" || String(options[name.slice(2)]).startsWith("--")) throw new Error(`Missing value for ${name}`);
  }
  return { command, options };
}
function allowed(options: Options, names: string[]) {
  for (const key of Object.keys(options)) if (!names.includes(key)) throw new Error(`Unknown option --${key}`);
}
function stage(options: Options) {
  const value = options.stage ?? "governed";
  if (!["supplied", "elastic", "governed"].includes(String(value))) throw new Error("Stage must be supplied, elastic, or governed.");
  return String(value);
}
function requireConfig(report: Report, names: string[]) {
  const missing = names.filter(name => !env(name));
  report.checks.push({ boundary: "configuration", status: missing.length ? "missing" : "configured", detail: missing.length ? `Set ${missing.join(", ")}.` : "Required values exist; external connections still need verification." });
  return missing.length === 0;
}
function urlFor(value: string) {
  const url = new URL(/^https?:\/\//.test(value) ? value : `${/^(localhost|127\.0\.0\.1)(:|$)/.test(value) ? "http" : "https"}://${value}`);
  if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)) throw new Error("Service URLs must be HTTP(S) without embedded credentials, query, or fragment.");
  return url.toString().replace(/\/+$/, "");
}
function gatewayUrl() {
  if (env("ARCADE_MCP_URL")) return urlFor(env("ARCADE_MCP_URL"));
  if (!/^[A-Za-z0-9_-]+$/.test(env("ARCADE_GATEWAY_ID"))) throw new Error("ARCADE_GATEWAY_ID must be the configured gateway slug.");
  return `https://api.arcade.dev/mcp/${env("ARCADE_GATEWAY_ID")}`;
}
function liveEndpoints(report: Report, addresses: string[]) {
  const invalid = addresses.filter(address => {
    try {
      const url = new URL(urlFor(address));
      return url.protocol !== "https:" || /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(url.hostname) || /\.(test|invalid|localhost|local)$/.test(url.hostname);
    } catch { return true; }
  });
  if (invalid.length) report.checks.push({ boundary: "live_endpoints", status: "failed", detail: "Live proof excludes local, private, test and non-HTTPS endpoints. No local substitute can qualify." });
  return !invalid.length;
}
async function jsonRequest(base: string, path: string, token = "", body?: unknown, method?: "PUT") {
  const response = await fetch(`${urlFor(base)}${path}`, { method: method ?? (body === undefined ? "GET" : "POST"), redirect: "error", signal: AbortSignal.timeout(8000), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`${path.split("?")[0]} returned HTTP ${response.status}.`);
  return await response.json() as any;
}
async function check(report: Report, boundary: string, action: () => Promise<string>) {
  try { report.checks.push({ boundary, status: "verified", detail: await action() }); }
  catch (error) { report.checks.push({ boundary, status: "failed", detail: error instanceof Error ? error.message : "Check failed." }); }
}
async function withGateway<T>(userId: string, action: (client: any, require: ReturnType<typeof createRequire>) => Promise<T>) {
  if (!/^[^@\s]+@[^@\s]+$/.test(userId)) throw new Error("The configured gateway identity must be an email address.");
  const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const { MCPClient } = require("@mastra/mcp");
  const url = new URL(gatewayUrl());
  const client = new MCPClient({ servers: { arcade: { url, allowedHosts: [url.host], forwardInstructions: false, requestInit: { headers: { Authorization: `Bearer ${env("ARCADE_API_KEY")}`, "Arcade-User-ID": userId } } } }, timeout: 30000 });
  client.__setLogger(require("@mastra/core/logger").noopLogger);
  try { return await action(client, require); } finally { await client.disconnect(); }
}
async function discoveredTools(userId = env("PERSONA_DANA_EMAIL")) {
  return withGateway(userId, async client => {
    const result = await client.listToolDefinitionsWithErrors({ perServerTimeoutMs: 8000 });
    if (Object.keys(result.errors ?? {}).length) throw new Error("Gateway MCP discovery failed. Check the gateway connection and consent in Arcade.");
    const tools = Object.values(result.definitions.arcade ?? {}) as Array<{ name: string; description?: string; inputSchema?: unknown }>;
    if (!tools.length) throw new Error("Gateway discovery returned no usable tools. Connect Elastic and retry; no tool names were guessed.");
    return tools.map(({ name, description }) => ({ name, description }));
  });
}
function elasticHookTools(): Array<{ toolkit: string; name: string; arguments: string[] }> {
  const tools = JSON.parse(env("ARCADE_ELASTIC_HOOK_TOOLS"));
  if (!Array.isArray(tools) || !tools.length || tools.some(t => !t || typeof t.toolkit !== "string" || !t.toolkit || typeof t.name !== "string" || !t.name || !Array.isArray(t.arguments) || t.arguments.some((a: unknown) => typeof a !== "string" || !a))) throw new Error("ARCADE_ELASTIC_HOOK_TOOLS must contain explicit {toolkit,name,arguments:[]} identities from hook payloads.");
  return tools;
}
function modelConfig(report: Report) {
  const model = env("MODEL_ID") || "anthropic/claude-sonnet-4-6";
  const provider = model.split("/")[0];
  const key = ({ anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" } as Record<string, string>)[provider!];
  if (!key) { report.checks.push({ boundary: "model_configuration", status: "missing", detail: `MODEL_ID provider ${provider} is not checked by this CLI. Configure a supported provider or verify it separately.` }); return false; }
  return requireConfig(report, [key]);
}
function finish(report: Report, live = false) {
  report.status = report.checks.some(c => c.status === "failed") ? "failed" : report.checks.some(c => c.status === "missing") || live && report.checks.some(c => c.status === "unexercised") ? "incomplete" : "configured";
  return report;
}
async function readiness(options: Options): Promise<Report> {
  allowed(options, ["stage", "live"]);
  const current = stage(options);
  const report: Report = { command: "readiness", stage: current, status: "incomplete", live_proof: false, checks: [] };
  modelConfig(report);
  report.checks.push({ boundary: "model_execution", status: "unexercised", detail: "Readiness does not execute an agent. Complete a run, then collect its capstone evidence." });
  if (current !== "supplied" && requireConfig(report, ["ARCADE_API_KEY", env("ARCADE_MCP_URL") ? "ARCADE_MCP_URL" : "ARCADE_GATEWAY_ID", "PERSONA_DANA_EMAIL", "ARCADE_ELASTIC_TOOL_NAMES", ...(current === "governed" ? requiredToolEnv : [])]) && (!options.live || liveEndpoints(report, [gatewayUrl()]))) {
    await check(report, "gateway_discovery", async () => {
      const observed = await discoveredTools();
      if (!values(env("ARCADE_ELASTIC_TOOL_NAMES")).length) throw new Error("Select at least one exact observed Elastic tool name.");
      const expected = [...values(env("ARCADE_ELASTIC_TOOL_NAMES")), ...(current === "governed" ? requiredToolEnv.map(env) : [])];
      const missing = expected.filter(name => !observed.some(tool => tool.name === name));
      if (missing.length) throw new Error(`Configured tools absent from actual discovery: ${missing.join(", ")}.`);
      return `${observed.length} tools observed; all ${expected.length} configured stage tools exist. No tool was executed.`;
    });
  }
  if (current === "governed") {
    const configured = requireConfig(report, ["HOOKS_PUBLIC_HOST", "WEB_PUBLIC_ORIGIN", "IDP_PUBLIC_HOST", "LEAD_APP_PUBLIC_HOST", "WORKSHOP_OPERATOR_TOKEN", "LEAD_INTERNAL_TOKEN", "WEB_SERVICE_TOKEN", "APPROVALS_SERVICE_TOKEN", "MASTRA_DB_URL", "WEB_OAUTH_CLIENT_ID", "WEB_OAUTH_CLIENT_SECRET", "WEB_SESSION_SECRET", "PERSONA_RILEY_EMAIL", "PERSONA_SAM_EMAIL", "PERSONA_MORGAN_EMAIL", "WORKSHOP_VERIFICATION_USER_ID", "ARCADE_ELASTIC_HOOK_TOOLS"]);
    if (configured && (!options.live || liveEndpoints(report, [env("HOOKS_PUBLIC_HOST"), env("WEB_PUBLIC_ORIGIN"), env("IDP_PUBLIC_HOST"), env("LEAD_APP_PUBLIC_HOST")]))) {
      await check(report, "hook_tool_configuration", async () => `${elasticHookTools().length} explicit Elastic hook identities configured; these are separate from MCP tool names.`);
      for (const [owner, address] of [["hooks", "HOOKS_PUBLIC_HOST"], ["web", "WEB_PUBLIC_ORIGIN"], ["idp", "IDP_PUBLIC_HOST"], ["lead", "LEAD_APP_PUBLIC_HOST"]]) {
        await check(report, `${owner}_health`, async () => {
          const response = await jsonRequest(env(address!), "/health");
          if (response.status !== "ok") throw new Error(`${owner} did not report healthy.`);
          return `${owner} answered its health endpoint. This does not prove OAuth consent or a tool execution.`;
        });
      }
      await check(report, "active_policy", async () => {
        const policy = await jsonRequest(env("HOOKS_PUBLIC_HOST"), "/operator/policy", env("WORKSHOP_OPERATOR_TOKEN"));
        if (!policy.active || !policy.verified_denial || !policy.verified_filter) throw new Error("The gateway policy is staged. Complete observed denial/filter checks and activate it before governed exercises.");
        return "The hooks owner reports an active policy with verified denial and filter flags.";
      });
      await check(report, "lead_value", async () => {
        const value = await jsonRequest(env("LEAD_APP_PUBLIC_HOST"), "/internal/accounts/ACC-2291/value", env("LEAD_INTERNAL_TOKEN"));
        if (value.account_id !== "ACC-2291" || value.list_price !== 12000) throw new Error("Northwind's authoritative value differs from the 12000 workshop baseline; reset before the exercise.");
        return "The Sales owner authenticated the internal reader and returned Northwind's authoritative 12000 value.";
      });
      report.checks.push({ boundary: "oauth_and_slack", status: "unexercised", detail: "A readiness probe does not establish OAuth consent or Slack delivery. Complete the authenticated exercise and inspect its evidence." });
    }
  }
  if (env("WORKSHOP_ELASTIC_MODE") === "shared-read-only" && current !== "supplied") {
    finish(report, options.live === true);
    report.status = "degraded";
    report.checks.push({ boundary: "owned_elastic_fixture", status: "unexercised", detail: "Shared read-only context does not prove the attendee's owned fixture setup." });
    return report;
  }
  return finish(report, options.live === true);
}

async function discover(options: Options): Promise<Report> {
  allowed(options, ["output", "elastic-tools", "identity"]);
  if (options.identity && !["attendee", "verification"].includes(String(options.identity))) throw new Error("Identity must be attendee or verification.");
  const identityEnv = options.identity === "verification" ? "WORKSHOP_VERIFICATION_USER_ID" : "PERSONA_DANA_EMAIL";
  const report: Report = { command: "discover", status: "incomplete", live_proof: false, checks: [] };
  if (!requireConfig(report, ["ARCADE_API_KEY", env("ARCADE_MCP_URL") ? "ARCADE_MCP_URL" : "ARCADE_GATEWAY_ID", identityEnv])) return report;
  const observed = await discoveredTools(env(identityEnv));
  report.observed = observed;
  const selected = values(String(options["elastic-tools"] ?? (options.identity === "verification" ? "" : env("ARCADE_ELASTIC_TOOL_NAMES"))));
  if (!selected.length) {
    if (!options.output) { report.status = "inventory"; report.checks.push({ boundary: "gateway_discovery", status: "verified", detail: "Inventory only. Select exact Elastic names with --elastic-tools before writing configuration; no tool was executed." }); return report; }
    report.checks.push({ boundary: "tool_selection", status: "missing", detail: "Choose Elastic tools from this inventory with --elastic-tools exactName1,exactName2. No tool names were inferred." });
    return report;
  }
  const configuration: Record<string, string> = { ARCADE_ELASTIC_TOOL_NAMES: selected.join(",") };
  for (const key of requiredToolEnv) if (env(key)) configuration[key] = env(key);
  const missing = [...selected, ...requiredToolEnv.map(env).filter(Boolean)].filter(name => !observed.some(tool => tool.name === name));
  if (missing.length) throw new Error(`Selected tool names were not observed: ${missing.join(", ")}. No configuration written.`);
  const configuredHookTools = env("ARCADE_ELASTIC_HOOK_TOOLS");
  if (configuredHookTools && JSON.stringify(JSON.parse(configuredHookTools)) !== "[]") {
    // MCP names and hook identities are different namespaces. The operator supplies the
    // latter from observed hook payloads; this command never normalizes one into another.
    const hookTools = elasticHookTools();
    configuration.ARCADE_ELASTIC_HOOK_TOOLS = JSON.stringify(hookTools);
  }
  report.configuration = configuration;
  report.observed_at = new Date().toISOString();
  report.status = "observed";
  report.checks.push({ boundary: "gateway_discovery", status: "verified", detail: `${observed.length} actual MCP tools observed. Selected names match exactly; no tool was executed.` });
  if (options.output) {
    const output = String(options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    report.output = output;
  }
  return report;
}

function variant(options: Options): FixtureVariant {
  if (options.variant !== "clean" && options.variant !== "governed") throw new Error("Choose --variant clean or --variant governed explicitly.");
  return options.variant;
}
async function seed(options: Options): Promise<Report> {
  allowed(options, ["variant"]);
  const selected = variant(options);
  const report: Report = { command: "seed", variant: selected, status: "incomplete", live_proof: false, checks: [] };
  if (env("WORKSHOP_ELASTIC_MODE") === "shared-read-only") return { ...report, status: "degraded", checks: [{ boundary: "elastic_fixture", status: "unexercised", detail: "Shared read-only Elastic mode cannot seed or prove the governed fixture. Use a participant-owned index." }] };
  if (!requireConfig(report, ["ELASTICSEARCH_URL", "ELASTIC_API_KEY", ...(selected === "governed" ? ["HOOKS_PUBLIC_HOST", "WORKSHOP_OPERATOR_TOKEN"] : [])])) return report;
  if (selected === "governed") {
    const state = await jsonRequest(env("HOOKS_PUBLIC_HOST"), "/operator/policy", env("WORKSHOP_OPERATOR_TOKEN"));
    if (!state.active || !state.verified_denial || !state.verified_filter) throw new Error("Governed fixture requires an activated gateway policy with verified denial and filtering. Keep the clean fixture until then.");
  }
  const config = configFromEnv();
  await seedElastic(config, selected);
  report.count = await verifyElastic(config, selected);
  report.index = config.index;
  report.status = "seeded";
  report.checks.push({ boundary: "elastic_fixture", status: "verified", detail: `Eight ${selected} documents read back with their exact IDs, dates, evidence and marker partition.` });
  return report;
}

async function reset(options: Options): Promise<Report> {
  allowed(options, ["variant"]);
  if (variant(options) !== "clean") throw new Error("Reset restores --variant clean. Seed governed after verifying gateway protection.");
  const report: Report = { command: "reset", variant: "clean", status: "incomplete", live_proof: false, checks: [], owners: {} };
  if (env("WORKSHOP_ELASTIC_MODE") === "shared-read-only") return { ...report, status: "degraded", checks: [{ boundary: "elastic_fixture", status: "unexercised", detail: "Shared read-only mode cannot restore the full baseline. No owner was reset." }] };
  if (!requireConfig(report, ["ELASTICSEARCH_URL", "ELASTIC_API_KEY", "HOOKS_PUBLIC_HOST", "WEB_PUBLIC_ORIGIN", "IDP_PUBLIC_HOST", "LEAD_APP_PUBLIC_HOST", "WORKSHOP_OPERATOR_TOKEN", "LEAD_INTERNAL_TOKEN"])) return report;
  const config = configFromEnv();
  validateElasticConfig(config);
  const owners = report.owners as Record<string, any>;
  const steps: Array<[string, () => Promise<any>, (value: any) => boolean]> = [
    ["hooks", () => jsonRequest(env("HOOKS_PUBLIC_HOST"), "/operator/reset", env("WORKSHOP_OPERATOR_TOKEN"), {}), value => value.reset === true && value.active === false && Number.isInteger(value.reset_epoch) && value.reset_epoch > 0],
    ["web", () => jsonRequest(env("WEB_PUBLIC_ORIGIN"), "/api/operator/reset", env("WORKSHOP_OPERATOR_TOKEN"), { reset_epoch: owners.hooks.reset_epoch }), value => value.reset === true && Number.isInteger(value.deleted_snapshots) && value.deleted_snapshots >= 0],
    ["sales", () => jsonRequest(env("LEAD_APP_PUBLIC_HOST"), "/internal/reset", env("LEAD_INTERNAL_TOKEN"), {}), value => value.accounts > 0 && value.offers === 0 && value.follow_up_emails === 0 && value.decisions === 0 && value.operations === 0],
    ["idp", () => jsonRequest(env("IDP_PUBLIC_HOST"), "/internal/reset", env("WORKSHOP_OPERATOR_TOKEN"), {}), value => value.reset === true && value.people >= 4 && value.oauth_clients_preserved === 2],
    ["elastic", async () => ({ documents: await resetElastic(config), variant: "clean" }), value => value.documents === 8],
  ];
  for (const [owner, action, valid] of steps) {
    try {
      const result = await action();
      if (!valid(result)) throw new Error(`${owner} did not acknowledge its complete reset contract.`);
      owners[owner] = result;
      report.checks.push({ boundary: `${owner}_reset`, status: "verified", detail: `${owner} acknowledged its reset.` });
    } catch (error) {
      report.checks.push({ boundary: `${owner}_reset`, status: "failed", detail: error instanceof Error ? error.message : "Reset failed." });
      report.status = "incomplete";
      report.recovery = "Reset stopped at this owner. Earlier acknowledged changes remain; fix the failed owner and rerun. A partial reset is not a clean baseline.";
      return report;
    }
  }
  report.status = "reset";
  report.browser = "Sign in again after reset. Tokens were cleared; both OAuth clients were preserved.";
  return report;
}

async function setup(options: Options): Promise<Report> {
  allowed(options, ["stage", "output", "elastic-tools"]);
  const current = stage(options);
  const report: Report = { command: "setup", stage: current, status: "guide", connected: false, live_proof: false, checks: [], steps: [] };
  const steps = report.steps as string[];
  steps.push("Copy .env.example to .env; keep credentials server-side. Complete model signup and run the supplied-input exercise in docs/modules/01-mastra.md.");
  if (current !== "supplied") {
    steps.push("Create your Elastic project and native search tool using elastic/README.md and docs/modules/02-elastic.md. Seed the clean fixture with bun scripts/workshop.ts seed --variant clean.");
    steps.push("In docs/modules/03-arcade.md, sign up for Arcade, connect Elastic's native MCP server to your gateway, and complete your own consent. Run discover and select exact observed Elastic names; the same agent can then return cited source records.");
    steps.push("Use bun scripts/workshop.ts readiness --stage elastic to check configured tool discovery. Its configured status does not claim an agent execution.");
    if (options.output) {
      const selection = await discover({ output: options.output, ...(options["elastic-tools"] ? { "elastic-tools": options["elastic-tools"] } : {}) });
      report.discovery = selection;
      if (selection.status !== "observed") report.status = "incomplete";
    }
  }
  if (current === "governed") {
    steps.push("Provision the IdP, sales, hooks and web services using render.yaml and persistent disks. Preserve the IdP's two OAuth clients; configure distinct service bearers and the web OAuth callback/session secret.");
    steps.push("Use your actual Arcade email for Dana. Sign in separately as seeded Riley to approve. Join Thierry's workshop Slack workspace; configure the explicit solo self-DM mapping and authorize Slack as Dana. A received link grants no decision authority.");
    steps.push("Deploy only tools/lead. Supply observed Sales MCP keys and ARCADE_ELASTIC_HOOK_TOOLS. Run discover --identity verification, verify-governance --read-tool EXACT_GET_ACCOUNT_NAME, then activate. The web and hooks services own approvals; there is no Approvals MCP deployment.");
    steps.push("Complete the exercise in docs/modules/04-capstone.md. Collect an existing run with capstone --run-id ID; no CLI proof command sends messages or executes the agent. Reset --variant clean restores all state owners afterward.");
  }
  return report;
}

async function capstone(options: Options): Promise<Report> {
  allowed(options, ["run-id", "output", "live"]);
  const runId = String(options["run-id"] ?? "");
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runId) || runId === "." || runId === "..") throw new Error("Supply a safe --run-id for the existing governed run.");
  const directory = String(options.output ?? join(env("WORKSHOP_EVIDENCE_DIR") || ".workshop-evidence", runId));
  const report: Report = { command: "capstone", run_id: runId, status: "incomplete", live_proof: false, live_requested: options.live === true, observed_at: new Date().toISOString(), checks: [], artifacts: [], excluded: ["Local controlled tests are not live proof.", "This command does not run an agent, send a message, grant permission, or measure workshop timing."] };
  const configured = requireConfig(report, ["HOOKS_PUBLIC_HOST", "WORKSHOP_OPERATOR_TOKEN", "LEAD_APP_PUBLIC_HOST", "LEAD_INTERNAL_TOKEN", "PERSONA_DANA_EMAIL", "PERSONA_RILEY_EMAIL", "ARCADE_ELASTIC_TOOL_NAMES", "ARCADE_ELASTIC_HOOK_TOOLS", "ARCADE_DISCOUNT_TOOL_NAME", "ARCADE_GET_OFFER_TOOL_NAME", ...(options.live ? ["ARCADE_API_KEY", env("ARCADE_MCP_URL") ? "ARCADE_MCP_URL" : "ARCADE_GATEWAY_ID"] : [])]);
  await mkdir(directory, { recursive: true });
  if (configured && (!options.live || liveEndpoints(report, [env("HOOKS_PUBLIC_HOST"), env("LEAD_APP_PUBLIC_HOST"), gatewayUrl()]))) {
    await check(report, "owner_evidence", async () => {
      const evidence = await jsonRequest(env("HOOKS_PUBLIC_HOST"), `/operator/runs/${encodeURIComponent(runId)}/evidence`, env("WORKSHOP_OPERATOR_TOKEN"));
      if (evidence.run?.run_id !== runId) throw new Error("The evidence owner returned a different run. No foreign artifacts were retained.");
      const key = evidence.run?.operation_key;
      if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new Error("This run has no valid saved operation key.");
      const receipt = await jsonRequest(env("LEAD_APP_PUBLIC_HOST"), `/internal/operations/${encodeURIComponent(key)}`, env("LEAD_INTERNAL_TOKEN"));
      const hookTools = elasticHookTools();
      report.checks.push(...verifyEvidence(evidence, receipt, { runId, dana: env("PERSONA_DANA_EMAIL"), riley: env("PERSONA_RILEY_EMAIL"), discountName: env("ARCADE_DISCOUNT_TOOL_NAME"), discountHook: `${env("ARCADE_SALES_TOOLKIT") || "Sales"}.CreateDiscountedOffer`, getOfferName: env("ARCADE_GET_OFFER_TOOL_NAME"), getOfferHook: `${env("ARCADE_SALES_TOOLKIT") || "Sales"}.GetOffer`, elasticNames: values(env("ARCADE_ELASTIC_TOOL_NAMES")), elasticHooks: hookTools.map(t => `${t.toolkit}.${t.name}`) }));
      report.request_id = evidence.run.request_id;
      report.operation_key = key;
      report.proof_scope = "recorded_service_evidence";
      const context = { run_id: runId, request_id: evidence.run.request_id, operation_key: key };
      const artifacts: Array<{ file: string; sha256: string }> = [];
      const { body: _body, ...publicReceipt } = receipt;
      const data: Array<[string, unknown]> = [["run.json", { ...evidence.run, action: evidence.action }], ["gateway-audit.json", { denial: evidence.denial, events: evidence.events }], ["approval.json", evidence.approval], ["operation-receipt.json", { ...publicReceipt, receipt_binding_hash: hash({ actor: receipt.actor, action: receipt.action, account_id: receipt.account_id, body: receipt.body }) }]];
      for (const [file, value] of data) {
        const contents = JSON.stringify({ ...context, data: safeArtifact(value) }, null, 2) + "\n";
        await writeFile(join(directory, file), contents, { mode: 0o600 });
        artifacts.push({ file, sha256: createHash("sha256").update(contents).digest("hex") });
      }
      report.artifacts = artifacts;
      return "Read the existing run, safe audit, approval and Sales operation receipt. No write or tool execution was requested.";
    });
  }
  if (options.live) {
    report.checks.push({ boundary: "live_provenance", status: "unexercised", detail: "The current service evidence does not independently attest cloud gateway execution, model provider provenance or the remote Slack receipt. Stored acknowledgements alone cannot certify a live capstone; retain this manifest and verify those boundaries separately." });
  }
  if (env("WORKSHOP_ELASTIC_MODE") === "shared-read-only") {
    report.status = "degraded";
    report.checks.push({ boundary: "owned_elastic_fixture", status: "unexercised", detail: "Shared read-only context cannot prove the attendee's governed fixture setup." });
  } else report.status = report.checks.some(c => ["missing", "failed", "unexercised"].includes(c.status)) ? "incomplete" : "passed";
  await writeFile(join(directory, "manifest.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  return { ...report, output: directory };
}

function toolValue(value: any): any {
  if (value?.structuredContent) return value.structuredContent;
  if (Array.isArray(value?.content)) {
    const text = value.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
    try { return JSON.parse(text); } catch { return null; }
  }
  return value;
}

function consentLinks(value: unknown): string[] {
  const matches = JSON.stringify(value)?.match(/https:\/\/[^\s"<>\\]+/g) ?? [];
  return [...new Set(matches.filter(link => {
    try { const url = new URL(link); return !url.username && !url.password && (url.hostname === "arcade.dev" || url.hostname.endsWith(".arcade.dev")); } catch { return false; }
  }))];
}

async function verifyGovernance(options: Options): Promise<Report> {
  allowed(options, ["read-tool"]);
  const readName = String(options["read-tool"] ?? "");
  if (!readName) throw new Error("Supply --read-tool with the exact GetAccount name from discover --identity verification.");
  const report: Report = { command: "verify-governance", status: "incomplete", live_proof: false, checks: [] };
  if (!requireConfig(report, ["ARCADE_API_KEY", env("ARCADE_MCP_URL") ? "ARCADE_MCP_URL" : "ARCADE_GATEWAY_ID", "WORKSHOP_VERIFICATION_USER_ID", "ARCADE_DISCOUNT_TOOL_NAME", "HOOKS_PUBLIC_HOST", "WORKSHOP_OPERATOR_TOKEN"])) return report;
  const operation = `verification:${crypto.randomUUID()}`;
  const path = `/operator/verification?operation_key=${encodeURIComponent(operation)}`;
  const before = await jsonRequest(env("HOOKS_PUBLIC_HOST"), path, env("WORKSHOP_OPERATOR_TOKEN"));
  await jsonRequest(env("HOOKS_PUBLIC_HOST"), "/operator/verification", env("WORKSHOP_OPERATOR_TOKEN"), { operation_key: operation });
  let filterExecutionId = "", denialExecutionId = "";
  await withGateway(env("WORKSHOP_VERIFICATION_USER_ID"), async (client, require) => {
    const definitions = await client.listToolDefinitionsWithErrors({ perServerTimeoutMs: 8000 });
    if (Object.keys(definitions.errors ?? {}).length) throw new Error("Verification identity cannot discover the gateway. Check the setup identity and Arcade registration.");
    const toolsets = await client.listToolsets();
    const tools: Record<string, any> = Object.assign({}, ...Object.values(toolsets));
    if (!tools[readName]?.execute || !tools[env("ARCADE_DISCOUNT_TOOL_NAME")]?.execute) throw new Error("Configured Sales tools were not discovered for the verification identity. Copy exact names from discover --identity verification.");
    const { RequestContext } = require("@mastra/core/request-context");
    const { noopObserve } = require("@mastra/core/tools");
    const execute = async (name: string, args: unknown) => {
      const retainLinks = (value: unknown) => { report.authorizationUrls = [...new Set([...(report.authorizationUrls as string[] ?? []), ...consentLinks(value)])]; };
      try {
        const result = await tools[name].execute(args, { requestContext: new RequestContext(), observe: noopObserve });
        retainLinks(result);
        return { failed: Boolean(result?.isError), value: result };
      } catch (error) {
        retainLinks(error instanceof Error ? { message: error.message, cause: error.cause } : error);
        return { failed: true, value: error instanceof Error ? { message: error.message, cause: error.cause } : error };
      }
    };
    await check(report, "filtered_read", async () => {
      const result = await execute(readName, { account_id: "ACC-2291" });
      const value = toolValue(result.value), after = await jsonRequest(env("HOOKS_PUBLIC_HOST"), path, env("WORKSHOP_OPERATOR_TOKEN"));
      // Mastra retains MCP text beside structured output using a non-enumerable
      // symbol. Inspect that model-facing copy as well as the structured value.
      const { getMcpCallToolContent, getMcpCallToolMeta } = require("@mastra/mcp");
      const representations = { value: result.value, content: getMcpCallToolContent(result.value), meta: getMcpCallToolMeta(result.value) };
      if (result.failed || value?.account_id !== "ACC-2291" || value?.list_price !== 12000 || /api_key|workshop_support_FAKE_|activation_token|workshop_activation_FAKE_|personal_phone|\+1-\d{3}-555-\d{4}|Ignore earlier instructions/.test(JSON.stringify(representations)) || !after.filter?.execution_id || after.filter.execution_id === before.filter?.execution_id) throw new Error("No fresh filtered account read was verified. Complete cg-idp consent as the verification identity in Arcade, then check the post hook and retry.");
      filterExecutionId = after.filter.execution_id;
      return "Actual gateway GetAccount returned Northwind without fixture markers; hooks recorded a new filtered execution.";
    });
    await check(report, "authority_denial", async () => {
      // Empty rationale is a second guard: the Sales API rejects it before
      // creating a draft even when the Arcade pre hook is missing or ignored.
      const result = await execute(env("ARCADE_DISCOUNT_TOOL_NAME"), { account_id: "ACC-2291", discount_percent: 30, list_price: 12000, rationale: "", customer_message: "Your renewal is approaching. The SCIM support issue remains unresolved.", operation_key: operation });
      const after = await jsonRequest(env("HOOKS_PUBLIC_HOST"), path, env("WORKSHOP_OPERATOR_TOKEN"));
      const returned = JSON.stringify(result.value);
      if (!result.failed || !after.denial?.execution_id || after.denial.operation_key !== operation || !returned?.includes(after.denial.denial_id) || !/CHECK_FAILED|exceeds your/.test(returned)) throw new Error("No matching authority denial was returned by the gateway. Check pre-hook enforcement and verification identity consent; the empty-rationale guard prevented a draft.");
      denialExecutionId = after.denial.execution_id;
      return "Actual gateway discount was denied for this unique operation by the authority hook. No approval request, Slack message or business write was created.";
    });
  });
  if (filterExecutionId && denialExecutionId) await check(report, "verification_confirmation", async () => {
    await jsonRequest(env("HOOKS_PUBLIC_HOST"), "/operator/verification/confirm", env("WORKSHOP_OPERATOR_TOKEN"), { operation_key: operation, denial_execution_id: denialExecutionId, filter_execution_id: filterExecutionId });
    return "The operator confirmed the filtered read and matching authority rejection received through the gateway. Activation is now available.";
  });
  finish(report);
  if (report.status === "configured") report.status = "passed";
  return report;
}

async function activate(options: Options): Promise<Report> {
  allowed(options, []);
  const report: Report = { command: "activate", status: "incomplete", live_proof: false, checks: [] };
  if (!requireConfig(report, ["HOOKS_PUBLIC_HOST", "WORKSHOP_OPERATOR_TOKEN"])) return report;
  await check(report, "policy_activation", async () => {
    const state = await jsonRequest(env("HOOKS_PUBLIC_HOST"), "/operator/activate", env("WORKSHOP_OPERATOR_TOKEN"), {});
    if (!state.active || !state.verified_denial || !state.verified_filter) throw new Error("Complete verify-governance before activation.");
    return "Verified governance is active. Continue with attendee discovery and seed --variant governed.";
  });
  finish(report);
  if (report.status === "configured") report.status = "activated";
  return report;
}

async function hookTools(options: Options): Promise<Report> {
  allowed(options, []);
  const report: Report = { command: "hook-tools", status: "incomplete", live_proof: false, checks: [] };
  if (!requireConfig(report, ["HOOKS_PUBLIC_HOST", "WORKSHOP_OPERATOR_TOKEN"])) return report;
  await check(report, "observed_hook_metadata", async () => {
    const observed = await jsonRequest(env("HOOKS_PUBLIC_HOST"), "/operator/observed-tools", env("WORKSHOP_OPERATOR_TOKEN"));
    if (!Array.isArray(observed.tools) || observed.tools.some((tool: any) => !tool || typeof tool.toolkit !== "string" || typeof tool.name !== "string" || !Array.isArray(tool.arguments) || tool.arguments.some((key: unknown) => typeof key !== "string"))) throw new Error("Hooks returned invalid observed metadata.");
    report.tools = observed.tools.map(({ toolkit, name, arguments: args }: { toolkit: string; name: string; arguments: string[] }) => ({ toolkit, name, arguments: args }));
    return "Actual authenticated hook metadata only. Copy the selected Elastic entries to ARCADE_ELASTIC_HOOK_TOOLS; an empty arguments list may need one tool invocation to observe its keys.";
  });
  finish(report);
  if (report.status === "configured") report.status = "inventory";
  return report;
}


async function hookLab(options: Options): Promise<Report> {
  const action = String(options.action ?? ""), toolkit = env("ARCADE_SALES_TOOLKIT") || "Sales";
  if (!["init", "test", "apply", "verify"].includes(action)) throw new Error("Use hook-lab init, test, apply, or verify.");
  allowed(options, ["action", ...(action === "init" ? ["output"] : action === "verify" ? ["read-tool"] : ["file"])]);
  const report: Report = { command: "hook-lab", action, status: "incomplete", live_proof: false, proof_scope: action === "verify" ? "gateway_read" : action === "apply" ? "policy_update" : "local_fixture", checks: [] };
  if (action === "init") {
    if (!options.output) throw new Error("Supply --output for the starter rule JSON file.");
    const file = String(options.output);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(starterRule(toolkit), null, 2) + "\n", { mode: 0o600, flag: "wx" });
    return { ...report, status: "guide", output: file, detail: "Starter saved. Run test, add the internal contact field removal, then test again." };
  }
  if (action === "test" || action === "apply") {
    if (!options.file) throw new Error("Supply --file with your lab rule JSON file.");
    let value: unknown;
    try { value = JSON.parse(await readFile(String(options.file), "utf8")); } catch { throw new Error("The lab rule file could not be read as JSON."); }
    const rule = testRule(value, toolkit);
    report.checks.push({ boundary: "local_fixture", status: "verified", detail: "The production output filter removed the internal support contact and retained the account, renewal, unresolved issue and commercial fields. No gateway was called." });
    if (action === "test") return { ...report, status: "passed" };
    if (!requireConfig(report, ["HOOKS_PUBLIC_HOST", "WORKSHOP_OPERATOR_TOKEN"])) return report;
    const policy = await jsonRequest(env("HOOKS_PUBLIC_HOST"), "/operator/policy", env("WORKSHOP_OPERATOR_TOKEN"));
    const candidate = policyWithRule(policy, rule);
    if (candidate) await jsonRequest(env("HOOKS_PUBLIC_HOST"), "/operator/policy", env("WORKSHOP_OPERATOR_TOKEN"), candidate, "PUT");
    report.checks.push({ boundary: "operator_policy", status: "verified", detail: candidate ? "Saved the lab rule using the current policy version; preserved subjects, authority rules and every other output rule." : "The same lab rule is already saved; policy version was unchanged." });
    return { ...report, status: "passed", rule_id: LAB_RULE_ID, changed: candidate !== null };
  }
  const readName = String(options["read-tool"] ?? "");
  if (!readName) throw new Error("Supply --read-tool with the exact GetAccount name observed by attendee discovery.");
  if (!requireConfig(report, ["ARCADE_API_KEY", env("ARCADE_MCP_URL") ? "ARCADE_MCP_URL" : "ARCADE_GATEWAY_ID", "PERSONA_DANA_EMAIL"])) return report;
  const hostname = new URL(gatewayUrl()).hostname;
  report.connection_scope = /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(hostname) || /\.(test|invalid|localhost|local)$/.test(hostname) ? "local" : "remote";
  await check(report, "gateway_read", async () => withGateway(env("PERSONA_DANA_EMAIL"), async (client, require) => {
    const discovered = await client.listToolDefinitionsWithErrors({ perServerTimeoutMs: 8000 });
    if (Object.keys(discovered.errors ?? {}).length) throw new Error("Gateway discovery failed; no read was verified.");
    const tools: Record<string, any> = Object.assign({}, ...Object.values(await client.listToolsets()));
    if (!tools[readName]?.execute) throw new Error("The supplied read tool was not observed in attendee gateway discovery. No tool was called.");
    const { RequestContext } = require("@mastra/core/request-context"), { noopObserve } = require("@mastra/core/tools");
    let result: any;
    try { result = await tools[readName].execute({ account_id: "ACC-2291" }, { requestContext: new RequestContext(), observe: noopObserve }); }
    catch (error) { report.authorizationUrls = consentLinks(error instanceof Error ? { message: error.message, cause: error.cause } : error); throw new Error("The gateway account read failed. Complete Dana's delegated Sales consent and check the gateway hooks."); }
    report.authorizationUrls = consentLinks(result);
    if (result?.isError) throw new Error("The gateway returned a tool error; no account read was verified.");
    const { getMcpCallToolContent, getMcpCallToolMeta } = require("@mastra/mcp");
    verifyRead(toolValue(result), { value: result, content: getMcpCallToolContent(result), meta: getMcpCallToolMeta(result) });
    return "An actual gateway account read as Dana retained renewal, unresolved support issue and price while removing internal contact and credentials. This verifies the read only, not approval or Slack delivery.";
  }));
  finish(report);
  if (report.status === "configured") report.status = "passed";
  return report;
}

async function main() {
  const { command, options } = parse(process.argv.slice(2));
  if (env("WORKSHOP_ELASTIC_MODE") && !["owned", "shared-read-only"].includes(env("WORKSHOP_ELASTIC_MODE"))) throw new Error("WORKSHOP_ELASTIC_MODE must be owned or shared-read-only.");
  if (command === "readiness") return readiness(options);
  if (command === "discover") return discover(options);
  if (command === "seed") return seed(options);
  if (command === "reset") return reset(options);
  if (command === "capstone") return capstone(options);
  if (command === "setup") return setup(options);
  if (command === "verify-governance") return verifyGovernance(options);
  if (command === "activate") return activate(options);
  if (command === "hook-tools") return hookTools(options);
  if (command === "hook-lab") return hookLab(options);
  throw new Error(`Unknown command ${command}. Use setup, readiness, discover, hook-tools, hook-lab, verify-governance, activate, seed, reset, or capstone.`);
}

if (import.meta.main) {
  try {
    const result = await main();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = ["configured", "passed", "observed", "inventory", "activated", "seeded", "reset", "guide"].includes(result.status) ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ command: process.argv[2] ?? "setup", status: "failed", live_proof: false, error: error instanceof Error ? error.message : "Command failed." }, null, 2));
    process.exitCode = 1;
  }
}
