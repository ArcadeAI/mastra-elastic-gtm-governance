#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { configFromEnv, seedElastic, verifyElastic, resetElastic, validateElasticConfig, type FixtureVariant } from "./seed-elastic";
import { hash, safeArtifact, verifyEvidence } from "./workshop-evidence";

type Check = { boundary: string; status: "verified" | "configured" | "missing" | "failed" | "unexercised"; detail: string };
type Report = { command: string; status: string; live_proof: boolean; checks: Check[]; [name: string]: unknown };
type Options = Record<string, string | boolean>;
const requiredToolEnv = ["ARCADE_ROUTE_TOOL_NAME", "ARCADE_CLASSIFY_TOOL_NAME", "ARCADE_REQUEST_APPROVAL_TOOL_NAME", "ARCADE_DECIDE_TOOL_NAME"];
const env = (name: string) => process.env[name]?.trim() || "";
const values = (value: string) => [...new Set(value.split(",").map(s => s.trim()).filter(Boolean))];

function parse(args: string[]) {
  const command = args.shift() ?? "setup";
  const options: Options = {};
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
async function jsonRequest(base: string, path: string, token = "", body?: unknown) {
  const response = await fetch(`${urlFor(base)}${path}`, { method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(8000), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`${path.split("?")[0]} returned HTTP ${response.status}.`);
  return await response.json() as any;
}
async function check(report: Report, boundary: string, action: () => Promise<string>) {
  try { report.checks.push({ boundary, status: "verified", detail: await action() }); }
  catch (error) { report.checks.push({ boundary, status: "failed", detail: error instanceof Error ? error.message : "Check failed." }); }
}
async function discoveredTools() {
  if (!/^[^@\s]+@[^@\s]+$/.test(env("PERSONA_DANA_EMAIL"))) throw new Error("PERSONA_DANA_EMAIL must be the attendee's Arcade account email.");
  const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const { MCPClient } = require("@mastra/mcp");
  const url = new URL(gatewayUrl());
  const client = new MCPClient({ servers: { arcade: { url, allowedHosts: [url.host], forwardInstructions: false, requestInit: { headers: { Authorization: `Bearer ${env("ARCADE_API_KEY")}`, "Arcade-User-ID": env("PERSONA_DANA_EMAIL") } } } }, timeout: 10000 });
  try {
    const result = await client.listToolDefinitionsWithErrors({ perServerTimeoutMs: 8000 });
    if (Object.keys(result.errors ?? {}).length) throw new Error("Gateway MCP discovery failed. Check the gateway connection and consent in Arcade.");
    const tools = Object.values(result.definitions.arcade ?? {}) as Array<{ name: string; description?: string; inputSchema?: unknown }>;
    if (!tools.length) throw new Error("Gateway discovery returned no usable tools. Connect Elastic and retry; no tool names were guessed.");
    return tools.map(({ name, description }) => ({ name, description }));
  } finally { await client.disconnect(); }
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
        const value = await jsonRequest(env("LEAD_APP_PUBLIC_HOST"), "/internal/leads/LD-2291/value", env("LEAD_INTERNAL_TOKEN"));
        if (value.lead_id !== "LD-2291" || value.estimated_acv !== 95000) throw new Error("Northwind's authoritative value differs from the 95000 workshop baseline; reset before the exercise.");
        return "The Lead owner authenticated the internal reader and returned Northwind's authoritative 95000 value.";
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
  allowed(options, ["output", "elastic-tools"]);
  const report: Report = { command: "discover", status: "incomplete", live_proof: false, checks: [] };
  if (!requireConfig(report, ["ARCADE_API_KEY", env("ARCADE_MCP_URL") ? "ARCADE_MCP_URL" : "ARCADE_GATEWAY_ID", "PERSONA_DANA_EMAIL"])) return report;
  const observed = await discoveredTools();
  report.observed = observed;
  const selected = values(String(options["elastic-tools"] ?? env("ARCADE_ELASTIC_TOOL_NAMES")));
  if (!selected.length) {
    report.checks.push({ boundary: "tool_selection", status: "missing", detail: "Choose Elastic tools from this inventory with --elastic-tools exactName1,exactName2. No tool names were inferred." });
    return report;
  }
  const configuration: Record<string, string> = { ARCADE_ELASTIC_TOOL_NAMES: selected.join(",") };
  for (const key of requiredToolEnv) if (env(key)) configuration[key] = env(key);
  const missing = [...selected, ...requiredToolEnv.map(env).filter(Boolean)].filter(name => !observed.some(tool => tool.name === name));
  if (missing.length) throw new Error(`Selected tool names were not observed: ${missing.join(", ")}. No configuration written.`);
  if (env("ARCADE_ELASTIC_HOOK_TOOLS")) {
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
    ["lead", () => jsonRequest(env("LEAD_APP_PUBLIC_HOST"), "/internal/reset", env("LEAD_INTERNAL_TOKEN"), {}), value => value.leads === 9 && value.decisions === 6 && value.operations === 0],
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
    steps.push("Provision the IdP, lead, hooks and web services using render.yaml and persistent disks. Preserve the IdP's two OAuth clients; configure distinct service bearers and the web OAuth callback/session secret.");
    steps.push("Use your actual Arcade email for Dana. Sign in separately as seeded Riley to approve. Join Thierry's workshop Slack workspace; configure the explicit solo self-DM mapping and authorize Slack as Dana. A received link grants no decision authority.");
    steps.push("Supply the observed Lead/Approvals MCP keys and ARCADE_ELASTIC_HOOK_TOOLS from actual hook toolkit/name payloads. Use the verification identity for gateway denial/filter probes; activate policy only after those checks succeed, then seed --variant governed.");
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
  const configured = requireConfig(report, ["HOOKS_PUBLIC_HOST", "WORKSHOP_OPERATOR_TOKEN", "LEAD_APP_PUBLIC_HOST", "LEAD_INTERNAL_TOKEN", "PERSONA_DANA_EMAIL", "PERSONA_RILEY_EMAIL", "ARCADE_ELASTIC_TOOL_NAMES", "ARCADE_ELASTIC_HOOK_TOOLS", "ARCADE_ROUTE_TOOL_NAME", ...(options.live ? ["ARCADE_API_KEY", env("ARCADE_MCP_URL") ? "ARCADE_MCP_URL" : "ARCADE_GATEWAY_ID"] : [])]);
  await mkdir(directory, { recursive: true });
  if (configured && (!options.live || liveEndpoints(report, [env("HOOKS_PUBLIC_HOST"), env("LEAD_APP_PUBLIC_HOST"), gatewayUrl()]))) {
    await check(report, "owner_evidence", async () => {
      const evidence = await jsonRequest(env("HOOKS_PUBLIC_HOST"), `/operator/runs/${encodeURIComponent(runId)}/evidence`, env("WORKSHOP_OPERATOR_TOKEN"));
      if (evidence.run?.run_id !== runId) throw new Error("The evidence owner returned a different run. No foreign artifacts were retained.");
      const key = evidence.run?.operation_key;
      if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new Error("This run has no valid saved operation key.");
      const receipt = await jsonRequest(env("LEAD_APP_PUBLIC_HOST"), `/internal/operations/${encodeURIComponent(key)}`, env("LEAD_INTERNAL_TOKEN"));
      const hookTools = elasticHookTools();
      report.checks.push(...verifyEvidence(evidence, receipt, { runId, dana: env("PERSONA_DANA_EMAIL"), riley: env("PERSONA_RILEY_EMAIL"), routeName: env("ARCADE_ROUTE_TOOL_NAME"), routeHook: `${env("ARCADE_LEAD_TOOLKIT") || "Lead"}.RouteLead`, elasticNames: values(env("ARCADE_ELASTIC_TOOL_NAMES")), elasticHooks: hookTools.map(t => `${t.toolkit}.${t.name}`) }));
      report.request_id = evidence.run.request_id;
      report.operation_key = key;
      report.proof_scope = "recorded_service_evidence";
      const context = { run_id: runId, request_id: evidence.run.request_id, operation_key: key };
      const artifacts: Array<{ file: string; sha256: string }> = [];
      const { body: _body, ...publicReceipt } = receipt;
      const data: Array<[string, unknown]> = [["run.json", { ...evidence.run, action: evidence.action }], ["gateway-audit.json", { denial: evidence.denial, events: evidence.events }], ["approval.json", evidence.approval], ["operation-receipt.json", { ...publicReceipt, receipt_binding_hash: hash({ actor: receipt.actor, action: receipt.action, lead_id: receipt.lead_id, body: receipt.body }) }]];
      for (const [file, value] of data) {
        const contents = JSON.stringify({ ...context, data: safeArtifact(value) }, null, 2) + "\n";
        await writeFile(join(directory, file), contents, { mode: 0o600 });
        artifacts.push({ file, sha256: createHash("sha256").update(contents).digest("hex") });
      }
      report.artifacts = artifacts;
      return "Read the existing run, safe audit, approval and Lead operation receipt. No write or tool execution was requested.";
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

async function main() {
  const { command, options } = parse(process.argv.slice(2));
  if (env("WORKSHOP_ELASTIC_MODE") && !["owned", "shared-read-only"].includes(env("WORKSHOP_ELASTIC_MODE"))) throw new Error("WORKSHOP_ELASTIC_MODE must be owned or shared-read-only.");
  if (command === "readiness") return readiness(options);
  if (command === "discover") return discover(options);
  if (command === "seed") return seed(options);
  if (command === "reset") return reset(options);
  if (command === "capstone") return capstone(options);
  if (command === "setup") return setup(options);
  throw new Error(`Unknown command ${command}. Use setup, readiness, discover, seed, reset, or capstone.`);
}

if (import.meta.main) {
  try {
    const result = await main();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = ["configured", "passed", "observed", "seeded", "reset", "guide"].includes(result.status) ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ command: process.argv[2] ?? "setup", status: "failed", live_proof: false, error: error instanceof Error ? error.message : "Command failed." }, null, 2));
    process.exitCode = 1;
  }
}
