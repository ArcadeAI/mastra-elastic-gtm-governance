/**
 * `bun run setup-arcade <host>` against a stand-in for Arcade's admin API (#9, #30, #48).
 *
 * Never the real API, never the real Arcade CLI, never the real `~/.arcade`.
 *
 * - **The stand-in** answers the routes `scripts/setup-arcade/arcade.ts`
 *   sends, each with the method the official client uses where one exists,
 *   keeps what it is sent, and records every request, so each test can say
 *   exactly what reached "Arcade". **Anything else gets the 404 Arcade itself
 *   answers** for a route or method it does not serve, byte for byte: until #26
 *   this stand-in served `POST /v1/admin/secrets/{key}` because the pinned spec
 *   says POST, and the first live run got that 404 instead. Since #30 it serves
 *   the plugins, hooks and gateways under one org and project, as the live
 *   swagger has them, and still 404s the bare `/v1/plugins` the second live run
 *   was refused. Since #48 it serves only the gateway list: this script never
 *   writes a gateway, and a test puts one there the way the dashboard would.
 * - **The Arcade CLI** is a shell script first on `PATH` that records where it
 *   was run and with what, so `arcade deploy` is observed and never performed.
 * - **The CLI's context** is a `credentials.yaml` in a throwaway `HOME`, in the
 *   shape `arcade_core.config_model.Config` writes, holding fake tokens that
 *   must never be printed.
 *
 * Each test runs the real script in a throwaway project of its own: a git
 * repository whose `.env` is the repo's `.env.example` copied verbatim with only
 * `ARCADE_API_KEY` filled, which is where a developer stands after the
 * Quickstart's `cp .env.example .env`.
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnChild } from "./child.ts";
import { childEnv } from "./child-env.ts";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = join(ROOT, "scripts", "setup-arcade.ts");
const HOST = "template-test.ngrok.app";
const ORIGIN = `https://${HOST}`;
const KEY = "stand-in-project-key";
const CALLBACK = "https://cloud.arcade.dev/api/v1/oauth/stand_in_ap_1/callback";
/** The one org and project the stand-in's key belongs to. */
const ORG = "org_standin";
const PROJECT = "prj_standin";
const SCOPED = `/v1/orgs/${ORG}/projects/${PROJECT}`;
/** The User Source's id as the dashboard would store it on the gateway. setup-arcade never sees or sends one. */
const USER_SOURCE = "us_2standinusersource";
/** What the faked CLI's credentials hold besides the ids: never to be printed. */
const CLI_TOKENS = ["cli-access-token-must-not-leak", "cli-refresh-token-must-not-leak", "cli-api-key-must-not-leak"];

interface Recorded {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

/**
 * What Arcade answered `POST /v1/admin/secrets/APP_PUBLIC_HOST` with, on the
 * human's first live run (#7, 2026-09-25). The same body is Arcade's answer to
 * any route it does not serve, so it is this stand-in's too.
 */
const ROUTE_NOT_FOUND = { name: "route_not_found", message: "requested route is not found or method is not allowed" };

/**
 * What Arcade answered the fourth live run's `POST …/plugins` with, byte for
 * byte (#30, F6): the body sent `health_check_path: "/hooks/health"`.
 */
const HEALTH_CHECK_NOT_A_URL = {
  name: "malformed_request",
  message: "failed to validate request body: webhook_config: health_check_path must be a valid URL",
  field_errors: [{ field: "webhook_config.health_check_path", rule: "url", message: "health_check_path must be a valid URL" }],
};

/** Arcade's `url` rule, as far as anyone has seen it: an absolute http(s) URL. */
function isUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

type Json = Record<string, any>;

/** Arcade's admin API, as far as setup-arcade uses it (the table is on #26's PR; the org routes on #30's). */
class StandIn {
  requests: Recorded[] = [];
  providers = new Map<string, Json>();
  secrets = new Map<string, string>();
  verifier: Json = { verifier_url: "", unsafe_skip_verification: false };
  /** Plugins as stored, bearer token included, which no read ever returns. */
  plugins = new Map<string, Json>();
  /** Hooks, as `schemas.HookResponse`, made from each plugin's endpoints. */
  hooks: Json[] = [];
  /** Gateways as the dashboard made them (`schemas.GatewayResponse`): this stand-in has no route that writes one. */
  gateways = new Map<string, Json>();
  /** When set, a PATCH is stored but its `status` and each endpoint's are not: the plugin reads back as it was. */
  patchIgnoresStatus = false;
  /** When set, a plugin read-back leaves `status` out. */
  omitStatus = false;
  /** When set, the next plugin create answers this instead of creating anything. */
  nextPluginCreate: { status: number; body: Json } | null = null;
  /**
   * What a plugin read-back says `health_check_path` is. `undefined` leaves the
   * field out, which is what real Arcade did on the fourth live run's retry
   * (#30), so it is the default; `"stored"` echoes what was sent.
   */
  healthCheckReadBack: string | undefined = undefined;
  /** When set, a plugin read-back leaves this endpoint's URL out. */
  omitEndpointUrl: string | null = null;
  /** When set, a PUT to the verifier settings is accepted and ignored. */
  verifierIgnoresPut = false;
  /** The servers Arcade already runs, by name, as `GET …/workers/<name>` finds them. */
  workers = new Set<string>();
  /** When set, `GET …/workers/<name>` answers this instead. */
  workerLookup: { status: number; body: Json } | null = null;
  /** When set, the next gateway create answers this instead of creating anything (#52). */
  nextGatewayCreate: { status: number; body: Json } | null = null;
  /** When set, a gateway read-back answers this instead (#52). */
  gatewayReadBack: { status: number; body: Json } | null = null;
  /**
   * The dashboard's behaviour (#48), assumed of the API too, which is the worst
   * case: while the project's hooks are active, a gateway create that names a
   * Loan or Approvals tool is refused as if the tool did not exist. The one-click
   * path creates the gateway before it turns the hooks on, so it must pass with
   * this on; the default is on for that reason (#52).
   */
  activeHooksHideTools = true;

  // --- The Coordinator API (#52) --------------------------------------------
  /**
   * `unavailable` answers every Coordinator call with the 404 the project key
   * got for `…/user_sources` on api.arcade.dev (#7): the #48 suite runs as the
   * fallback, and the one-click tests turn it on.
   */
  coordinatorMode: "unavailable" | "available" = "unavailable";
  /** User Sources as the Coordinator stores them, secret included, which no read returns. */
  userSources = new Map<string, Json>();
  coordinatorRequests: Recorded[] = [];
  /** When set, the next Coordinator call of that method answers this instead. */
  nextCoordinator: Partial<Record<"GET" | "POST", { status: number; body: unknown }>> = {};
  /** When set, a User Source created is kept but left out of every list read back. */
  createdNotListed = false;
  /**
   * The app behind the tunnel: what its `/.well-known/openid-configuration`
   * answers. The Coordinator reads it when it creates a User Source, as the
   * dashboard's form does on save, so a create while it is down is refused.
   */
  tunnel: { status: number; issuer?: string } = { status: 200, issuer: ORIGIN };
  tunnelRequests = 0;
  /** Every request to either stand-in, in order, with which one got it: the ordering proof reads this. */
  timeline: string[] = [];
  /** The callback Arcade generates for the next provider created: one per provider, `…/oauth/<ap_ id>/callback`. */
  nextCallback = CALLBACK;
  /**
   * When set, the tool-secret route answers every method with Arcade's 404, the
   * way the live run's POST was answered: the run stops just after the provider
   * is created, which is the state the human's live project is in (#26).
   */
  secretsLikeTheLiveRun = false;
  private ids = 0;
  // On 127.0.0.1, the address the script is pointed at, not the default
  // 0.0.0.0: macOS lets another process hold 127.0.0.1 on the same port, and
  // it then answers in the stand-in's place (a 403 from somebody else, seen
  // once on #28's full run).
  private readonly server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => this.handle(request) });
  readonly url = `http://127.0.0.1:${this.server.port}`;
  /** Its own host, as `ARCADE_COORDINATOR_URL` names it: under `/api`, like the default `https://cloud.arcade.dev/api`. */
  private readonly coordinatorServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => this.handleCoordinator(request) });
  readonly coordinatorUrl = `http://127.0.0.1:${this.coordinatorServer.port}/api`;
  /** The public host through ngrok, as `CG_SETUP_ARCADE_ISSUER_URL` points the run's check at it. */
  private readonly tunnelServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => this.handleTunnel(request) });
  readonly tunnelUrl = `http://127.0.0.1:${this.tunnelServer.port}`;

  stop(): void {
    this.server.stop(true);
    this.coordinatorServer.stop(true);
    this.tunnelServer.stop(true);
  }

  private handleTunnel(request: Request): Response {
    this.tunnelRequests += 1;
    this.timeline.push(`tunnel ${request.method} ${new URL(request.url).pathname}`);
    if (new URL(request.url).pathname !== "/.well-known/openid-configuration") return new Response("not found", { status: 404 });
    if (this.tunnel.status !== 200) return new Response("ERR_NGROK_8012", { status: this.tunnel.status });
    return Response.json({ issuer: this.tunnel.issuer, jwks_uri: `${this.tunnel.issuer}/api/auth/jwks` });
  }

  /** A User Source as the Coordinator lists it: every field but the secret. */
  private userSourceResponse(stored: Json): Json {
    const { client_secret: _secret, ...shown } = stored;
    return shown;
  }

  private async handleCoordinator(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Json) : undefined;
    this.coordinatorRequests.push({ method: request.method, path: `${url.pathname}${url.search}`, authorization: request.headers.get("authorization"), body });
    this.timeline.push(`coordinator ${request.method} ${url.pathname.replace(/^\/api/, "")}${url.search}`);
    if (request.headers.get("authorization") !== `Bearer ${KEY}`) return Response.json({ message: "unauthorized" }, { status: 401 });
    if (this.coordinatorMode === "unavailable") return Response.json(ROUTE_NOT_FOUND, { status: 404 });
    const route = /^\/api\/v1\/orgs\/([^/]+)\/projects\/([^/]+)\/user_sources$/.exec(url.pathname);
    if (!route) return Response.json(ROUTE_NOT_FOUND, { status: 404 });
    if (route[1] !== ORG || route[2] !== PROJECT) return Response.json({ name: "not_found", message: "project not found" }, { status: 404 });
    const injected = this.nextCoordinator[request.method as "GET" | "POST"];
    if (injected) {
      delete this.nextCoordinator[request.method as "GET" | "POST"];
      return typeof injected.body === "string" ? new Response(injected.body, { status: injected.status }) : Response.json(injected.body, { status: injected.status });
    }
    if (request.method === "GET") {
      const items = [...this.userSources.values()].filter((each) => !(this.createdNotListed && each.created_by_run)).map((each) => this.userSourceResponse(each));
      return Response.json({ items, limit: 20, offset: 0, total_count: items.length });
    }
    if (request.method === "POST") {
      for (const field of ["name", "issuer_url", "client_id", "client_secret"]) {
        if (typeof body?.[field] !== "string" || body[field] === "") {
          return Response.json({ name: "malformed_request", message: `${field} is a required field` }, { status: 400 });
        }
      }
      // What the dashboard's form does on save, and assumed here of the API: the issuer is read through the tunnel.
      if (this.tunnel.status !== 200 || this.tunnel.issuer !== body!.issuer_url) {
        return Response.json({ name: "invalid_issuer", message: `could not read ${body!.issuer_url}/.well-known/openid-configuration` }, { status: 400 });
      }
      const id = `us_standin${++this.ids}`;
      const stored = {
        id,
        name: body!.name,
        description: body!.description ?? "",
        issuer_url: body!.issuer_url,
        client_id: body!.client_id,
        client_secret: body!.client_secret,
        scopes: body!.scopes ?? "openid",
        subject_claim: body!.subject_claim ?? "sub",
        redirect_uri: "https://cloud.arcade.dev/oauth2/intermediate_callback",
        created_by_run: true,
      };
      this.userSources.set(id, stored);
      return Response.json(this.userSourceResponse(stored), { status: 201 });
    }
    return Response.json(ROUTE_NOT_FOUND, { status: 404 });
  }

  /** A plugin as `GET` returns it (`schemas.PluginResponse`): the bearer only as `{ exists }`. */
  private pluginResponse(stored: Json): Json {
    const { token, ...auth } = stored.webhook_config?.auth ?? {};
    const endpoints = Object.fromEntries(
      Object.entries(stored.webhook_config?.endpoints ?? {}).map(([point, endpoint]) => [point, point === this.omitEndpointUrl ? {} : { url: (endpoint as Json).url }]),
    );
    const health = this.healthCheckReadBack === "stored" ? stored.webhook_config?.health_check_path : this.healthCheckReadBack;
    return {
      id: stored.id,
      name: stored.name,
      description: stored.description,
      plugin_type: stored.plugin_type,
      ...(this.omitStatus ? {} : { status: stored.status }),
      health_status: "unknown",
      webhook_config: {
        ...(health === undefined ? {} : { health_check_path: health }),
        auth: { ...auth, token: { exists: typeof token === "string" && token !== "", editable: true, binding: "project" } },
        endpoints,
      },
    };
  }

  private writeHooks(pluginId: string, endpoints: Json): void {
    this.hooks = this.hooks.filter((hook) => hook.plugin_id !== pluginId);
    for (const [point, endpoint] of Object.entries(endpoints)) {
      this.hooks.push({
        id: `hk_${point}_${pluginId}`,
        plugin_id: pluginId,
        hook_point: `tool.${point}`,
        name: `${point}`,
        phase: (endpoint as Json).phase,
        failure_mode: (endpoint as Json).failure_mode,
        status: (endpoint as Json).status ?? "active",
      });
    }
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Json) : undefined;
    this.requests.push({ method: request.method, path: `${url.pathname}${url.search}`, authorization: request.headers.get("authorization"), body });
    this.timeline.push(`arcade ${request.method} ${url.pathname}${url.search}`);
    if (request.headers.get("authorization") !== `Bearer ${KEY}`) return Response.json({ message: "unauthorized" }, { status: 401 });

    // The org and project routes: only the key's own project is there.
    const scoped = /^\/v1\/orgs\/([^/]+)\/projects\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (scoped) {
      const [, org, project, rest] = scoped;
      if (org !== ORG || project !== PROJECT) return Response.json({ name: "not_found", message: "project not found" }, { status: 404 });
      return this.project(request.method, rest!, url.searchParams, body);
    }

    const [, , ...parts] = url.pathname.split("/"); // "", "v1", ...
    const route = `${request.method} /${parts.map((part, i) => (i > 0 && /^(auth_providers|secrets)$/.test(parts[i - 1]!) ? ":id" : part)).join("/")}`;
    switch (route) {
      case "GET /admin/auth_providers/:id": {
        const provider = this.providers.get(parts[2]!);
        return provider ? Response.json(provider) : Response.json({ message: "not found" }, { status: 404 });
      }
      case "POST /admin/auth_providers": {
        const sent = body as { id: string; oauth2: Json };
        const stored = {
          ...sent,
          status: "active",
          oauth2: { ...sent.oauth2, client_secret: { exists: true, editable: true, binding: "project" }, redirect_uri: this.nextCallback },
        };
        this.providers.set(sent.id, stored);
        return Response.json(stored, { status: 201 });
      }
      // The Arcade CLI's upsert (`arcade_cli/secret.py` `_upsert_secret`, and
      // `deploy.py` for `arcade deploy`): PUT, `{ description, value }`.
      // `value` is required and at most 5000 characters
      // (`schemas.UpsertStoredSecretRequest`).
      case "PUT /admin/secrets/:id": {
        if (this.secretsLikeTheLiveRun) return Response.json(ROUTE_NOT_FOUND, { status: 404 });
        const sent = body as { value?: unknown; description?: unknown } | undefined;
        if (typeof sent?.value !== "string" || sent.value === "" || sent.value.length > 5000) {
          return Response.json({ name: "malformed_request", message: "value is a required field" }, { status: 400 });
        }
        this.secrets.set(parts[2]!, sent.value);
        return Response.json({ id: `sec_${parts[2]}`, key: parts[2], description: sent.description ?? "" });
      }
      // No bare `/v1/plugins`, and nothing under a bare `/hooks` (#28): real
      // Arcade answered `GET /v1/plugins?limit=100` with the 404 below on the
      // second live run. They fall through to the default.
      case "PUT /admin/settings/session_verification":
        if (!this.verifierIgnoresPut) this.verifier = { ...(body as Json) };
        return Response.json(this.verifier);
      case "GET /admin/settings/session_verification":
        return Response.json(this.verifier);
      default:
        return Response.json(ROUTE_NOT_FOUND, { status: 404 });
    }
  }

  /** `/v1/orgs/{org}/projects/{project}<rest>`, in the live swagger's shapes (fetched on #30). */
  private project(method: string, rest: string, query: URLSearchParams, body: Json | undefined): Response {
    const page = (items: Json[]) => Response.json({ items, limit: Number(query.get("limit") ?? 20), offset: 0, total_count: items.length });
    const pluginId = /^\/plugins\/([^/]+)$/.exec(rest)?.[1];
    if (method === "GET" && rest === "/plugins") return page([...this.plugins.values()].map((each) => this.pluginResponse(each)));
    if ((method === "POST" && rest === "/plugins") || (pluginId !== undefined && method === "PATCH")) {
      const health = body?.webhook_config?.health_check_path;
      if ((method === "POST" || health !== undefined) && !isUrl(health)) return Response.json(HEALTH_CHECK_NOT_A_URL, { status: 400 });
    }
    if (method === "POST" && rest === "/plugins" && this.nextPluginCreate !== null) {
      const { status, body: answer } = this.nextPluginCreate;
      this.nextPluginCreate = null;
      return Response.json(answer, { status });
    }
    if (method === "POST" && rest === "/plugins") {
      if (!body?.name || !body.plugin_type || !body.webhook_config?.endpoints) {
        return Response.json({ name: "malformed_request", message: "name, plugin_type and webhook_config.endpoints are required" }, { status: 400 });
      }
      const id = `plg_${++this.ids}`;
      const stored = { ...body, id };
      this.plugins.set(id, stored);
      this.writeHooks(id, body.webhook_config.endpoints);
      return Response.json({ ...this.pluginResponse(stored), hooks: this.hooks.filter((hook) => hook.plugin_id === id) }, { status: 201 });
    }
    if (pluginId !== undefined && (method === "GET" || method === "PATCH")) {
      const stored = this.plugins.get(pluginId);
      if (!stored) return Response.json({ name: "not_found", message: "plugin not found" }, { status: 404 });
      if (method === "PATCH") {
        let patch = body;
        if (this.patchIgnoresStatus) {
          const endpoints = Object.fromEntries(
            Object.entries(body?.webhook_config?.endpoints ?? {}).map(([point, each]) => [point, { ...(each as Json), status: stored.webhook_config.endpoints[point]?.status }]),
          );
          patch = { ...body, status: stored.status, webhook_config: { ...body?.webhook_config, endpoints } };
        }
        const merged = { ...stored, ...patch, webhook_config: { ...stored.webhook_config, ...patch?.webhook_config } };
        this.plugins.set(pluginId, merged);
        if (body?.webhook_config?.endpoints) this.writeHooks(pluginId, merged.webhook_config.endpoints);
        return Response.json(this.pluginResponse(merged));
      }
      return Response.json(this.pluginResponse(stored));
    }
    if (method === "GET" && rest === "/hooks") {
      const plugin = query.get("plugin_id");
      return page(this.hooks.filter((hook) => plugin === null || hook.plugin_id === plugin));
    }
    if (method === "GET" && rest === "/gateways") return page([...this.gateways.values()]);
    // Since #52 the run creates the gateway itself (`schemas.CreateGatewayRequest`), through a User Source that exists.
    if (method === "POST" && rest === "/gateways") {
      if (this.nextGatewayCreate !== null) {
        const { status, body: answer } = this.nextGatewayCreate;
        this.nextGatewayCreate = null;
        return Response.json(answer, { status });
      }
      if (body?.auth_type !== "user_source" || !this.userSources.has(body?.user_source_id)) {
        return Response.json({ name: "malformed_request", message: "user_source_id must name a User Source in this project" }, { status: 400 });
      }
      if ([...this.gateways.values()].some((each) => each.slug === body.slug)) {
        return Response.json({ name: "conflict", message: `slug ${body.slug} is taken` }, { status: 409 });
      }
      const tools: string[] = body.tool_filter?.allowed_tools ?? [];
      const hooksOn = [...this.plugins.values()].some((each) => each.status === "active");
      const hidden = tools.find((tool) => /^(Loan|Approvals)\./.test(tool));
      if (this.activeHooksHideTools && hooksOn && hidden) {
        return Response.json({ name: "malformed_request", message: `tool ${hidden} not found` }, { status: 400 });
      }
      const id = `gw_${++this.ids}`;
      const stored = { ...body, id, status: "active" };
      this.gateways.set(id, stored);
      return Response.json(stored, { status: 201 });
    }
    const gatewayId = /^\/gateways\/([^/]+)$/.exec(rest)?.[1];
    if (gatewayId !== undefined && method === "GET") {
      if (this.gatewayReadBack !== null) return Response.json(this.gatewayReadBack.body, { status: this.gatewayReadBack.status });
      const stored = this.gateways.get(gatewayId);
      return stored ? Response.json(stored) : Response.json({ name: "not_found", message: "gateway not found" }, { status: 404 });
    }
    // The Arcade CLI's `server_already_exists`: org-scoped, 404 when the server is missing.
    const worker = /^\/workers\/([^/]+)$/.exec(rest)?.[1];
    if (worker !== undefined && method === "GET") {
      if (this.workerLookup !== null) return Response.json(this.workerLookup.body, { status: this.workerLookup.status });
      return this.workers.has(worker)
        ? Response.json({ id: worker, enabled: true, managed: true, type: "mcp" })
        : Response.json({ name: "not_found", message: `worker ${worker} not found` }, { status: 404 });
    }
    return Response.json(ROUTE_NOT_FOUND, { status: 404 });
  }
}

/**
 * The gateway the forker creates in the dashboard from the printed form (#48),
 * in `schemas.GatewayResponse`'s shape: the slug, the User Source and the six
 * tools. How a dashboard-made gateway reads back its `tool_filter` is
 * unmeasured; this is the shape the Arcade CLI sends (`Toolkit.Tool`).
 */
function dashboardGateway(overrides: Json = {}): Json {
  const gateway = {
    id: `gw_dashboard_${arcade.gateways.size + 1}`,
    name: "Loan Approval Limits",
    slug: "loan-approval-limits",
    status: "active",
    auth_type: "user_source",
    user_source_id: USER_SOURCE,
    tool_filter: {
      allowed_tools: ["Loan.SearchLoans", "Loan.GetLoan", "Loan.ApproveLoan", "Loan.DenyLoan", "Approvals.RequestApproval", "Approvals.Decide"],
    },
    ...overrides,
  };
  arcade.gateways.set(gateway.id, gateway);
  return gateway;
}

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "cg-setup-arcade-")));
let arcade: StandIn;

/**
 * The Arcade CLI, faked: it records its working directory and arguments, and
 * fails where a test asks it to. First on `PATH`, so the real `arcade` is never
 * reached, and run under a throwaway `HOME`, so it could not find a login if it were.
 */
const FAKE_BIN = join(scratch, "bin");
mkdirSync(FAKE_BIN, { recursive: true });
writeFileSync(
  join(FAKE_BIN, "arcade"),
  [
    "#!/bin/sh",
    'echo "fake arcade: $* (in $PWD)"',
    'echo "$PWD|$*" >> "$FAKE_ARCADE_LOG"',
    // What the CLI would see as stdin: the harness hands setup-arcade a pipe, so an inherited stdin is one.
    // `/dev/null` is a character device; a pipe or socket (Bun's "pipe") is not.
    'if [ -c /dev/fd/0 ]; then echo "$PWD|stdin=none" >> "$FAKE_ARCADE_LOG.stdin"; else echo "$PWD|stdin=inherited" >> "$FAKE_ARCADE_LOG.stdin"; fi',
    'case "$PWD" in *"${FAKE_ARCADE_FAIL_IN:-no such directory}") echo "fake arcade: deploy failed" >&2; exit 3 ;; esac',
    "exit 0",
    "",
  ].join("\n"),
);
chmodSync(join(FAKE_BIN, "arcade"), 0o755);

beforeEach(() => {
  arcade?.stop();
  arcade = new StandIn();
});
afterAll(() => {
  arcade?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const run = Bun.spawnSync(["git", ...args], { cwd, env: childEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" }) });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
}

/** A `credentials.yaml` the way the Arcade CLI 1.16 writes it: named contexts, and the active one flat as well. */
function credentials(orgId: string, projectId: string): string {
  const [access, refresh, apiKey] = CLI_TOKENS;
  const context = [
    "      auth:",
    `        access_token: ${access}`,
    `        refresh_token: ${refresh}`,
    "        expires_at: '2026-09-26T00:00:00Z'",
    `      api_key: ${apiKey}`,
    "      context:",
    `        org_id: ${orgId}`,
    "        org_name: Stand-in Org",
    `        project_id: ${projectId}`,
    "        project_name: Stand-in Project",
    "      coordinator_url: https://cloud.arcade.dev",
    "      kind: cloud",
    "      user:",
    "        email: developer@example.com",
  ];
  return ["cloud:", "  active_context: cloud.arcade.dev", "  contexts:", "    cloud.arcade.dev:", ...context, ...context.map((line) => line.slice(4)), ""].join("\n");
}

interface Project {
  dir: string;
  /** The throwaway `HOME` the script and the fake CLI see. */
  home: string;
  /** Every `arcade` invocation, as `<dir relative to the project>|<args>`. */
  deploys(): string[];
}
const projects = new Map<string, Project>();

/**
 * A fresh project: `.env.example` copied to `.env`, `ARCADE_API_KEY` filled,
 * `.env` gitignored, the two toolkit directories `arcade deploy` runs in, and a
 * `HOME` whose Arcade CLI is logged in with the stand-in's project active.
 * `cli: null` is a CLI that was never logged in.
 */
function project(
  name: string,
  edit: (env: string) => string = (env) => env,
  cli: { orgId: string; projectId: string } | null = { orgId: ORG, projectId: PROJECT },
): string {
  const dir = join(scratch, name);
  // Each toolkit names its server the way this template's do: `[project] name`.
  for (const toolkit of ["loan", "approvals"]) {
    mkdirSync(join(dir, "tools", toolkit), { recursive: true });
    writeFileSync(join(dir, "tools", toolkit, "pyproject.toml"), `[project]\nname = "${toolkit}"\nversion = "1.0.0"\n`);
  }
  git(dir, "init", "-q");
  writeFileSync(join(dir, ".gitignore"), ".env\n*.db\n*.db-*\n");
  copyFileSync(join(ROOT, ".env.example"), join(dir, ".env.example"));
  const env = readFileSync(join(ROOT, ".env.example"), "utf8").replace(/^ARCADE_API_KEY=$/m, `ARCADE_API_KEY=${KEY}`);
  if (env === readFileSync(join(ROOT, ".env.example"), "utf8")) throw new Error(".env.example has no blank ARCADE_API_KEY= line");
  writeFileSync(join(dir, ".env"), edit(env));
  const home = join(scratch, `${name}.home`);
  mkdirSync(home, { recursive: true });
  if (cli !== null) {
    mkdirSync(join(home, ".arcade"), { recursive: true });
    writeFileSync(join(home, ".arcade", "credentials.yaml"), credentials(cli.orgId, cli.projectId));
  }
  const log = join(scratch, `${name}.arcade.log`);
  projects.set(dir, {
    dir,
    home,
    deploys: () =>
      existsSync(log)
        ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => line.replace(`${realpathSync(dir)}/`, "").replace(`${dir}/`, ""))
        : [],
  });
  return dir;
}

/**
 * `failDeployIn`: the toolkit directory the fake CLI fails in. `shell`: variables the developer's shell exports.
 * `tty`: stdin counts as a terminal, so the run may pause (#52). `input`: what is typed at the pause, then stdin ends.
 */
type RunOptions = { failDeployIn?: string; shell?: Record<string, string>; tty?: boolean; input?: string };

async function setupArcade(cwd: string, ...args: Array<string | RunOptions>): Promise<{ code: number; stdout: string; stderr: string }> {
  const project = projects.get(cwd);
  if (!project) throw new Error(`${cwd} was not made by project()`);
  const options = args.find((arg): arg is RunOptions => typeof arg === "object") ?? {};
  const child = spawnChild(["bun", "--no-env-file", SCRIPT, HOST, ...args.filter((arg): arg is string => typeof arg === "string")], {
    cwd,
    env: childEnv({
      // Never the real Coordinator, whatever a test's shell says (#52): a test that
      // wants another host sets it in `shell`, which wins, and it is always a local one.
      ARCADE_COORDINATOR_URL: arcade.coordinatorUrl,
      CG_SETUP_ARCADE_ISSUER_URL: arcade.tunnelUrl,
      ...(options.tty ? { CG_SETUP_ARCADE_TTY: "1" } : {}),
      ...options.shell,
      ARCADE_API_URL: arcade.url,
      HOME: project.home,
      PATH: `${FAKE_BIN}:${process.env.PATH ?? ""}`,
      FAKE_ARCADE_LOG: join(scratch, `${cwd.slice(scratch.length + 1)}.arcade.log`),
      ...(options.failDeployIn ? { FAKE_ARCADE_FAIL_IN: options.failDeployIn } : {}),
    }),
    // A pipe that stays open and is never written: what a child that inherits stdin would get.
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.input !== undefined) {
    const stdin = child.stdin as import("bun").FileSink;
    stdin.write(options.input);
    await stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout as ReadableStream).text(),
    new Response(child.stderr as ReadableStream).text(),
    child.exited,
  ]);
  // The CLI's tokens are in the file the script reads: none may come out of it.
  for (const token of CLI_TOKENS) expect(`${stdout}${stderr}`, `the run printed the CLI's ${token}`).not.toContain(token);
  return { code, stdout, stderr };
}

function envOf(dir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(dir, ".env"), "utf8").split("\n")) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) env[match[1]!] = match[2]!;
  }
  return env;
}

function clientsIn(dir: string): Record<string, { clientId: string; redirectUris: string[] }> {
  const db = new Database(join(dir, "idp.db"), { readonly: true });
  try {
    const rows = db.query(`select id, clientId, redirectUris from oauthClient`).all() as Array<{ id: string; clientId: string; redirectUris: string }>;
    return Object.fromEntries(
      rows.map((row) => [row.id, { clientId: row.clientId, redirectUris: row.redirectUris.startsWith("[") ? (JSON.parse(row.redirectUris) as string[]) : row.redirectUris.split(",") }]),
    );
  } finally {
    db.close();
  }
}

/** `METHOD /path`, with the ids Arcade minted written `{id}`, so a real run and a dry run compare. */
const normalise = (line: string) => line.replace(/(plg|gw)_\d+|<plugin_id>|<gateway_id>/g, "{id}");
const sequence = (requests: Recorded[]) => requests.map((each) => normalise(`${each.method} ${each.path}`));

/** The key's check, the first call of every run that found a project (#30). */
const GUARD = `GET ${SCOPED}/plugins?limit=100`;
/** The gateway check that ends every run with a project (#48): a read, never a write. */
const GATEWAY_CHECK = `GET ${SCOPED}/gateways?limit=100`;
/** A fresh project's registrations, after the guard, up to the gateway check. */
const FIRST_RUN = [
  GUARD,
  "GET /v1/admin/auth_providers/app-identity",
  "POST /v1/admin/auth_providers",
  "PUT /v1/admin/secrets/APP_PUBLIC_HOST",
  "PUT /v1/admin/secrets/APPROVALS_STORE_TOKEN",
  "PUT /v1/admin/settings/session_verification",
  "GET /v1/admin/settings/session_verification",
  `POST ${SCOPED}/plugins`,
  `GET ${SCOPED}/plugins/{id}`,
  `GET ${SCOPED}/hooks?plugin_id={id}`,
  `GET ${SCOPED}/workers/loan`,
  `GET ${SCOPED}/workers/approvals`,
  GATEWAY_CHECK,
];
/** A rerun's, once everything the first run did is there. */
const RERUN = [
  GUARD,
  "GET /v1/admin/auth_providers/app-identity",
  "PUT /v1/admin/secrets/APP_PUBLIC_HOST",
  "PUT /v1/admin/secrets/APPROVALS_STORE_TOKEN",
  "PUT /v1/admin/settings/session_verification",
  "GET /v1/admin/settings/session_verification",
  `GET ${SCOPED}/hooks?plugin_id={id}`,
  `GET ${SCOPED}/workers/loan`,
  `GET ${SCOPED}/workers/approvals`,
  GATEWAY_CHECK,
];
/** What the second run adds once the gateway is there (#48): the hooks turned on, and read back. */
const TURN_ON = [`PATCH ${SCOPED}/plugins/{id}`, `GET ${SCOPED}/plugins/{id}`, `GET ${SCOPED}/hooks?plugin_id={id}`];
const DEPLOYS = ["tools/loan|deploy", "tools/approvals|deploy"];
/** The Coordinator's User Source route under the stand-in's project (#52), as a sequence names it. */
const USER_SOURCES = `/v1/orgs/${ORG}/projects/${PROJECT}/user_sources`;
/** A fresh one-click run's Coordinator calls: the list, the create, the read-back. */
const ONE_CLICK_COORDINATOR = [`GET ${USER_SOURCES}`, `POST ${USER_SOURCES}`, `GET ${USER_SOURCES}`];
/** What a fresh one-click run adds on Arcade's API after the gateway check: the gateway created and read back, then the hooks on. */
const ONE_CLICK_TAIL = [`POST ${SCOPED}/gateways`, `GET ${SCOPED}/gateways/{id}`, ...TURN_ON];
/** Both stand-ins' requests, in the order they came, as one sequence: what a dry run describes. */
const combined = () => arcade.timeline.filter((each) => !each.startsWith("tunnel ")).map((each) => normalise(each.replace(/^(arcade|coordinator) /, "")));
const coordinatorSequence = () => arcade.coordinatorRequests.map((each) => `${each.method} ${each.path.replace(/^\/api/, "")}`);

/**
 * The hooks as Arcade holds them, field by field: the three URLs on the
 * public host, fail closed, the health path, `.env`'s bearer, which the
 * stand-in keeps and never returns, and `status` on the plugin and on every
 * endpoint: `inactive` after the first run, `active` after the second (#48).
 */
function hooksAreRegistered(dir: string, status: "inactive" | "active"): void {
  const plugins = [...arcade.plugins.values()];
  expect(plugins.map((each) => each.name)).toEqual(["loan-approval-limits-hooks"]);
  const [plugin] = plugins as [Json];
  expect(plugin.plugin_type).toBe("webhook");
  expect(plugin.status).toBe(status);
  expect(plugin.webhook_config.health_check_path).toBe(`${ORIGIN}/hooks/health`);
  expect(plugin.webhook_config.auth).toEqual({ type: "bearer", token: envOf(dir).ARCADE_HOOK_SIGNING_SECRET });
  expect(plugin.webhook_config.endpoints).toEqual({
    access: { url: `${ORIGIN}/hooks/access`, phase: "before", failure_mode: "fail_closed", status },
    pre: { url: `${ORIGIN}/hooks/pre`, phase: "before", failure_mode: "fail_closed", status },
    post: { url: `${ORIGIN}/hooks/post`, phase: "after", failure_mode: "fail_closed", status },
  });
  expect(arcade.hooks.map((hook) => `${hook.hook_point} ${hook.phase} ${hook.failure_mode} ${hook.status}`).sort()).toEqual([
    `tool.access before fail_closed ${status}`,
    `tool.post after fail_closed ${status}`,
    `tool.pre before fail_closed ${status}`,
  ]);
}

/** No request that writes a gateway, of any method, under any path (#48). */
function noGatewayWritten(): void {
  expect(arcade.requests.filter((each) => /\/gateways\b/.test(each.path) && each.method !== "GET").map((each) => `${each.method} ${each.path}`)).toEqual([]);
}

/**
 * The contextual access hooks form (#28), field by field, for a run that found
 * no org and project. Every name on the left is the live swagger's, and the
 * bearer is named, never printed.
 */
function hooksFormIsComplete(stdout: string): void {
  const start = stdout.indexOf("┌─ Contextual access hooks");
  expect(start, "no contextual access hooks form").toBeGreaterThan(-1);
  const form = stdout.slice(start, stdout.indexOf("└─", start));
  expect(form).toMatch(/│ {2}name +loan-approval-limits-hooks$/m);
  expect(form).toMatch(/│ {2}plugin_type +webhook$/m);
  expect(form).toMatch(/│ {2}status +active$/m);
  for (const [point, phase] of [["access", "before"], ["pre", "before"], ["post", "after"]] as const) {
    const at = form.indexOf(`│  webhook_config.endpoints.${point}   (hook_point tool.${point})`);
    expect(at, `the form has no ${point} endpoint`).toBeGreaterThan(-1);
    const block = form.slice(at).split("\n").slice(1, 5).join("\n");
    expect(block).toMatch(new RegExp(`│ {4}url +${ORIGIN.replace(/\./g, "\\.")}/hooks/${point}$`, "m"));
    expect(block).toMatch(new RegExp(`│ {4}phase +${phase}$`, "m"));
    expect(block).toMatch(/│ {4}failure_mode +fail_closed$/m);
    expect(block).toMatch(/│ {4}status +active$/m);
  }
  expect(form).toMatch(new RegExp(`│ {2}webhook_config\\.health_check_path +${ORIGIN.replace(/\./g, "\\.")}/hooks/health$`, "m"));
  expect(form).toMatch(/│ {2}webhook_config\.auth\.type +bearer$/m);
  expect(form).toMatch(/│ {2}webhook_config\.auth\.token +the value of ARCADE_HOOK_SIGNING_SECRET in \.env \(not printed here\)$/m);
}

/** The forms in the order the output prints them. */
function formOrder(stdout: string): string[] {
  return [...stdout.matchAll(/^┌─ (.*)$/gm)].map(([, title]) =>
    /User Sources/.test(title!) ? "User Source" : /Contextual access hooks/.test(title!) ? "hooks" : /MCP Gateways/.test(title!) ? "gateway" : title!,
  );
}

test("a first run registers every API-able piece with the hooks disabled, deploys both toolkits, makes no gateway, and prints both forms", async () => {
  const mine = "the-developer-chose-this-session-secret-0123456789";
  const dir = project("full", (env) => env.replace(/^SESSION_SECRET=$/m, `SESSION_SECRET=${mine}`));
  const run = await setupArcade(dir);
  console.log(`--- setup-arcade ${HOST}, the first run ---\n${run.stdout}${run.stderr}`);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);

  expect(run.stdout).toContain(`arcade        org ${ORG}, project ${PROJECT} (from the Arcade CLI's active context, `);
  expect(run.stdout).toContain(`.arcade/credentials.yaml, context cloud.arcade.dev)`);
  expect(sequence(arcade.requests)).toEqual(FIRST_RUN);
  for (const request of arcade.requests) expect(request.authorization).toBe(`Bearer ${KEY}`);

  const env = envOf(dir);
  const clients = clientsIn(dir);
  expect(Object.keys(clients).sort()).toEqual(["arcade", "arcade-user-source", "web"]);

  // The provider: the app's own endpoints, its own `arcade` client, Basic plus PKCE, email as the user id.
  const provider = arcade.requests[2]!.body as { id: string; oauth2: Record<string, any> };
  expect(provider.id).toBe("app-identity");
  expect(provider.oauth2.client_id).toBe(clients.arcade!.clientId);
  expect(provider.oauth2.client_secret).toMatch(/^\S{16,}$/);
  expect(provider.oauth2.authorize_request.endpoint).toBe(`${ORIGIN}/oauth2/authorize`);
  expect(provider.oauth2.token_request.endpoint).toBe(`${ORIGIN}/oauth2/token`);
  expect(provider.oauth2.token_request.auth_method).toBe("client_secret_basic");
  expect(provider.oauth2.user_info_request.endpoint).toBe(`${ORIGIN}/oauth2/userinfo`);
  expect(provider.oauth2.user_info_request.response_map).toEqual({ user_id: "$.email" });
  expect(provider.oauth2.pkce).toEqual({ enabled: true, code_challenge_method: "S256" });
  // Arcade's generated callback came back and is now allowlisted on that client.
  expect(clients.arcade!.redirectUris).toContain(CALLBACK);
  expect(env.IDP_OAUTH_REDIRECT_URIS_ARCADE).toBe(CALLBACK);

  // The hooks: by API since #30, with the bearer the app checks, which is never printed,
  // and disabled since #48: the swagger's inactive value on the plugin and on every endpoint.
  hooksAreRegistered(dir, "inactive");
  const created = arcade.requests.find((each) => each.method === "POST" && each.path === `${SCOPED}/plugins`)!.body as Json;
  expect(created.status).toBe("inactive");
  expect(Object.values(created.webhook_config.endpoints).map((each) => (each as Json).status)).toEqual(["inactive", "inactive", "inactive"]);
  expect(run.stdout).toContain("hooks: created loan-approval-limits-hooks, disabled until the gateway exists");
  expect(run.stdout).toContain(`hooks: ${ORIGIN}/hooks/access, /hooks/pre and /hooks/post, fail closed, status inactive (read back)`);
  expect(run.stdout).toContain(`hooks: Arcade doesn't echo webhook_config.health_check_path back; it was sent as ${ORIGIN}/hooks/health and can't be verified`);
  expect(`${run.stdout}${run.stderr}`).not.toContain(env.ARCADE_HOOK_SIGNING_SECRET!);

  // The deploys: both toolkits, in order, streamed, after the hooks.
  expect(projects.get(dir)!.deploys()).toEqual(DEPLOYS);
  expect(run.stdout).toContain("arcade deploy   (in tools/loan):\nfake arcade: deploy (in ");
  expect(run.stdout.indexOf("arcade deploy   (in tools/loan):")).toBeGreaterThan(run.stdout.indexOf("hooks: created"));
  expect(run.stdout.indexOf("arcade deploy   (in tools/approvals):")).toBeGreaterThan(run.stdout.indexOf("arcade deploy   (in tools/loan):"));

  // The tool secrets, in the CLI's body shape, and the verifier as read back.
  for (const request of arcade.requests.filter((each) => each.path.startsWith("/v1/admin/secrets/"))) {
    expect(Object.keys(request.body as object).sort()).toEqual(["description", "value"]);
  }
  expect(arcade.secrets.get("APP_PUBLIC_HOST")).toBe(HOST);
  expect(arcade.secrets.get("APPROVALS_STORE_TOKEN")).toBe(env.APPROVALS_STORE_TOKEN);
  expect(arcade.verifier).toEqual({ verifier_url: `${ORIGIN}/api/arcade/verify`, unsafe_skip_verification: false });

  // .env: every blank this run owns is filled, and the developer's value is not touched.
  expect(env.APP_PUBLIC_HOST).toBe(HOST);
  expect(env.ARCADE_HOOK_SIGNING_SECRET).toMatch(/^[0-9a-f]{64}$/);
  expect(env.APPROVALS_STORE_TOKEN).toMatch(/^[0-9a-f]{64}$/);
  expect(new Set([env.SESSION_SECRET, env.ARCADE_HOOK_SIGNING_SECRET, env.APPROVALS_STORE_TOKEN]).size).toBe(3);
  expect(env.IDP_OAUTH_CLIENTS).toBe("arcade,arcade-user-source,web");
  expect(env.IDP_CLIENT_ID).toBe(clients.web!.clientId);
  expect(env.IDP_CLIENT_SECRET).toMatch(/^\S{16,}$/);
  expect(clients.web!.redirectUris).toEqual([`${ORIGIN}/api/auth/callback`]);
  expect(clients["arcade-user-source"]!.redirectUris).toEqual(["https://cloud.arcade.dev/oauth2/intermediate_callback"]);
  expect(env.ARCADE_GATEWAY_ID).toBe("loan-approval-limits");
  expect(env.GOVERNANCE_STREAM).toBe("hooks");
  // Every key .env.example says setup-arcade fills is filled.
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const section = example.slice(example.indexOf("# --- Filled in by `bun run setup-arcade"), example.indexOf("# --- Optional"));
  const owned = [...section.matchAll(/^([A-Z_][A-Z0-9_]*)=$/gm)].map(([, key]) => key!);
  expect(owned.length).toBeGreaterThan(5);
  for (const key of owned) expect(env[key], `setup-arcade left ${key} blank`).toMatch(/\S/);
  expect(env.ARCADE_API_KEY).toBe(KEY);
  // The identity provider's secret (#9): filled, fresh, and never printed.
  expect(env.BETTER_AUTH_SECRET).toMatch(/^[0-9a-f]{64}$/);
  expect(new Set([env.BETTER_AUTH_SECRET, env.SESSION_SECRET, env.ARCADE_HOOK_SIGNING_SECRET, env.APPROVALS_STORE_TOKEN]).size).toBe(4);
  expect(run.stdout).toMatch(/filled\s+.*\bBETTER_AUTH_SECRET\b/);
  expect(`${run.stdout}${run.stderr}`).not.toContain(env.BETTER_AUTH_SECRET!);
  // A value setup-arcade would otherwise have written, set by hand first: kept.
  expect(env.SESSION_SECRET).toBe(mine);
  expect(run.stdout).toMatch(/kept\s+SESSION_SECRET/);

  // No gateway: it was looked for, never written, and both forms are left, the User Source's first.
  expect(arcade.gateways.size).toBe(0);
  noGatewayWritten();
  expect(run.stdout).toContain("gateway: there is no loan-approval-limits in this project yet; it is the dashboard form below");
  expect(run.stdout).toContain("hooks: left disabled, so the dashboard's gateway form lists the tools");
  expect(formOrder(run.stdout)).toEqual(["User Source", "gateway"]);
  expect(run.stdout).toContain("User Sources → Create User Source");
  expect(run.stdout).toContain(`Issuer URL      ${ORIGIN}`);
  expect(run.stdout).toContain(`Client ID       ${clients["arcade-user-source"]!.clientId}`);
  expect(run.stdout).toMatch(/Subject Claim\s+email/);
  gatewayFormIsComplete(run.stdout);
  // Then the command for the second run, and the warning, last.
  expect(run.stdout.trimEnd().split("\n").slice(-5)).toEqual([
    "Once the gateway loan-approval-limits exists, turn the hooks on with the same command:",
    `  bun run setup-arcade ${HOST}`,
    "",
    "warning: until then the gateway runs ungoverned. The hooks are disabled, so Arcade calls none of",
    `${ORIGIN}/hooks/access, /hooks/pre and /hooks/post, and every tool call runs unchecked.`,
  ]);
  // Nothing printed carries the API key.
  expect(`${run.stdout}${run.stderr}`).not.toContain(KEY);
}, 60_000);

/**
 * The gateway form (#48), field by field: the slug, the User Source for its
 * authentication and never Headers, and exactly the six tools.
 */
function gatewayFormIsComplete(stdout: string): void {
  const start = stdout.indexOf("┌─ Arcade dashboard → your project → MCP Gateways → Create Gateway");
  expect(start, "no gateway form").toBeGreaterThan(-1);
  const form = stdout.slice(start, stdout.indexOf("└─", start));
  expect(form).toMatch(/│ {2}Slug +loan-approval-limits +← \.env's ARCADE_GATEWAY_ID$/m);
  expect(form).toContain("│  Allowed Tools     these six, and no others:\n│                    Loan: SearchLoans, GetLoan, ApproveLoan, DenyLoan\n│                    Approvals: RequestApproval, Decide\n");
  expect(form).toContain("Non-Arcade Users → User Source\n│                    → Loan Approval Limits (the User Source above). Never Arcade Headers.");
  expect(form).toContain("lists the Loan and Approvals tools only while the hooks are disabled");
}

/**
 * What is left after the first run, in the order the README's Quickstart
 * gives it (#11, #30, #48): the app and the tunnel, the User Source form
 * (Arcade reads its issuer through the tunnel), the gateway form through it,
 * the second run that turns the hooks on, then the app. Both texts are read
 * here, so the list cannot drift from the README, or the README from the
 * list, without this failing.
 */
const NEXT_STEPS: Array<[string, RegExp]> = [
  ["start the app", /`bun run dev`/],
  ["start the tunnel", /ngrok http --url=/],
  ["the User Source form", /fill in the User Source form/i],
  ["the gateway form", /fill in the gateway form/i],
  ["the hooks, by the second run", /run `?bun run setup-arcade \S+`? again/i],
  ["open the app", /open `?https:\/\//i],
];

/** The step names in the order the text first mentions them, or the ones it never does. */
function stepOrder(text: string): string[] {
  const found = NEXT_STEPS.map(([name, pattern]) => ({ name, at: text.search(pattern) }));
  const missing = found.filter(({ at }) => at === -1).map(({ name }) => `missing: ${name}`);
  if (missing.length > 0) return missing;
  return found.sort((a, b) => a.at - b.at).map(({ name }) => name);
}

/** From the Quickstart step that starts the app and fills in both forms to the end of the Quickstart. */
function readmeRemainder(): string {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const start = readme.indexOf("5. **Create the User Source and the gateway**");
  const end = readme.indexOf("\n## ", start);
  if (start === -1 || end === -1) throw new Error("README.md's Quickstart has no step 5 to read from");
  return readme.slice(start, end);
}

/** The printed "Then:" list, from its heading to the blank line after it. */
function thenList(stdout: string): string {
  const start = stdout.lastIndexOf("Then:");
  expect(start, "no Then: list").toBeGreaterThan(-1);
  const rest = stdout.slice(start);
  const end = rest.indexOf("\n\n");
  return end === -1 ? rest.trimEnd() : rest.slice(0, end);
}

test("the steps it prints after the form are the README's, in the README's order", async () => {
  const run = await setupArcade(project("next-steps"));
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  const printed = thenList(run.stdout);

  const order = NEXT_STEPS.map(([name]) => name);
  expect(stepOrder(printed)).toEqual(order);
  expect(stepOrder(readmeRemainder())).toEqual(order);
  expect(printed).toContain(`ngrok http --url=${HOST} `);
  expect(printed).toContain(`Open ${ORIGIN}, never localhost`);
  expect(printed).toContain(`Turn the hooks on: run bun run setup-arcade ${HOST} again.`);
  startsTheApp(printed);
  // Nothing about deploying or the hooks form is left: this run deployed, and registered the hooks by API.
  expect(printed).not.toMatch(/arcade deploy|hooks form/);

  // The check bites: the hooks run ahead of the gateway form fails it, so does
  // the gateway form ahead of the User Source's, and so does the User Source
  // form ahead of the tunnel Arcade reads it through.
  const moveBefore = (moving: RegExp, before: RegExp) => {
    const lines = printed.split("\n");
    const [line] = lines.splice(lines.findIndex((each) => moving.test(each)), 1);
    lines.splice(lines.findIndex((each) => before.test(each)), 0, line!);
    return lines.join("\n");
  };
  expect(stepOrder(moveBefore(/Turn the hooks on/, /gateway form/))).not.toEqual(order);
  expect(stepOrder(moveBefore(/gateway form/, /User Source form/))).not.toEqual(order);
  const early = printed.split("\n");
  const [form] = early.splice(early.findIndex((line) => /User Source form/i.test(line)), 1);
  early.splice(early.findIndex((line) => /ngrok http/.test(line)), 0, form!);
  expect(stepOrder(early.join("\n"))).not.toEqual(order);
}, 60_000);

test("a dry run ends with the same steps", async () => {
  const run = await setupArcade(project("next-steps-dry"), "--dry-run");
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  const printed = thenList(run.stdout);
  expect(stepOrder(printed)).toEqual(NEXT_STEPS.map(([name]) => name));
  startsTheApp(printed);
});

/**
 * The first step starts the app; it does not restart it (#26). A developer
 * following the Quickstart runs `setup-arcade` at step 4 and has never started
 * `bun run dev`: "Restart" told them to restart something that was not running.
 */
function startsTheApp(printed: string): void {
  const first = printed.split("\n").find((line) => /^\s*1\./.test(line)) ?? "";
  expect(first).toMatch(/^\s*1\. Start `bun run dev`/);
  expect(printed).not.toMatch(/^\s*\d\. Restart/m);
}

test("--dry-run from a fresh project prints the requests a real run makes, in order, and writes, sends and deploys nothing", async () => {
  const dir = project("dry");
  const before = readFileSync(join(dir, ".env"), "utf8");
  const run = await setupArcade(dir, "--dry-run");
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);

  expect(arcade.requests).toEqual([]);
  expect(projects.get(dir)!.deploys()).toEqual([]);
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe(before);
  expect(existsSync(join(dir, "idp.db"))).toBe(false);

  expect(arcade.coordinatorRequests).toEqual([]);
  expect(printedRequests(run.stdout)).toEqual([...FIRST_RUN.slice(0, -1), ...ONE_CLICK_COORDINATOR, GATEWAY_CHECK, ...ONE_CLICK_TAIL]);
  expect(run.stdout).toContain("Authorization: Bearer <ARCADE_API_KEY>");
  // Each tool secret: PUT, the CLI's `{ description, value }`, and the store
  // token only as a placeholder, because a dry run shows no secret.
  const secret = (key: string) => bodyAfter(run.stdout, `  PUT ${arcade.url}/v1/admin/secrets/${key}\n`);
  expect(Object.keys(secret("APP_PUBLIC_HOST"))).toEqual(["description", "value"]);
  expect(secret("APP_PUBLIC_HOST").value).toBe(HOST);
  expect(Object.keys(secret("APPROVALS_STORE_TOKEN"))).toEqual(["description", "value"]);
  expect(secret("APPROVALS_STORE_TOKEN").value).toBe("<generated APPROVALS_STORE_TOKEN>");
  // The hooks: the whole body, with the bearer as a placeholder.
  const plugin = bodyAfter(run.stdout, `  POST ${arcade.url}${SCOPED}/plugins\n`);
  expect(plugin.webhook_config.auth).toEqual({ type: "bearer", token: "<generated ARCADE_HOOK_SIGNING_SECRET>" });
  expect(plugin.status).toBe("inactive");
  expect(plugin.webhook_config.endpoints.pre).toEqual({ url: `${ORIGIN}/hooks/pre`, phase: "before", failure_mode: "fail_closed", status: "inactive" });
  // The User Source (#52): the Coordinator's create, with the client's secret as a placeholder.
  const source = bodyAfter(run.stdout, `  POST ${arcade.coordinatorUrl}${USER_SOURCES}\n`);
  expect(source).toEqual({
    name: "Loan Approval Limits",
    description: "The app's own sign-in (hop 1)",
    issuer_url: ORIGIN,
    client_id: "<the arcade-user-source client id in idp.db>",
    client_secret: "<its secret, minted by this run>",
    scopes: "openid profile email",
    subject_claim: "email",
  });
  expect(run.stdout).toContain(`checks\n    ${ORIGIN}/.well-known/openid-configuration through the tunnel, then creates it`);
  // The gateway through it, then the hooks on, last; and what the fallback does instead.
  const gateway = bodyAfter(run.stdout, `  POST ${arcade.url}${SCOPED}/gateways\n`);
  expect(gateway.auth_type).toBe("user_source");
  expect(gateway.user_source_id).toBe("<the User Source's id>");
  expect(gateway.tool_filter.allowed_tools).toEqual(["Loan.SearchLoans", "Loan.GetLoan", "Loan.ApproveLoan", "Loan.DenyLoan", "Approvals.RequestApproval", "Approvals.Decide"]);
  expect(bodyAfter(run.stdout, `  PATCH ${arcade.url}${SCOPED}/plugins/<plugin_id>\n`).status).toBe("active");
  expect(run.stdout).toContain("falls back to the dashboard forms (#48): the\n    gateway loan-approval-limits is only looked for, the hooks stay disabled");
  expect(run.stdout).toContain(
    "Deploys, after the hooks and before the gateway check, each stopping the run if it fails, unless Arcade already runs it:\n  arcade deploy   (in tools/loan)\n  arcade deploy   (in tools/approvals)",
  );
  expect(run.stdout).not.toContain("POST " + arcade.url + "/v1/admin/secrets");
  expect(run.stdout).toMatch(/would fill .*\bBETTER_AUTH_SECRET\b/);
  expect(run.stdout).not.toContain(KEY);
  expect(formOrder(run.stdout)).toEqual(["User Source", "gateway"]);
});

/** The JSON body a dry run prints under a request line. */
function bodyAfter(stdout: string, line: string): Json {
  const at = stdout.indexOf(line);
  expect(at, `the dry run prints no ${line.trim()}`).toBeGreaterThan(-1);
  const block = stdout.slice(at).split("\n");
  const json = block.slice(3, block.findIndex((each, i) => i > 3 && each === "    }") + 1).join("\n");
  return JSON.parse(json) as Json;
}

test("the second run finds the gateway, turns the hooks on and reads them back, and a third says they are already on", async () => {
  const dir = project("second-run");
  expect((await setupArcade(dir)).code).toBe(0);
  hooksAreRegistered(dir, "inactive");

  // Step 5 of the Quickstart: the forker creates the gateway in the dashboard.
  dashboardGateway();
  arcade.requests = [];
  const run = await setupArcade(dir);
  console.log(`--- setup-arcade ${HOST}, the second run, with the gateway made in the dashboard ---\n${run.stdout}${run.stderr}`);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(sequence(arcade.requests)).toEqual([...RERUN, ...TURN_ON]);
  const patch = arcade.requests.find((each) => each.method === "PATCH")!.body as Json;
  expect(patch.status).toBe("active");
  expect(Object.values(patch.webhook_config.endpoints).map((each) => (each as Json).status)).toEqual(["active", "active", "active"]);
  hooksAreRegistered(dir, "active");
  expect(run.stdout).toContain("gateway: found loan-approval-limits, through a User Source");
  expect(run.stdout).toContain(`hooks: ${ORIGIN}/hooks/access, /hooks/pre and /hooks/post, fail closed, status active (read back)`);
  expect(run.stdout).toContain("hooks: on. Arcade now calls /hooks/access, /hooks/pre and /hooks/post for every tool call through loan-approval-limits");
  expect(run.stdout).not.toContain("warning       ");
  noGatewayWritten();
  // Nothing is left for the dashboard, and the run ends on opening the app.
  expect(formOrder(run.stdout)).toEqual([]);
  expect(run.stdout).not.toContain("ungoverned");
  expect(thenList(run.stdout).split("\n").slice(1)).toEqual([
    "  1. Start `bun run dev` (or restart it, if it is already running), so the app reads the new .env.",
    `  2. Start the tunnel: ngrok http --url=${HOST} 3000`,
    `  3. Open ${ORIGIN}, never localhost, and sign in.`,
  ]);

  // A third run: a no-op for the hooks, which says they are on.
  arcade.requests = [];
  const plugin = JSON.stringify([...arcade.plugins.values()]);
  const again = await setupArcade(dir);
  expect(again.code, `${again.stdout}\n${again.stderr}`).toBe(0);
  expect(sequence(arcade.requests)).toEqual(RERUN);
  expect(again.stdout).toContain("hooks: loan-approval-limits-hooks is already registered and matches; it is left as it is (status active)");
  expect(again.stdout).toContain("hooks: already on (status active); nothing to do");
  expect(JSON.stringify([...arcade.plugins.values()])).toBe(plugin);
}, 90_000);

test("with no gateway yet, the second run names the slug, says the form is still to do, and leaves the hooks disabled", async () => {
  const dir = project("second-run-too-early");
  expect((await setupArcade(dir)).code).toBe(0);
  arcade.requests = [];
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(sequence(arcade.requests)).toEqual(RERUN);
  expect(run.stdout).toContain("gateway: there is no loan-approval-limits in this project yet; it is the dashboard form below");
  expect(run.stdout).toContain("hooks: left disabled, so the dashboard's gateway form lists the tools");
  expect(formOrder(run.stdout)).toEqual(["User Source", "gateway"]);
  expect(run.stdout).toContain("warning: until then the gateway runs ungoverned.");
  hooksAreRegistered(dir, "inactive");
}, 90_000);

test("a gateway under another slug does not turn the hooks on", async () => {
  const dir = project("second-run-other-slug");
  dashboardGateway({ slug: "somebody-elses-gateway" });
  expect((await setupArcade(dir)).code).toBe(0);
  hooksAreRegistered(dir, "inactive");
  expect(arcade.requests.filter((each) => each.method === "PATCH")).toEqual([]);
}, 60_000);

test("rerunning the first run after it failed never turns the hooks on ahead of the gateway form", async () => {
  const dir = project("first-run-again");
  const failed = await setupArcade(dir, { failDeployIn: "tools/approvals" });
  expect(failed.code).toBe(1);
  hooksAreRegistered(dir, "inactive");
  const again = await setupArcade(dir);
  expect(again.code, `${again.stdout}\n${again.stderr}`).toBe(0);
  hooksAreRegistered(dir, "inactive");
  expect(arcade.requests.filter((each) => each.method === "PATCH")).toEqual([]);
  expect(formOrder(again.stdout)).toEqual(["User Source", "gateway"]);
}, 90_000);

test("a second run whose read-back does not say active fails, and a read-back with no status fails too", async () => {
  const dir = project("turn-on-not-taken");
  expect((await setupArcade(dir)).code).toBe(0);
  dashboardGateway();

  arcade.patchIgnoresStatus = true;
  const ignored = await setupArcade(dir);
  expect(ignored.code).toBe(1);
  expect(ignored.stderr).toContain("the hooks did not turn on: Arcade reads back");
  expect(ignored.stderr).toContain('  - status: Arcade has "inactive", this app needs "active"');
  expect(ignored.stderr).toContain('  - tool.pre.status: Arcade has "inactive", this app needs "active"');
  expect(ignored.stdout).not.toContain("hooks: on.");

  arcade.patchIgnoresStatus = false;
  arcade.omitStatus = true;
  const silent = await setupArcade(dir);
  expect(silent.code).toBe(1);
  expect(silent.stderr).toContain("the hooks did not turn on: Arcade reads back");
  expect(silent.stderr).toContain('  - status: Arcade has nothing, this app needs "active"');
}, 90_000);

test("hooks already on with no gateway are left on, and the run says the gateway form will not list the tools", async () => {
  const dir = project("on-without-gateway");
  expect((await setupArcade(dir)).code).toBe(0);
  dashboardGateway();
  expect((await setupArcade(dir)).code).toBe(0);
  hooksAreRegistered(dir, "active");
  // Somebody deleted the gateway in the dashboard.
  arcade.gateways.clear();
  arcade.requests = [];
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(sequence(arcade.requests)).toEqual(RERUN);
  expect(run.stdout).toContain(
    "hooks: already on, so the dashboard's gateway form will not list the Loan and Approvals tools. Disable loan-approval-limits-hooks in the dashboard before you fill it in",
  );
  hooksAreRegistered(dir, "active");
}, 90_000);

test("a gateway that does not authenticate through the User Source is refused, and the hooks stay disabled", async () => {
  const headers = ["arcade", "header"].join("_");
  for (const authType of ["arcade", headers, undefined]) {
    // A project and an Arcade of its own each time: the provider names each project's own client.
    arcade.stop();
    arcade = new StandIn();
    const dir = project(`gateway-auth-${authType ?? "absent"}`);
    expect((await setupArcade(dir)).code).toBe(0);
    arcade.gateways.clear();
    dashboardGateway({ auth_type: authType, user_source_id: undefined });
    arcade.requests = [];
    const run = await setupArcade(dir);
    expect(run.code, `${authType}: ${run.stdout}\n${run.stderr}`).toBe(1);
    expect(run.stderr).toContain("the gateway loan-approval-limits does not authenticate through the User Source:");
    expect(run.stderr).toContain(`  - auth_type: Arcade has ${JSON.stringify(authType) ?? "nothing"}, this app needs "user_source"`);
    expect(run.stderr).toContain("The hooks are left disabled.");
    expect(run.stderr).toContain("this template never runs a gateway on Arcade Headers or on Arcade accounts");
    expect(arcade.requests.filter((each) => each.method === "PATCH")).toEqual([]);
    hooksAreRegistered(dir, "inactive");
    noGatewayWritten();
  }
}, 120_000);

test("a gateway whose tool list is not the six turns the hooks on anyway, with the differences as warnings", async () => {
  const dir = project("gateway-tools-differ");
  expect((await setupArcade(dir)).code).toBe(0);
  dashboardGateway({ tool_filter: { allowed_tools: ["Loan.SearchLoans", "Loan.GetLoan", "Loan.ApproveLoan", "Approvals.RequestApproval", "Approvals.Decide", "Gmail.SendEmail"] } });
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(run.stdout).toContain("  warning       tool_filter.allowed_tools is missing Loan.DenyLoan");
  expect(run.stdout).toContain("  warning       tool_filter.allowed_tools also has Gmail.SendEmail, which this app does not use");
  expect(run.stdout).toContain("the hooks are turned on anyway. To fix the tool list, disable loan-approval-limits-hooks in the dashboard first");
  hooksAreRegistered(dir, "active");
  noGatewayWritten();
}, 90_000);

test("the retired flag is refused as an unknown option, before anything is sent", async () => {
  const run = await setupArcade(project("retired-flag"), "--user-source", USER_SOURCE);
  expect(run.code).toBe(64);
  expect(run.stderr).toContain("--user-source: not an option of this command");
  expect(run.stderr).toContain("usage: bun run setup-arcade <ngrok-host> [--dry-run] [--skip-deploy] [--redeploy] [--gateway <slug>]");
  expect(arcade.requests).toEqual([]);
});

test("a leftover ARCADE_USER_SOURCE_ID in .env is ignored with a one-line note, not an error", async () => {
  const dir = project("leftover-user-source", (env) => `${env}\nARCADE_USER_SOURCE_ID=${USER_SOURCE}\n`);
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  const notes = run.stdout.split("\n").filter((line) => line.includes("ARCADE_USER_SOURCE_ID"));
  expect(notes).toEqual(["  note          ARCADE_USER_SOURCE_ID is set, and ignored: this command finds the User Source itself, so you can delete it"]);
  expect(`${run.stdout}${run.stderr}`).not.toContain(USER_SOURCE);
  expect(sequence(arcade.requests)).toEqual(FIRST_RUN);
  noGatewayWritten();
}, 60_000);

test("it never writes a gateway and never names Arcade Headers mode, in either run or a dry one", async () => {
  const dir = project("no-headers");
  const first = await setupArcade(dir);
  dashboardGateway();
  const second = await setupArcade(dir);
  const dry = await setupArcade(project("no-headers-dry"), "--dry-run");
  for (const run of [first, second, dry]) expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  const everything = [first.stdout, first.stderr, second.stdout, second.stderr, dry.stdout, dry.stderr, JSON.stringify(arcade.requests), readFileSync(join(ROOT, "scripts", "setup-arcade", "arcade.ts"), "utf8")].join("\n");
  expect(everything).not.toMatch(/arcade_header/i);
  noGatewayWritten();
  expect(arcade.requests.filter((each) => each.path.includes("/gateways")).map((each) => each.method)).toEqual(["GET", "GET"]);
  // Only ever under the project: the bare route has no gateway either.
  expect(arcade.requests.filter((each) => each.path.startsWith("/v1/gateways"))).toEqual([]);
  // The check bites: a gateway write in the log is caught.
  arcade.requests.push({ method: "POST", path: `${SCOPED}/gateways`, authorization: null, body: {} });
  expect(() => noGatewayWritten()).toThrow();
}, 90_000);

/** The routes real Arcade does not have (#28): a bare `/v1/plugins`, and a bare `/v1/hooks`. */
const BARE_PLUGIN_OR_HOOK_ROUTE = /^\/v1\/(plugins|hooks)(\/|\?|$)/;

test("it never calls the bare plugins or hooks route, in a fresh run, a rerun or a dry run: only the project's", async () => {
  const dir = project("no-bare-plugins");
  const first = await setupArcade(dir);
  const again = await setupArcade(dir);
  const dry = await setupArcade(dir, "--dry-run");
  const dryFresh = await setupArcade(project("no-bare-plugins-dry"), "--dry-run");

  const paths = arcade.requests.map((each) => each.path);
  expect(paths.filter((each) => BARE_PLUGIN_OR_HOOK_ROUTE.test(each))).toEqual([]);
  expect(paths.filter((each) => /\/(plugins|hooks)\b/.test(each)).every((each) => each.startsWith(`${SCOPED}/`))).toBe(true);
  for (const run of [dry, dryFresh]) {
    const printed = [...run.stdout.matchAll(/^ {2}(GET|POST|PUT|PATCH|DELETE) (\S+)$/gm)].map(([, , url]) => new URL(url!).pathname);
    expect(printed.length).toBeGreaterThan(0);
    expect(printed.filter((each) => BARE_PLUGIN_OR_HOOK_ROUTE.test(each))).toEqual([]);
  }
  for (const run of [first, again, dry, dryFresh]) expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  // The check bites: the request the pre-#28 script sent first is caught.
  expect(BARE_PLUGIN_OR_HOOK_ROUTE.test("/v1/plugins")).toBe(true);
  expect(BARE_PLUGIN_OR_HOOK_ROUTE.test(`${SCOPED}/plugins`)).toBe(false);
}, 120_000);

test("the stand-in has no bare plugins route, and only the key's own project under the org routes", async () => {
  const call = (method: string, path: string) =>
    fetch(`${arcade.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
  for (const [method, path] of [
    ["GET", "/v1/plugins?limit=100"],
    ["POST", "/v1/plugins"],
    ["PATCH", "/v1/plugins/plg_1"],
    ["POST", "/v1/hooks"],
    ["GET", `/v1/orgs/${ORG}/plugins`],
  ] as const) {
    const answer = await call(method, path);
    expect(answer.status, `${method} ${path}`).toBe(404);
    expect(await answer.text()).toBe('{"name":"route_not_found","message":"requested route is not found or method is not allowed"}');
  }
  expect((await call("GET", `${SCOPED}/plugins`)).status).toBe(200);
  expect((await call("GET", `/v1/orgs/${ORG}/projects/prj_somebody_else/plugins`)).status).toBe(404);
});

test("a tracked .env is refused before anything is read, written or sent", async () => {
  const dir = project("tracked");
  git(dir, "add", "-f", ".env");
  git(dir, "commit", "-q", "-m", "a developer's mistake");
  const before = readFileSync(join(dir, ".env"), "utf8");

  const run = await setupArcade(dir);

  expect(run.code).toBe(1);
  expect(run.stderr).toContain(".env is tracked by git");
  expect(arcade.requests).toEqual([]);
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe(before);
  expect(existsSync(join(dir, "idp.db"))).toBe(false);
});

test("a .env that is not gitignored is refused", async () => {
  const dir = project("not-ignored");
  writeFileSync(join(dir, ".gitignore"), "*.db\n");
  const run = await setupArcade(dir);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain(".env is not gitignored");
  expect(arcade.requests).toEqual([]);
});

test("an existing provider that differs is reported and never edited, and nothing is written", async () => {
  const dir = project("provider-differs");
  arcade.providers.set("app-identity", {
    id: "app-identity",
    type: "oauth2",
    oauth2: {
      client_id: "somebody-elses-client",
      client_secret: { exists: true },
      pkce: { enabled: true, code_challenge_method: "S256" },
      authorize_request: { endpoint: "https://old-host.example/oauth2/authorize" },
      token_request: { endpoint: "https://old-host.example/oauth2/token", auth_method: "client_secret_basic" },
      user_info_request: { endpoint: "https://old-host.example/oauth2/userinfo", auth_method: "bearer_access_token", response_map: { user_id: "$.email" } },
      redirect_uri: CALLBACK,
    },
  });
  const before = readFileSync(join(dir, ".env"), "utf8");

  const run = await setupArcade(dir);

  expect(run.code).toBe(1);
  expect(run.stdout).toContain("oauth2.token_request.endpoint: Arcade has \"https://old-host.example/oauth2/token\", this app needs \"https://template-test.ngrok.app/oauth2/token\"");
  expect(run.stdout).toContain("oauth2.client_id: Arcade has \"somebody-elses-client\"");
  expect(run.stderr).toContain("never edits an existing provider");
  // Two reads, and nothing after them: no PATCH, no DELETE, no re-create, no hooks, no deploys.
  expect(sequence(arcade.requests)).toEqual([GUARD, "GET /v1/admin/auth_providers/app-identity"]);
  expect(projects.get(dir)!.deploys()).toEqual([]);
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe(before);
});

test("running it again changes nothing that is registered and rotates nothing Arcade holds", async () => {
  const dir = project("twice");
  expect((await setupArcade(dir)).code).toBe(0);
  const envAfterFirst = readFileSync(join(dir, ".env"), "utf8");
  const providerAfterFirst = JSON.stringify(arcade.providers.get("app-identity"));
  const pluginAfterFirst = JSON.stringify([...arcade.plugins.values()]);
  arcade.requests = [];

  const again = await setupArcade(dir);

  expect(again.code, `${again.stdout}\n${again.stderr}`).toBe(0);
  expect(again.stdout).toContain("the provider app-identity is already registered and matches");
  expect(again.stdout).toContain("hooks: loan-approval-limits-hooks is already registered and matches; it is left as it is (status inactive)");
  expect(sequence(arcade.requests)).toEqual(RERUN);
  expect(JSON.stringify(arcade.providers.get("app-identity"))).toBe(providerAfterFirst);
  expect(JSON.stringify([...arcade.plugins.values()])).toBe(pluginAfterFirst);
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe(envAfterFirst);
  // The User Source's secret was shown once, on the first run, and is not re-minted.
  expect(again.stdout).toContain("(unchanged, and not shown");
}, 60_000);

test("hooks that differ are updated, because they are not the access model, and read back, keeping their status", async () => {
  const dir = project("hooks-differ");
  expect((await setupArcade(dir)).code).toBe(0);
  // Somebody set the pre hook to fail open in the dashboard, and pointed post elsewhere.
  const [plugin] = [...arcade.plugins.values()] as [Json];
  plugin.webhook_config.endpoints.pre.failure_mode = "fail_open";
  plugin.webhook_config.endpoints.post.url = "https://old-host.example/hooks/post";
  arcade.hooks.find((hook) => hook.hook_point === "tool.pre")!.failure_mode = "fail_open";
  arcade.requests = [];

  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(run.stdout).toContain("hooks: loan-approval-limits-hooks is registered and differs from what this app needs, so it is updated:");
  expect(run.stdout).toContain(`webhook_config.endpoints.post.url: Arcade has "https://old-host.example/hooks/post", this app needs "${ORIGIN}/hooks/post"`);
  expect(run.stdout).toContain('tool.pre.failure_mode: Arcade has "fail_open", this app needs "fail_closed"');
  expect(sequence(arcade.requests).slice(-7, -3)).toEqual([
    `GET ${SCOPED}/hooks?plugin_id={id}`,
    `PATCH ${SCOPED}/plugins/{id}`,
    `GET ${SCOPED}/plugins/{id}`,
    `GET ${SCOPED}/hooks?plugin_id={id}`,
  ]);
  // Still disabled: an update is not the second run, and there is no gateway yet.
  expect((arcade.requests.find((each) => each.method === "PATCH")!.body as Json).status).toBe("inactive");
  hooksAreRegistered(dir, "inactive");
  expect(arcade.plugins.size).toBe(1);
}, 60_000);

test("a verifier setting that does not read back fails the run, naming open risk 2", async () => {
  const dir = project("verifier");
  arcade.verifierIgnoresPut = true;
  const run = await setupArcade(dir);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain("the custom verifier did not take");
  expect(run.stderr).toContain("open risk 2");
});

test("a BETTER_AUTH_SECRET the developer set is kept, and the clients are minted under it", async () => {
  const mine = "a-developer-chosen-better-auth-secret-0123456789abcdef";
  const dir = project("identity-secret", (env) => env.replace(/^BETTER_AUTH_SECRET=$/m, `BETTER_AUTH_SECRET=${mine}`));
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(envOf(dir).BETTER_AUTH_SECRET).toBe(mine);
  expect(run.stdout).toMatch(/kept\s+.*\bBETTER_AUTH_SECRET\b/);
  expect(`${run.stdout}${run.stderr}`).not.toContain(mine);
}, 60_000);

/**
 * The stand-in is a test double for Arcade, so it refuses what Arcade refused
 * (#26). Until then it served `POST /v1/admin/secrets/{key}`, because the pinned
 * spec (and `arcade-js`, generated from it) says POST, and the real API
 * answered the first live run's POST with this 404.
 */
test("the stand-in answers a tool secret POSTed the spec's way with Arcade's own 404", async () => {
  const post = await fetch(`${arcade.url}/v1/admin/secrets/APP_PUBLIC_HOST`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ value: HOST, description: "d" }),
  });
  expect(post.status).toBe(404);
  expect(await post.text()).toBe('{"name":"route_not_found","message":"requested route is not found or method is not allowed"}');
  expect(arcade.secrets.size).toBe(0);

  const put = await fetch(`${arcade.url}/v1/admin/secrets/APP_PUBLIC_HOST`, {
    method: "PUT",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ description: "d", value: HOST }),
  });
  expect(put.status).toBe(200);
  expect(arcade.secrets.get("APP_PUBLIC_HOST")).toBe(HOST);

  // And a PUT with no value is refused, as `value` is required.
  const empty = await fetch(`${arcade.url}/v1/admin/secrets/APPROVALS_STORE_TOKEN`, {
    method: "PUT",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ description: "d" }),
  });
  expect(empty.status).toBe(400);
});

// --- The org and project, and the key's check (#30) --------------------------

test("with no org and project anywhere, the hooks and the gateway fall back to the forms, and the run says why", async () => {
  const dir = project("no-context", (env) => env, null);
  const run = await setupArcade(dir);
  console.log(`--- setup-arcade ${HOST}, with no Arcade CLI context ---\n${run.stdout}${run.stderr}`);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);

  expect(run.stdout).toContain(
    `arcade        no org and project: ARCADE_ORG_ID and ARCADE_PROJECT_ID are unset, and there is no ${projects.get(dir)!.home}/.arcade/credentials.yaml: run \`arcade login\`.`,
  );
  expect(run.stdout).toContain("The hooks and the gateway are printed as dashboard forms instead.");
  expect(run.stdout).toContain("  hooks: no org and project, so the form below");
  // Nothing under any org, and the rest as before.
  expect(arcade.requests.filter((each) => each.path.startsWith("/v1/orgs/"))).toEqual([]);
  expect(sequence(arcade.requests)).toEqual(FIRST_RUN.slice(1, 7));
  expect(projects.get(dir)!.deploys()).toEqual(DEPLOYS);
  expect(formOrder(run.stdout)).toEqual(["User Source", "gateway", "hooks"]);
  hooksFormIsComplete(run.stdout);
  expect(thenList(run.stdout).split("\n").slice(1)).toEqual([
    "  1. Start `bun run dev` (or restart it, if it is already running), so the app reads the new .env.",
    `  2. Start the tunnel: ngrok http --url=${HOST} 3000`,
    "  3. With the app reachable through the tunnel, fill in the User Source form above.",
    "  4. Fill in the gateway form above. It authenticates through the User Source, and lists the toolkits' tools once they are deployed.",
    "  5. Fill in the contextual access hooks form above. Arcade checks /hooks/health through the tunnel.",
    `  6. Open ${ORIGIN}, never localhost, and sign in.`,
  ]);
}, 60_000);

test("ARCADE_ORG_ID and ARCADE_PROJECT_ID win over the CLI's active project", async () => {
  const dir = project(
    "context-from-env",
    (env) => `${env}\nARCADE_ORG_ID=${ORG}\nARCADE_PROJECT_ID=${PROJECT}\n`,
    { orgId: "org_the_cli_has", projectId: "prj_the_cli_has" },
  );
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(run.stdout).toContain(`arcade        org ${ORG}, project ${PROJECT} (from ARCADE_ORG_ID and ARCADE_PROJECT_ID)`);
  expect(run.stdout).toContain("warning       arcade deploy uses the Arcade CLI's active project, not these variables");
  expect(sequence(arcade.requests)).toEqual(FIRST_RUN);
  expect(JSON.stringify(arcade.requests)).not.toContain("prj_the_cli_has");
}, 60_000);

test("one of ARCADE_ORG_ID and ARCADE_PROJECT_ID alone is not enough, and says so", async () => {
  const dir = project("context-half", (env) => `${env}\nARCADE_PROJECT_ID=${PROJECT}\n`);
  const run = await setupArcade(dir, "--dry-run");
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(run.stdout).toContain("no org and project: ARCADE_PROJECT_ID is set without ARCADE_ORG_ID; set both, or neither to use the Arcade CLI's active project");
});

test("a key from another project is stopped by the check before anything is written", async () => {
  const dir = project("key-mismatch", (env) => env, { orgId: ORG, projectId: "prj_not_the_keys" });
  const before = readFileSync(join(dir, ".env"), "utf8");
  const run = await setupArcade(dir);
  console.log(`--- setup-arcade ${HOST}, with the CLI on another project ---\n${run.stdout}${run.stderr}`);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain(`ARCADE_API_KEY and the Arcade project this run resolved disagree: GET /v1/orgs/${ORG}/projects/prj_not_the_keys/plugins?limit=100 answered 404.`);
  expect(run.stderr).toContain(`The project is prj_not_the_keys in the org ${ORG} (from the Arcade CLI's active context`);
  expect(run.stderr).toContain("`arcade project set <project_id>`");
  expect(run.stderr).toContain("or create an API key in the project prj_not_the_keys and put it in ARCADE_API_KEY. Nothing was written.");
  // One read, and nothing else at all.
  expect(sequence(arcade.requests)).toEqual([`GET /v1/orgs/${ORG}/projects/prj_not_the_keys/plugins?limit=100`]);
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe(before);
  expect(existsSync(join(dir, "idp.db"))).toBe(false);
  expect(projects.get(dir)!.deploys()).toEqual([]);
});

test("a key Arcade does not accept is stopped by the same check", async () => {
  const dir = project("key-refused", (env) => env.replace(`ARCADE_API_KEY=${KEY}`, "ARCADE_API_KEY=somebody-elses-key"));
  const run = await setupArcade(dir);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain(`GET ${SCOPED}/plugins?limit=100 answered 401.`);
  expect(arcade.requests).toHaveLength(1);
  expect(existsSync(join(dir, "idp.db"))).toBe(false);
});

// --- The deploys (#30) ------------------------------------------------------

test("a deploy that fails stops the run there: after the hooks, and before the gateway check", async () => {
  const dir = project("deploy-fails");
  dashboardGateway();
  const run = await setupArcade(dir, { failDeployIn: "tools/approvals" });
  expect(run.code).toBe(1);
  expect(projects.get(dir)!.deploys()).toEqual(DEPLOYS);
  expect(run.stdout).toContain("fake arcade: deploy (in");
  expect(run.stderr).toContain("fake arcade: deploy failed");
  expect(run.stderr).toContain("arcade deploy in tools/approvals exited 3; its output is above, and nothing after it ran.");
  expect(run.stderr).toContain("or pass --skip-deploy");
  // The hooks were registered first, disabled, and the gateway never asked for, though it is there.
  hooksAreRegistered(dir, "inactive");
  expect(arcade.requests.filter((each) => each.path.includes("/gateways"))).toEqual([]);
}, 60_000);

test("--skip-deploy runs no deploy, and the steps left say to deploy before the gateway form", async () => {
  const dir = project("skip-deploy");
  const run = await setupArcade(dir, "--skip-deploy");
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(projects.get(dir)!.deploys()).toEqual([]);
  expect(run.stdout).toContain("Deploys: skipped (--skip-deploy).");
  const steps = thenList(run.stdout);
  expect(steps).toContain("3. Deploy both toolkits (their secrets are set above): arcade deploy, in tools/loan and in tools/approvals.");
  const form = steps.search(/fill in the gateway form/i);
  expect(form).toBeGreaterThan(-1);
  expect(steps.indexOf("arcade deploy")).toBeLessThan(form);
  expect(form).toBeLessThan(steps.indexOf("Turn the hooks on"));
}, 60_000);

// --- Resuming from the live project -----------------------------------------

/** Every `oauthClient` row, whole, hashed secrets included: what "minted nothing" is checked against. */
function clientRows(dir: string): string {
  const db = new Database(join(dir, "idp.db"), { readonly: true });
  try {
    return JSON.stringify(db.query(`select * from oauthClient order by id`).all());
  } finally {
    db.close();
  }
}

/**
 * The human's live project after the first real run (#7, 2026-09-25): the
 * provider was created (201) and its callback allowlisted, `.env`'s second
 * block was filled and `idp.db` minted, and the run stopped at the tool
 * secrets' 404, so no secret, no hooks and no verifier were set. The fixed
 * command must pick up from exactly there (#26).
 */
test("a rerun resumes from the live project's state after run 1: the provider matches, nothing is minted or overwritten, and the rest is set", async () => {
  const dir = project("resume-live");

  // How the live project got into that state: the tool secrets answered 404.
  arcade.secretsLikeTheLiveRun = true;
  const first = await setupArcade(dir);
  expect(first.code).toBe(1);
  expect(first.stderr).toContain("setting the tool secret APP_PUBLIC_HOST failed");
  expect(first.stderr).toContain('"name":"route_not_found"');
  expect(first.stderr).toContain("running the same command again picks up from here");

  // The state the issue describes, checked rather than assumed.
  expect(arcade.providers.has("app-identity")).toBe(true);
  expect(existsSync(join(dir, "idp.db"))).toBe(true);
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const section = example.slice(example.indexOf("# --- Filled in by `bun run setup-arcade"), example.indexOf("# --- Optional"));
  const envBefore = envOf(dir);
  for (const [, key] of section.matchAll(/^([A-Z_][A-Z0-9_]*)=$/gm)) expect(envBefore[key!], `block 2 left ${key} blank`).toMatch(/\S/);
  expect(clientsIn(dir).arcade!.redirectUris).toContain(CALLBACK);
  expect(arcade.secrets.size).toBe(0);
  expect(arcade.verifier).toEqual({ verifier_url: "", unsafe_skip_verification: false });

  const envText = readFileSync(join(dir, ".env"), "utf8");
  const rows = clientRows(dir);
  const provider = JSON.stringify(arcade.providers.get("app-identity"));
  arcade.secretsLikeTheLiveRun = false;
  arcade.requests = [];

  const rerun = await setupArcade(dir);
  console.log(`--- setup-arcade ${HOST}, resuming from the live state ---\n${rerun.stdout}${rerun.stderr}`);

  expect(rerun.code, `${rerun.stdout}\n${rerun.stderr}`).toBe(0);
  expect(rerun.stdout).toContain("the provider app-identity is already registered and matches; it is left as it is");
  expect(sequence(arcade.requests)).toEqual(FIRST_RUN.filter((each) => each !== "POST /v1/admin/auth_providers"));
  // Minted nothing, overwrote nothing, re-created nothing.
  expect(clientRows(dir)).toBe(rows);
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe(envText);
  expect(rerun.stdout).toContain("filled   (nothing to fill: every value was already set)");
  expect(JSON.stringify(arcade.providers.get("app-identity"))).toBe(provider);
  // And went on to set the secrets, the verifier and the hooks.
  expect(arcade.secrets.get("APP_PUBLIC_HOST")).toBe(HOST);
  expect(arcade.secrets.get("APPROVALS_STORE_TOKEN")).toBe(envBefore.APPROVALS_STORE_TOKEN);
  hooksAreRegistered(dir, "inactive");
  expect(arcade.verifier).toEqual({ verifier_url: `${ORIGIN}/api/arcade/verify`, unsafe_skip_verification: false });
  expect(rerun.stdout).toContain(`custom verifier: ${ORIGIN}/api/arcade/verify (read back)`);
}, 60_000);

/** The requests a dry run prints, as `METHOD /path`. */
const printedRequests = (stdout: string) =>
  [...stdout.matchAll(/^ {2}(GET|POST|PUT|PATCH|DELETE) \S+?(\/v1\/\S+)$/gm)].map(([, method, path]) => normalise(`${method} ${path}`));

/** What a dry run says only when it is about to create what a resumed project already has (#28). */
const FRESH_ONLY = [
  "would mint the OAuth clients",
  "would fill ",
  "IDP_CLIENT_ID, IDP_CLIENT_SECRET",
  "minted by this run>",
  "/v1/admin/auth_providers\n",
];

test("a dry run of a fresh project describes the real run that follows it", async () => {
  const dir = project("dry-fresh-truth");
  const dry = await setupArcade(dir, "--dry-run");
  expect(dry.code, `${dry.stdout}\n${dry.stderr}`).toBe(0);
  expect(arcade.requests).toEqual([]);

  expect(dry.stdout).toContain("idp.db: would mint the OAuth clients arcade, arcade-user-source, web");
  expect(dry.stdout).toMatch(/would fill .*\bIDP_CLIENT_ID, IDP_CLIENT_SECRET\b.*\bIDP_OAUTH_REDIRECT_URIS_ARCADE\b/);
  expect(dry.stdout).toContain("Client Secret   <its secret, minted by this run>");
  expect(dry.stdout).toContain(`  POST ${arcade.url}/v1/admin/auth_providers\n`);

  // The real run it describes is the one-click one (#52), across both APIs.
  arcade.coordinatorMode = "available";
  const real = await setupArcade(dir, { tty: true, input: "\n" });
  expect(real.code, `${real.stdout}\n${real.stderr}`).toBe(0);
  expect(printedRequests(dry.stdout)).toEqual(combined());
}, 60_000);

/** A dry run's requests as the fallback (#48) sends them: no Coordinator call, and nothing after the gateway check. */
const asFallback = (printed: string[]) => printed.filter((each) => !each.includes("/user_sources")).slice(0, printed.filter((each) => !each.includes("/user_sources")).indexOf(GATEWAY_CHECK) + 1);

/**
 * The human's live project as #30 describes it: after run 3, the provider,
 * both tool secrets and the verifier are set, `.env`'s second block is filled
 * and `idp.db` minted, and there is no plugin and no gateway, because both
 * were dashboard forms. That state is built here by a whole run with the
 * plugin then taken back out, and checked rather than assumed. From it, the
 * dry run and the real rerun must agree, and the second invocation must make
 * the gateway (#28, #30).
 */
test("from the live project's state after run 3, the dry run tells the truth, the rerun adds the hooks disabled, and the run after the gateway turns them on", async () => {
  const dir = project("resume-run-3");
  expect((await setupArcade(dir)).code).toBe(0);
  arcade.plugins.clear();
  arcade.hooks = [];

  expect(arcade.providers.has("app-identity")).toBe(true);
  expect([...arcade.secrets.keys()].sort()).toEqual(["APPROVALS_STORE_TOKEN", "APP_PUBLIC_HOST"]);
  expect(arcade.verifier).toEqual({ verifier_url: `${ORIGIN}/api/arcade/verify`, unsafe_skip_verification: false });
  expect(arcade.gateways.size).toBe(0);
  expect(existsSync(join(dir, "idp.db"))).toBe(true);
  const envBefore = envOf(dir);
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const block2 = example.slice(example.indexOf("# --- Filled in by `bun run setup-arcade"), example.indexOf("# --- Optional"));
  for (const [, key] of block2.matchAll(/^([A-Z_][A-Z0-9_]*)=$/gm)) expect(envBefore[key!], `block 2 left ${key} blank`).toMatch(/\S/);
  const secretsBefore = new Map(arcade.secrets);
  const envText = readFileSync(join(dir, ".env"), "utf8");
  const rows = clientRows(dir);
  const provider = JSON.stringify(arcade.providers.get("app-identity"));
  arcade.requests = [];

  // The dry run: what a real run does from here, and nothing a fresh one does.
  const dry = await setupArcade(dir, "--dry-run");
  console.log(`--- setup-arcade ${HOST} --dry-run, from the live state after run 3 ---\n${dry.stdout}${dry.stderr}`);
  expect(dry.code, `${dry.stdout}\n${dry.stderr}`).toBe(0);
  expect(arcade.requests).toEqual([]);
  for (const phrase of FRESH_ONLY) expect(dry.stdout, `the resumed dry run says ${JSON.stringify(phrase)}`).not.toContain(phrase);
  expect(dry.stdout).toContain(".env: nothing to fill: every value is already set, and none is overwritten");
  expect(dry.stdout).toContain("idp.db: already holds the OAuth clients");
  expect(dry.stdout).toContain("  no secret is minted or rotated");
  expect(dry.stdout).toContain("(expected 200: .env holds the callback Arcade made for this provider.");
  expect(dry.stdout).toContain("If Arcade answers 404 instead, a real run mints a new secret for the");
  expect(dry.stdout).toContain("Client Secret   (unchanged, and not shown");
  expect(bodyAfter(dry.stdout, `  POST ${arcade.url}${SCOPED}/plugins\n`).webhook_config.auth.token).toBe("<ARCADE_HOOK_SIGNING_SECRET from .env>");
  expect(formOrder(dry.stdout)).toEqual(["User Source", "gateway"]);
  // The check bites: the fresh project's dry run says every one of them.
  const fresh = await setupArcade(project("resume-run-3-fresh"), "--dry-run");
  for (const phrase of FRESH_ONLY) expect(fresh.stdout).toContain(phrase);

  // The real rerun.
  const rerun = await setupArcade(dir);
  console.log(`--- setup-arcade ${HOST}, from the live state after run 3 ---\n${rerun.stdout}${rerun.stderr}`);
  expect(rerun.code, `${rerun.stdout}\n${rerun.stderr}`).toBe(0);
  const called = sequence(arcade.requests);
  expect(called).toEqual(FIRST_RUN.filter((each) => each !== "POST /v1/admin/auth_providers"));
  // This rerun falls back (the Coordinator answers 404), so it is the dry run's fallback half.
  expect(asFallback(printedRequests(dry.stdout))).toEqual(called);
  hooksAreRegistered(dir, "inactive");

  // In this order: the project, the key's check, provider matches, .env has nothing to fill, both secrets, the verifier, the hooks, the deploys, the gateway check, both forms.
  const at = (text: string) => {
    const index = rerun.stdout.indexOf(text);
    expect(index, `the rerun never printed ${JSON.stringify(text)}`).toBeGreaterThan(-1);
    return index;
  };
  const marks = [
    at(`arcade        org ${ORG}, project ${PROJECT}`),
    at(`the key answers for the project ${PROJECT}`),
    at("the provider app-identity is already registered and matches"),
    at("filled   (nothing to fill: every value was already set)"),
    at("PUT /v1/admin/secrets/APP_PUBLIC_HOST → 200"),
    at("PUT /v1/admin/secrets/APPROVALS_STORE_TOKEN → 200"),
    at(`custom verifier: ${ORIGIN}/api/arcade/verify (read back)`),
    at("hooks: created loan-approval-limits-hooks"),
    at("arcade deploy   (in tools/loan):"),
    at("arcade deploy   (in tools/approvals):"),
    at("gateway: there is no loan-approval-limits in this project yet"),
    at("┌─ Arcade dashboard → your project → User Sources"),
    at("┌─ Arcade dashboard → your project → MCP Gateways"),
    at("Then:"),
    at("warning: until then the gateway runs ungoverned."),
  ];
  expect([...marks].sort((a, b) => a - b)).toEqual(marks);

  // Idempotent: the same secrets, nothing minted, nothing overwritten, nothing re-created.
  expect(arcade.secrets).toEqual(secretsBefore);
  expect(clientRows(dir)).toBe(rows);
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe(envText);
  expect(JSON.stringify(arcade.providers.get("app-identity"))).toBe(provider);
  expect(`${rerun.stdout}${dry.stdout}`).not.toContain(envBefore.ARCADE_HOOK_SIGNING_SECRET!);

  // And the second invocation, once the User Source and the gateway exist: the hooks turned on.
  dashboardGateway();
  const second = await setupArcade(dir);
  expect(second.code, `${second.stdout}\n${second.stderr}`).toBe(0);
  hooksAreRegistered(dir, "active");
  noGatewayWritten();
}, 120_000);

// --- What the run is told, and by whom (#30, F6 and F7) ----------------------

test("the stand-in refuses a health_check_path that is not a URL with the body Arcade sent the fourth live run", async () => {
  const create = (health: string) =>
    fetch(`${arcade.url}${SCOPED}/plugins`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "x", plugin_type: "webhook", webhook_config: { health_check_path: health, endpoints: {} } }),
    });
  const path = await create("/hooks/health");
  expect(path.status).toBe(400);
  expect(await path.text()).toBe(
    '{"name":"malformed_request","message":"failed to validate request body: webhook_config: health_check_path must be a valid URL","field_errors":[{"field":"webhook_config.health_check_path","rule":"url","message":"health_check_path must be a valid URL"}]}',
  );
  expect((await create(`${ORIGIN}/hooks/health`)).status).toBe(201);
});

test("a refusal that is not about reaching the app prints Arcade's own message, and no advice about the tunnel", async () => {
  const dir = project("hooks-refused");
  arcade.nextPluginCreate = { status: 400, body: HEALTH_CHECK_NOT_A_URL };
  const run = await setupArcade(dir);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain("creating the contextual access hooks failed: POST");
  expect(run.stderr).toContain("Arcade says: failed to validate request body: webhook_config: health_check_path must be a valid URL");
  expect(run.stderr).not.toMatch(/tunnel|bun run dev/);
});

test("a refusal about reaching the app says to start it and the tunnel", async () => {
  const dir = project("hooks-unreachable");
  // Nobody has seen Arcade's answer for an unreachable health check: this is the wording the check looks for.
  arcade.nextPluginCreate = { status: 422, body: { name: "health_check_failed", message: `health check failed: dial tcp: lookup ${HOST}: no such host` } };
  const run = await setupArcade(dir);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain(`Arcade says: health check failed: dial tcp: lookup ${HOST}: no such host`);
  expect(run.stderr).toContain(`Arcade could not reach ${ORIGIN}/hooks/health: start \`bun run dev\` and the tunnel first.`);
});

test("setup-arcade manages exactly .env.example's required values and its second block", async () => {
  const { REQUIRED_KEYS, WRITTEN_KEYS } = await import("../scripts/setup-arcade/env-file.ts");
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const block = (from: string, to: string) =>
    [...example.slice(example.indexOf(from), example.indexOf(to)).matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map(([, key]) => key!).sort();
  expect(([...REQUIRED_KEYS] as string[]).sort()).toEqual(block("# --- Required", "# --- Filled in by `bun run setup-arcade"));
  expect(([...WRITTEN_KEYS] as string[]).sort()).toEqual(block("# --- Filled in by `bun run setup-arcade", "# --- Optional"));
});

/**
 * The fourth live run (#7, F7): a fresh clone, a fresh `.env` with its second
 * block blank, and a shell that still exported the previous clone's `.env`
 * (`set -a; . ./.env`). The shell won, the run said ".env: nothing to fill",
 * the provider was created with the shell's old `arcade` client, and
 * `bun run dev`, which reads `.env`, had no BETTER_AUTH_SECRET. The run now
 * stops before it sends or writes anything, and names the keys, never the values.
 */
test("a shell that still exports an old .env is refused before anything is sent or written, naming the keys and not the values", async () => {
  const old = project("old-clone");
  expect((await setupArcade(old)).code).toBe(0);
  const exported = envOf(old);
  const managed = (await import("../scripts/setup-arcade/env-file.ts")).MANAGED_KEYS;
  const shell = Object.fromEntries(Object.entries(exported).filter(([key, value]) => managed.includes(key) && value !== ""));
  expect(Object.keys(shell)).toContain("BETTER_AUTH_SECRET");
  arcade.requests = [];

  // The seven filled in, as the human's were, and the second block blank.
  const dir = project("fresh-clone", (env) => env.replace(/^APP_PUBLIC_HOST=$/m, `APP_PUBLIC_HOST=${HOST}`));
  const before = readFileSync(join(dir, ".env"), "utf8");
  const run = await setupArcade(dir, { shell });
  console.log(`--- setup-arcade ${HOST}, with the old clone's .env exported ---\n${run.stdout}${run.stderr}`);
  expect(run.code).toBe(1);
  const refused = Object.keys(shell).filter((key) => (envOf(dir)[key] ?? "") !== shell[key]);
  expect(refused.length).toBeGreaterThan(5);
  expect(run.stderr).toContain(`${refused.join(", ")} are exported in this shell with a value .env does not hold`);
  expect(run.stderr).toContain(`Open a new terminal, or run: unset ${refused.join(" ")}`);
  expect(run.stderr).toContain("Nothing was sent or written.");
  // The keys an old .env shares with this one (the API key, the host, the personas) are no conflict.
  expect(run.stderr).not.toMatch(/\bARCADE_API_KEY\b|\bAPP_PUBLIC_HOST\b/);
  // Names only.
  for (const key of refused) expect(`${run.stdout}${run.stderr}`, `the run printed ${key}'s value`).not.toContain(shell[key]!);
  expect(arcade.requests).toEqual([]);
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe(before);
  expect(existsSync(join(dir, "idp.db"))).toBe(false);
  expect(projects.get(dir)!.deploys()).toEqual([]);
  // A dry run says the same.
  expect((await setupArcade(dir, "--dry-run", { shell })).code).toBe(1);

  // In a new terminal: the second block is filled into this .env, BETTER_AUTH_SECRET included,
  // and the provider's callback is allowlisted with no "add it yourself" warning. The
  // provider the old clone made names the old client, so it is taken away first, as a
  // human would delete it in the dashboard (the next test is what happens if not).
  arcade.providers.clear();
  arcade.plugins.clear();
  const clean = await setupArcade(dir);
  expect(clean.code, `${clean.stdout}\n${clean.stderr}`).toBe(0);
  const env = envOf(dir);
  expect(env.BETTER_AUTH_SECRET).toMatch(/^[0-9a-f]{64}$/);
  expect(env.BETTER_AUTH_SECRET).not.toBe(exported.BETTER_AUTH_SECRET);
  expect(env.IDP_OAUTH_REDIRECT_URIS_ARCADE).toBe(CALLBACK);
  expect(clean.stdout).not.toContain("add it to IDP_OAUTH_REDIRECT_URIS_ARCADE yourself");
  expect(clean.stdout).toContain("allowlisted the provider's callback on the arcade client");
  expect((arcade.providers.get("app-identity") as Json).oauth2.client_id).toBe(clientsIn(dir).arcade!.clientId);
}, 120_000);

test("in a new terminal, a provider the old clone created is reported, and never edited", async () => {
  expect((await setupArcade(project("old-clone-2"))).code).toBe(0);
  const run = await setupArcade(project("fresh-clone-2"));
  expect(run.code).toBe(1);
  expect(run.stdout).toContain("The provider app-identity already exists in this Arcade project, and it is not what this app needs:");
  expect(run.stdout).toContain("oauth2.client_id: Arcade has");
  expect(run.stderr).toContain("never edits an existing provider");
}, 60_000);

test("a shell that exports the same values as .env is no conflict", async () => {
  const dir = project("shell-agrees");
  const run = await setupArcade(dir, { shell: { ARCADE_API_KEY: KEY, SESSION_SECRET: "" } });
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(envOf(dir).SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/);
}, 60_000);

// --- A read-back that leaves fields out (#30, run 4's retry) ------------------

/**
 * Real Arcade, on the fourth live run's retry: `POST …/plugins → 201`, both
 * read-backs 200, and no `webhook_config.health_check_path` in the plugin's.
 * The run stopped with "the hooks did not take". The stand-in's read-back has
 * that shape by default, and this is the live project's state from there.
 */
test("a read-back without health_check_path is a warning, and a rerun from that state neither re-creates nor loops", async () => {
  const dir = project("health-not-echoed");
  const first = await setupArcade(dir);
  console.log(`--- setup-arcade ${HOST}, Arcade not echoing health_check_path ---\n${first.stdout}${first.stderr}`);
  expect(first.code, `${first.stdout}\n${first.stderr}`).toBe(0);
  const warning = `hooks: Arcade doesn't echo webhook_config.health_check_path back; it was sent as ${ORIGIN}/hooks/health and can't be verified`;
  expect(first.stdout).toContain(warning);
  expect(first.stdout).not.toContain("the hooks did not take");
  // It carried on: the deploys ran, and the run ended on both forms.
  expect(projects.get(dir)!.deploys()).toEqual(DEPLOYS);
  expect(formOrder(first.stdout)).toEqual(["User Source", "gateway"]);
  // What was sent is what the app needs, whatever the read-back says.
  hooksAreRegistered(dir, "inactive");

  for (const attempt of [1, 2]) {
    arcade.requests = [];
    const rerun = await setupArcade(dir);
    expect(rerun.code, `rerun ${attempt}: ${rerun.stdout}\n${rerun.stderr}`).toBe(0);
    expect(rerun.stdout).toContain("hooks: loan-approval-limits-hooks is already registered and matches; it is left as it is (status inactive)");
    expect(rerun.stdout).toContain(warning);
    // Found by name: no second plugin, and no PATCH for a field it cannot see.
    expect(sequence(arcade.requests)).toEqual(RERUN);
    expect(arcade.plugins.size).toBe(1);
  }
}, 120_000);

test("a health_check_path read back present but different still fails the run", async () => {
  const dir = project("health-differs");
  arcade.healthCheckReadBack = "https://old-host.example/hooks/health";
  const run = await setupArcade(dir);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain("the hooks did not take: Arcade reads back");
  expect(run.stderr).toContain(`webhook_config.health_check_path: Arcade has "https://old-host.example/hooks/health", this app needs "${ORIGIN}/hooks/health"`);
  expect(projects.get(dir)!.deploys()).toEqual([]);
}, 60_000);

test("a health_check_path Arcade does echo is checked, and the line says so", async () => {
  const dir = project("health-echoed");
  arcade.healthCheckReadBack = "stored";
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(run.stdout).toContain(`hooks: ${ORIGIN}/hooks/access, /hooks/pre and /hooks/post, fail closed, health check ${ORIGIN}/hooks/health, status inactive (read back)`);
  expect(run.stdout).not.toContain("doesn't echo webhook_config.health_check_path");
}, 60_000);

test("an endpoint URL missing from the read-back means the hooks did not take", async () => {
  const dir = project("endpoint-missing");
  arcade.omitEndpointUrl = "pre";
  const run = await setupArcade(dir);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain(`webhook_config.endpoints.pre.url: Arcade has nothing, this app needs "${ORIGIN}/hooks/pre"`);
  expect(projects.get(dir)!.deploys()).toEqual([]);
}, 60_000);

// --- The deploys, unattended (#30, run 4) -------------------------------------

test("arcade deploy is given no stdin, so its logs prompt never waits for a key", async () => {
  const dir = project("deploy-no-stdin");
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  const log = join(scratch, "deploy-no-stdin.arcade.log.stdin");
  const seen = readFileSync(log, "utf8").trim().split("\n").map((line) => line.split("|")[1]);
  // Both deploys, and neither had the pipe setup-arcade itself was given.
  expect(seen).toEqual(["stdin=none", "stdin=none"]);
  // And the CLI's own line about the secrets is called out as expected, next to the deploys.
  expect(run.stdout).toContain(`Secret 'APP_PUBLIC_HOST' not found in environment, skipping upload". That is expected:`);
  expect(run.stdout.indexOf("That is expected:")).toBeLessThan(run.stdout.indexOf("arcade deploy   (in tools/loan):"));
}, 60_000);

// --- The provider's callback follows the provider (#30, run 4) ----------------

/**
 * Run 4: app-identity was recreated in the dashboard, Arcade made it a new
 * callback, and `.env` still named the old one. The run only warned ("add it
 * … yourself"), and hop 2's Authorize failed with invalid_redirect. The live
 * provider is the source of truth for this one variable.
 */
test("a provider recreated with a new callback: the rerun replaces it in .env and on the allowlist, with no hand edit", async () => {
  const dir = project("callback-replaced");
  expect((await setupArcade(dir)).code).toBe(0);
  expect(envOf(dir).IDP_OAUTH_REDIRECT_URIS_ARCADE).toBe(CALLBACK);

  // Deleted and created again: a new provider, a new callback.
  const recreated = "https://cloud.arcade.dev/api/v1/oauth/stand_in_ap_2/callback";
  arcade.providers.clear();
  arcade.nextCallback = recreated;
  const envBefore = envOf(dir);
  const rerun = await setupArcade(dir);
  console.log(`--- setup-arcade ${HOST}, after the provider was recreated ---\n${rerun.stdout}${rerun.stderr}`);
  expect(rerun.code, `${rerun.stdout}\n${rerun.stderr}`).toBe(0);

  expect(rerun.stdout).toContain(`replaced the provider's callback: ${CALLBACK} -> ${recreated}`);
  expect(rerun.stdout).not.toContain("yourself");
  expect(envOf(dir).IDP_OAUTH_REDIRECT_URIS_ARCADE).toBe(recreated);
  // Exactly the new one: the old provider's callback no longer passes.
  expect(clientsIn(dir).arcade!.redirectUris).toEqual([recreated]);
  // Every other value on file is kept, as ever.
  for (const [key, value] of Object.entries(envBefore)) if (key !== "IDP_OAUTH_REDIRECT_URIS_ARCADE") expect(envOf(dir)[key], key).toBe(value);

  // And a third run has nothing to replace.
  const again = await setupArcade(dir);
  expect(again.code).toBe(0);
  expect(again.stdout).not.toContain("replaced the provider's callback");
  expect(again.stdout).not.toContain("allowlisted the provider's callback");
}, 90_000);

// --- A rerun does not redeploy what Arcade already runs (#30, run 4) ----------

/**
 * Run 4: the second run, which then created the gateway, cost two full deploys of unchanged code.
 * Before each deploy the run asks what the Arcade CLI asks
 * (`server_already_exists`, `GET …/workers/<name>`): 404 deploys it, found
 * skips it. Arcade's answer has no version to compare, so --redeploy is the
 * way to ship a changed toolkit.
 */
test("a toolkit Arcade already runs is skipped, and one it does not is deployed", async () => {
  const dir = project("deploy-skip");
  arcade.workers.add("loan");
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(run.stdout).toContain("  tools/loan: already deployed on Arcade, skipped (pass --redeploy after changing it)");
  expect(run.stdout).not.toContain("arcade deploy   (in tools/loan):");
  // approvals answered 404, so it was deployed.
  expect(projects.get(dir)!.deploys()).toEqual(["tools/approvals|deploy"]);
  expect(sequence(arcade.requests).filter((each) => each.includes("/workers/"))).toEqual([`GET ${SCOPED}/workers/loan`, `GET ${SCOPED}/workers/approvals`]);
}, 60_000);

test("a second run with both toolkits on Arcade deploys nothing, and the hooks are still turned on after", async () => {
  const dir = project("deploy-skip-both");
  expect((await setupArcade(dir)).code).toBe(0);
  arcade.workers.add("loan");
  arcade.workers.add("approvals");
  dashboardGateway();
  const run = await setupArcade(dir);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(projects.get(dir)!.deploys()).toEqual(DEPLOYS);
  expect(run.stdout).toContain("  tools/approvals: already deployed on Arcade, skipped (pass --redeploy after changing it)");
  hooksAreRegistered(dir, "active");
}, 60_000);

test("--redeploy deploys both whatever Arcade runs, and asks it nothing", async () => {
  const dir = project("deploy-redeploy");
  arcade.workers.add("loan");
  arcade.workers.add("approvals");
  const run = await setupArcade(dir, "--redeploy");
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(projects.get(dir)!.deploys()).toEqual(DEPLOYS);
  expect(arcade.requests.filter((each) => each.path.includes("/workers/"))).toEqual([]);
  const dry = await setupArcade(dir, "--dry-run", "--redeploy");
  expect(dry.stdout).toContain("(--redeploy: both, whatever Arcade already runs)");
  expect(dry.stdout).not.toContain("/workers/");
}, 60_000);

test("a worker lookup that fails for another reason stops the run with Arcade's message", async () => {
  const dir = project("deploy-lookup-fails");
  arcade.workerLookup = { status: 500, body: { name: "internal", message: "the engine is having a moment" } };
  const run = await setupArcade(dir);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain(`checking whether tools/loan is deployed failed: GET ${SCOPED}/workers/loan answered 500`);
  expect(run.stderr).toContain("Arcade says: the engine is having a moment");
  expect(projects.get(dir)!.deploys()).toEqual([]);
}, 60_000);

// --- One click, through the Coordinator API (#52) -----------------------------

const SIX_TOOLS = ["Loan.SearchLoans", "Loan.GetLoan", "Loan.ApproveLoan", "Loan.DenyLoan", "Approvals.RequestApproval", "Approvals.Decide"];
/** Enter, once, at the pause: what a developer does after restarting `bun run dev`. */
const ENTER: RunOptions = { tty: true, input: "\n" };

/** Everything the stand-ins hold, secrets included: what "the rerun changed nothing" is checked against. */
function arcadeState(): string {
  return JSON.stringify({
    providers: [...arcade.providers.values()],
    secrets: [...arcade.secrets.entries()],
    verifier: arcade.verifier,
    plugins: [...arcade.plugins.values()],
    hooks: arcade.hooks,
    gateways: [...arcade.gateways.values()],
    userSources: [...arcade.userSources.values()],
  });
}

/** Where `needle` first appears in the stand-ins' shared timeline; fails when it never does. */
function when(needle: string): number {
  const index = arcade.timeline.findIndex((each) => each.startsWith(needle));
  expect(index, `nothing in the timeline starts with ${needle}:\n${arcade.timeline.join("\n")}`).toBeGreaterThan(-1);
  return index;
}

test("one run, one click: the User Source is created through the Coordinator, the gateway through it with the six tools, then the hooks on, each read back", async () => {
  const dir = project("one-click");
  arcade.coordinatorMode = "available";
  // The worst case of #48's finding, assumed of the API: active hooks hide the tools from a gateway create.
  expect(arcade.activeHooksHideTools).toBe(true);
  const run = await setupArcade(dir, ENTER);
  console.log(`--- setup-arcade ${HOST}, one click ---\n${run.stdout}${run.stderr}`);
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);

  // Arcade's API: #48's first run, then the gateway created and read back, then the hooks on and read back.
  expect(sequence(arcade.requests)).toEqual([...FIRST_RUN, ...ONE_CLICK_TAIL]);
  // The Coordinator: the list, the create, the read-back, all with the project key.
  expect(coordinatorSequence()).toEqual(ONE_CLICK_COORDINATOR);
  for (const request of arcade.coordinatorRequests) expect(request.authorization).toBe(`Bearer ${KEY}`);

  // The User Source: the dashboard form's fields, the app's own client.
  const clients = clientsIn(dir);
  expect(arcade.userSources.size).toBe(1);
  const [source] = [...arcade.userSources.values()] as [Json];
  expect(source.name).toBe("Loan Approval Limits");
  expect(source.issuer_url).toBe(ORIGIN);
  expect(source.client_id).toBe(clients["arcade-user-source"]!.clientId);
  expect(source.client_secret).toMatch(/^\S{16,}$/);
  expect(source.scopes).toBe("openid profile email");
  expect(source.subject_claim).toBe("email");
  expect(clients["arcade-user-source"]!.redirectUris).toEqual([source.redirect_uri]);
  expect(`${run.stdout}${run.stderr}`).not.toContain(source.client_secret);

  // The gateway: through that User Source, never Headers, exactly the six tools.
  const created = arcade.requests.find((each) => each.method === "POST" && each.path === `${SCOPED}/gateways`)!.body as Json;
  expect(created).toEqual({
    name: "Loan Approval Limits",
    description: "The loan officer's agent",
    slug: "loan-approval-limits",
    auth_type: "user_source",
    user_source_id: source.id,
    tool_filter: { allowed_tools: SIX_TOOLS },
  });
  expect(arcade.gateways.size).toBe(1);
  hooksAreRegistered(dir, "active");

  // The order, across both APIs: the tunnel checked, then the User Source, then the gateway, then the hooks on, last.
  const order = [
    when("arcade POST /v1/orgs/org_standin/projects/prj_standin/plugins"),
    when("tunnel GET /.well-known/openid-configuration"),
    when(`coordinator POST ${USER_SOURCES}`),
    when(`arcade POST ${SCOPED}/gateways`),
    when(`arcade PATCH ${SCOPED}/plugins/`),
  ];
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(arcade.timeline.at(-1)).toStartWith(`arcade GET ${SCOPED}/hooks?plugin_id=`);

  // What it said: the pause, each step read back, and nothing left for the dashboard.
  expect(run.stdout).toContain("Restart `bun run dev` so it reads the new .env, with the tunnel up (ngrok http --url=template-test.ngrok.app 3000), then press Enter.");
  expect(run.stdout).toContain(`the app answers for ${ORIGIN} through the tunnel`);
  expect(run.stdout).toContain(`user source: created Loan Approval Limits (${source.id}), issuer ${ORIGIN}, client ${source.client_id} (read back)`);
  expect(run.stdout).toContain(`gateway: created loan-approval-limits, through the User Source ${source.id}, with the six tools of Loan and Approvals (read back)`);
  expect(run.stdout).toContain(`hooks: ${ORIGIN}/hooks/access, /hooks/pre and /hooks/post, fail closed, status active (read back)`);
  expect(run.stdout).toContain("hooks: on. Arcade now calls /hooks/access, /hooks/pre and /hooks/post for every tool call through loan-approval-limits");
  expect(formOrder(run.stdout)).toEqual([]);
  expect(run.stdout).not.toMatch(/ungoverned|dashboard flow/);
  expect(thenList(run.stdout).split("\n").slice(1)).toEqual([
    "  1. Start `bun run dev` (or restart it, if it is already running), so the app reads the new .env.",
    `  2. Start the tunnel: ngrok http --url=${HOST} 3000`,
    `  3. Open ${ORIGIN}, never localhost, and sign in.`,
  ]);
  expect(`${run.stdout}${run.stderr}`).not.toContain(KEY);
  expect(JSON.stringify([...arcade.requests, ...arcade.coordinatorRequests])).not.toMatch(/arcade_header/i);
}, 60_000);

test("a rerun after one click is a no-op that says so: nothing paused, created, rotated or turned on", async () => {
  const dir = project("one-click-rerun");
  arcade.coordinatorMode = "available";
  expect((await setupArcade(dir, ENTER)).code).toBe(0);
  const state = arcadeState();
  const envText = readFileSync(join(dir, ".env"), "utf8");
  const rows = clientRows(dir);
  arcade.requests = [];
  arcade.coordinatorRequests = [];
  arcade.tunnelRequests = 0;

  // No input: a run that paused would read the end of stdin and fall back, which the checks below would catch.
  const again = await setupArcade(dir, { tty: true, input: "" });
  console.log(`--- setup-arcade ${HOST}, one click, again ---\n${again.stdout}${again.stderr}`);
  expect(again.code, `${again.stdout}\n${again.stderr}`).toBe(0);
  const [source] = [...arcade.userSources.values()] as [Json];
  expect(again.stdout).toContain(`user source: found Loan Approval Limits (${source.id}), issuer ${ORIGIN}, client ${source.client_id}; it matches and is left as it is`);
  expect(again.stdout).toContain(`gateway: found loan-approval-limits, through the User Source ${source.id}`);
  expect(again.stdout).toContain("hooks: already on (status active); nothing to do");
  expect(again.stdout).not.toMatch(/press Enter|dashboard flow|created/);
  expect(arcade.tunnelRequests).toBe(0);
  expect(coordinatorSequence()).toEqual([`GET ${USER_SOURCES}`]);
  expect(sequence(arcade.requests)).toEqual(RERUN);
  // Its only writes are the upserts every run sends, with the same values.
  expect(arcade.requests.filter((each) => each.method !== "GET").map((each) => `${each.method} ${each.path}`)).toEqual([
    "PUT /v1/admin/secrets/APP_PUBLIC_HOST",
    "PUT /v1/admin/secrets/APPROVALS_STORE_TOKEN",
    "PUT /v1/admin/settings/session_verification",
  ]);
  expect(arcadeState()).toBe(state);
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe(envText);
  expect(clientRows(dir)).toBe(rows);
  expect(formOrder(again.stdout)).toEqual([]);
}, 90_000);

/** The part of a fallback run from the #48 gateway check on, with what differs per project written the same way. */
function afterFallback(stdout: string): string {
  const at = stdout.indexOf("\nThe gateway (");
  expect(at, "no #48 gateway check after the fallback").toBeGreaterThan(-1);
  return stdout
    .slice(at)
    .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:{port}")
    .replace(/(Client ID {7})\S+/, "$1{id}")
    .replace(/(Client Secret {3})\S+/, "$1{secret}");
}

/** The one line a fallback prints, and it alone: the coordinator's, or the pause's. */
function fallbackLines(stdout: string): string[] {
  return stdout.split("\n").filter((line) => /The rest is the dashboard flow \(#48\):$/.test(line));
}

/** A fresh run that fell back: #48's first run exactly, the hooks disabled, both forms, nothing written by the one-click path. */
function isTheFallback(dir: string, run: { code: number; stdout: string; stderr: string }, baseline: string | null): void {
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(sequence(arcade.requests)).toEqual(FIRST_RUN);
  hooksAreRegistered(dir, "inactive");
  noGatewayWritten();
  expect(arcade.gateways.size).toBe(0);
  expect(formOrder(run.stdout)).toEqual(["User Source", "gateway"]);
  expect(run.stdout.trimEnd().split("\n").slice(-2)).toEqual([
    "warning: until then the gateway runs ungoverned. The hooks are disabled, so Arcade calls none of",
    `${ORIGIN}/hooks/access, /hooks/pre and /hooks/post, and every tool call runs unchecked.`,
  ]);
  if (baseline !== null) expect(afterFallback(run.stdout)).toBe(baseline);
}

test("any failure of the Coordinator call prints one line naming it and its status, then runs the #48 flow unchanged", async () => {
  // The baseline: the Coordinator answers 404, as the project key's `…/user_sources` did on api.arcade.dev (#7).
  const base = project("fallback-404");
  const first = await setupArcade(base, ENTER);
  console.log(`--- setup-arcade ${HOST}, the Coordinator answering 404 ---\n${first.stdout}${first.stderr}`);
  expect(fallbackLines(first.stdout)).toEqual([
    `  coordinator: GET ${arcade.coordinatorUrl}${USER_SOURCES} answered 404. The rest is the dashboard flow (#48):`,
  ]);
  isTheFallback(base, first, null);
  const baseline = afterFallback(first.stdout);

  const list = `GET {coordinator}${USER_SOURCES}`;
  const create = `POST {coordinator}${USER_SOURCES}`;
  const triggers: Array<{ name: string; arrange: () => void; options?: RunOptions; line: string }> = [
    { name: "401", arrange: () => (arcade.nextCoordinator.GET = { status: 401, body: { message: "unauthorized" } }), line: `${list} answered 401` },
    { name: "403", arrange: () => (arcade.nextCoordinator.GET = { status: 403, body: { message: "forbidden" } }), line: `${list} answered 403` },
    { name: "500", arrange: () => (arcade.nextCoordinator.GET = { status: 500, body: { message: "internal" } }), line: `${list} answered 500` },
    { name: "503", arrange: () => (arcade.nextCoordinator.GET = { status: 503, body: "upstream connect error" }), line: `${list} answered 503` },
    {
      name: "network",
      arrange: () => {},
      options: { shell: { ARCADE_COORDINATOR_URL: "http://127.0.0.1:9/api" } },
      line: `GET http://127.0.0.1:9/api${USER_SOURCES} answered a network error`,
    },
    { name: "another list shape", arrange: () => (arcade.nextCoordinator.GET = { status: 200, body: { user_sources: [] } }), line: `${list} answered 200 with a body that is not a list of User Sources` },
    { name: "a bare array", arrange: () => (arcade.nextCoordinator.GET = { status: 200, body: [] }), line: `${list} answered 200 with a body that is not a list of User Sources` },
    { name: "an entry with no id", arrange: () => (arcade.nextCoordinator.GET = { status: 200, body: { items: [{ name: "x", issuer_url: ORIGIN }] } }), line: `${list} answered 200 with a body that is not a list of User Sources` },
    { name: "not JSON", arrange: () => (arcade.nextCoordinator.GET = { status: 200, body: "<html>sign in</html>" }), line: `${list} answered 200 with a body that is not JSON` },
    { name: "the create refused", arrange: () => (arcade.nextCoordinator.POST = { status: 500, body: { message: "internal" } }), line: `${create} answered 500` },
    { name: "the create in another shape", arrange: () => (arcade.nextCoordinator.POST = { status: 201, body: { ok: true } }), line: `${create} answered 201 with a body that is not a User Source` },
  ];
  for (const trigger of triggers) {
    arcade.stop();
    arcade = new StandIn();
    arcade.coordinatorMode = "available";
    trigger.arrange();
    const dir = project(`fallback-${trigger.name.replace(/\W+/g, "-")}`);
    const run = await setupArcade(dir, { ...ENTER, ...trigger.options });
    const lines = fallbackLines(run.stdout);
    expect(lines, `${trigger.name}:\n${run.stdout}\n${run.stderr}`).toHaveLength(1);
    expect(lines[0]!.replace(arcade.coordinatorUrl, "{coordinator}"), trigger.name).toStartWith(`  coordinator: ${trigger.line}`);
    isTheFallback(dir, run, baseline);
    // Nothing was created where the Coordinator answered wrong.
    expect(arcade.userSources.size, trigger.name).toBe(0);
  }
}, 180_000);

test("the Coordinator host is ARCADE_COORDINATOR_URL, default https://cloud.arcade.dev/api, and experience.arcade.dev is refused before anything is sent", async () => {
  const { coordinatorUrl, DEFAULT_COORDINATOR_URL } = await import("../scripts/setup-arcade/coordinator.ts");
  expect(DEFAULT_COORDINATOR_URL).toBe("https://cloud.arcade.dev/api");
  expect(coordinatorUrl(undefined)).toEqual({ url: "https://cloud.arcade.dev/api" });
  expect(coordinatorUrl("  ")).toEqual({ url: "https://cloud.arcade.dev/api" });
  expect(coordinatorUrl("http://127.0.0.1:4410/api/")).toEqual({ url: "http://127.0.0.1:4410/api" });
  for (const refused of ["https://experience.arcade.dev/api", "https://EXPERIENCE.arcade.dev", "https://eu.experience.arcade.dev/api"]) {
    expect(coordinatorUrl(refused).url, refused).toBeNull();
  }
  expect(coordinatorUrl("cloud.arcade.dev").url).toBeNull();

  // The default, in a dry run, which sends nothing: the request it names is on cloud.arcade.dev.
  const dry = await setupArcade(project("coordinator-default-dry"), "--dry-run", { shell: { ARCADE_COORDINATOR_URL: "" } });
  expect(dry.code, `${dry.stdout}\n${dry.stderr}`).toBe(0);
  expect(dry.stdout).toContain("  coordinator   https://cloud.arcade.dev/api");
  expect(dry.stdout).toContain(`  GET https://cloud.arcade.dev/api${USER_SOURCES}\n`);
  expect(arcade.requests).toEqual([]);

  // The dashboard's proxy, configured: refused, nothing sent anywhere, and the #48 flow. A proxy that
  // answers nothing is set as well, so a request that got out anyway would fail rather than reach it.
  arcade.coordinatorMode = "available";
  const dir = project("coordinator-experience");
  const run = await setupArcade(dir, {
    ...ENTER,
    shell: { ARCADE_COORDINATOR_URL: "https://experience.arcade.dev/api", HTTPS_PROXY: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" },
  });
  expect(run.stdout).toContain("  coordinator   none: ARCADE_COORDINATOR_URL=https://experience.arcade.dev/api is the dashboard's own proxy, which this command never calls");
  expect(fallbackLines(run.stdout)).toEqual([
    "  coordinator: ARCADE_COORDINATOR_URL=https://experience.arcade.dev/api is the dashboard's own proxy, which this command never calls. The rest is the dashboard flow (#48):",
  ]);
  expect(arcade.coordinatorRequests).toEqual([]);
  expect(arcade.tunnelRequests).toBe(0);
  isTheFallback(dir, run, null);

  // And nothing that ships names that host, but to refuse it.
  const shipped = ["scripts/setup-arcade.ts", ...[...new Bun.Glob("scripts/setup-arcade/*.ts").scanSync({ cwd: ROOT })]].flatMap((file) =>
    readFileSync(join(ROOT, file), "utf8")
      .split("\n")
      .filter((line) => line.includes("experience.arcade.dev") && !/^\s*(\*|\/\/)/.test(line))
      .map((line) => `${file}: ${line.trim()}`),
  );
  expect(shipped).toEqual(['scripts/setup-arcade/coordinator.ts: const FORBIDDEN_HOST = "experience.arcade.dev";']);
}, 90_000);

test("with no User Source yet and stdin not a terminal, the run does not pause: it says so and falls back", async () => {
  arcade.coordinatorMode = "available";
  const dir = project("one-click-no-tty");
  const run = await setupArcade(dir);
  expect(run.stdout).toContain(`user source: there is none for ${ORIGIN} in this project yet.`);
  expect(fallbackLines(run.stdout)).toEqual([
    "  user source: not created, because stdin is not a terminal, so this run cannot pause for you to restart `bun run dev`. The rest is the dashboard flow (#48):",
  ]);
  expect(run.stdout).not.toContain("press Enter");
  expect(arcade.tunnelRequests).toBe(0);
  expect(coordinatorSequence()).toEqual([`GET ${USER_SOURCES}`]);
  isTheFallback(dir, run, null);
  // The form shows the secret minted by this run: nothing was rotated for a create that never came.
  expect(run.stdout).toMatch(/Client Secret {3}\S{16,}$/m);
}, 60_000);

test("answering n at the pause falls back, sends nothing more, and a later run with Enter rotates only the User Source client and finishes", async () => {
  arcade.coordinatorMode = "available";
  const dir = project("one-click-no");
  const no = await setupArcade(dir, { tty: true, input: "n\n" });
  expect(no.stdout).toContain("press Enter.\n  n, or Ctrl-C, ends on the dashboard forms instead:");
  expect(fallbackLines(no.stdout)).toEqual(["  user source: not created, at your answer, so none of it is sent. The rest is the dashboard flow (#48):"]);
  expect(arcade.tunnelRequests).toBe(0);
  expect(coordinatorSequence()).toEqual([`GET ${USER_SOURCES}`]);
  isTheFallback(dir, no, null);

  // Later, with the app restarted: the client minted and shown on the first run is rotated for the create, and nothing else is.
  const before = JSON.parse(clientRows(dir)) as Array<Record<string, unknown>>;
  arcade.requests = [];
  arcade.coordinatorRequests = [];
  const yes = await setupArcade(dir, ENTER);
  expect(yes.code, `${yes.stdout}\n${yes.stderr}`).toBe(0);
  // Nothing written to .env this time, so the pause asks for the app to be running, not restarted.
  expect(yes.stdout).toContain("Check that `bun run dev` is running, with the tunnel up");
  const after = JSON.parse(clientRows(dir)) as Array<Record<string, unknown>>;
  const changed = after.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before[i])).map((row) => row.id);
  expect(changed).toEqual(["arcade-user-source"]);
  expect(after.find((row) => row.id === "arcade-user-source")!.clientId).toBe(before.find((row) => row.id === "arcade-user-source")!.clientId);
  expect(coordinatorSequence()).toEqual(ONE_CLICK_COORDINATOR);
  expect(arcade.userSources.size).toBe(1);
  hooksAreRegistered(dir, "active");
  expect(arcade.gateways.size).toBe(1);
}, 90_000);

test("Ctrl-C at the pause falls back to the #48 forms, with the hooks disabled", async () => {
  arcade.coordinatorMode = "available";
  const dir = project("one-click-ctrl-c");
  const child = spawnChild(["bun", "--no-env-file", SCRIPT, HOST], {
    cwd: dir,
    env: childEnv({
      ARCADE_COORDINATOR_URL: arcade.coordinatorUrl,
      CG_SETUP_ARCADE_ISSUER_URL: arcade.tunnelUrl,
      CG_SETUP_ARCADE_TTY: "1",
      ARCADE_API_URL: arcade.url,
      HOME: projects.get(dir)!.home,
      PATH: `${FAKE_BIN}:${process.env.PATH ?? ""}`,
      FAKE_ARCADE_LOG: join(scratch, "one-click-ctrl-c.arcade.log"),
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr as ReadableStream).text();
  let stdout = "";
  const decoder = new TextDecoder();
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  let interrupted = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
    if (!interrupted && stdout.includes("ends on the dashboard forms instead: ")) {
      interrupted = true;
      // The supervisor turns any signal into SIGTERM, so Ctrl-C goes to the script itself, as a terminal sends it.
      const found = Bun.spawnSync(["pgrep", "-P", String(child.pid)]).stdout.toString().trim().split("\n").filter(Boolean);
      expect(found).toHaveLength(1);
      process.kill(Number(found[0]), "SIGINT");
    }
  }
  const code = await child.exited;
  const run = { code, stdout, stderr: await stderr };
  expect(interrupted, run.stdout).toBe(true);
  expect(fallbackLines(run.stdout)).toEqual(["  user source: not created, at your answer, so none of it is sent. The rest is the dashboard flow (#48):"]);
  expect(arcade.tunnelRequests).toBe(0);
  isTheFallback(dir, run, null);
}, 60_000);

test("Enter with the app not reachable through the tunnel says what failed and asks again, and never creates the User Source", async () => {
  arcade.coordinatorMode = "available";
  const cases: Array<{ name: string; tunnel: { status: number; issuer?: string }; says: string }> = [
    { name: "tunnel-down", tunnel: { status: 502 }, says: `GET ${"{tunnel}"}/.well-known/openid-configuration answered 502` },
    {
      name: "app-not-restarted",
      tunnel: { status: 200, issuer: "http://localhost:4400" },
      says: `GET {tunnel}/.well-known/openid-configuration names the issuer "http://localhost:4400", not ${ORIGIN}: restart \`bun run dev\` so it reads APP_PUBLIC_HOST from .env`,
    },
    { name: "sign-in-down", tunnel: { status: 503 }, says: "answered 503: the app's sign-in did not start (restart `bun run dev` so it reads the new .env)" },
  ];
  for (const { name, tunnel, says } of cases) {
    arcade.stop();
    arcade = new StandIn();
    arcade.coordinatorMode = "available";
    arcade.tunnel = tunnel;
    const dir = project(`one-click-${name}`);
    // Enter twice, each checked and each failing, then stdin ends: the third question reads the end, and the run falls back.
    const run = await setupArcade(dir, { tty: true, input: "\n\n" });
    const printed = run.stdout.replaceAll(arcade.tunnelUrl, "{tunnel}");
    expect(printed.split(says).length - 1, `${name}:\n${run.stdout}`).toBe(2);
    expect(run.stdout.match(/then press Enter\./g), name).toHaveLength(2);
    expect(arcade.tunnelRequests, name).toBe(2);
    expect(fallbackLines(run.stdout), name).toEqual(["  user source: not created, at your answer, so none of it is sent. The rest is the dashboard flow (#48):"]);
    expect(coordinatorSequence(), name).toEqual([`GET ${USER_SOURCES}`]);
    isTheFallback(dir, run, null);
  }
}, 120_000);

test("a User Source that claims this app and differs is reported, field by field, and never reused, edited or duplicated", async () => {
  // A project whose clients exist, so a User Source can name the app's own client.
  const setUp = async (name: string) => {
    arcade.stop();
    arcade = new StandIn();
    arcade.coordinatorMode = "available";
    const dir = project(name);
    expect((await setupArcade(dir, { tty: true, input: "n\n" })).code).toBe(0);
    return { dir, clientId: clientsIn(dir)["arcade-user-source"]!.clientId };
  };
  const seed = (fields: Json) => {
    const source = { id: `us_seeded${arcade.userSources.size + 1}`, name: "Loan Approval Limits", issuer_url: ORIGIN, redirect_uri: "https://cloud.arcade.dev/oauth2/intermediate_callback", subject_claim: "email", ...fields };
    arcade.userSources.set(source.id, source);
    return source;
  };
  const cases: Array<{ name: string; seed: (clientId: string) => Json[]; lines: string[] }> = [
    { name: "another client", seed: () => [seed({ client_id: "somebody-elses-client" })], lines: ['  - client id: Arcade has "somebody-elses-client", this app needs "{client}"'] },
    {
      name: "another issuer",
      seed: (clientId) => [seed({ client_id: clientId, issuer_url: "https://old-host.ngrok.app" })],
      lines: [`  - issuer: Arcade has "https://old-host.ngrok.app", this app needs "${ORIGIN}"`],
    },
    {
      name: "another callback",
      seed: (clientId) => [seed({ client_id: clientId, redirect_uri: "https://example.com/callback" })],
      lines: ['  - callback: Arcade has "https://example.com/callback", this app needs "https://cloud.arcade.dev/oauth2/intermediate_callback"'],
    },
    { name: "the sub claim", seed: (clientId) => [seed({ client_id: clientId, subject_claim: "sub" })], lines: ['  - subject claim: Arcade has "sub", this app needs "email"'] },
    { name: "two of them", seed: (clientId) => [seed({ client_id: clientId }), seed({ client_id: clientId })], lines: ["2 User Sources in this project claim this app's issuer or client", "  - one of several for this app"] },
  ];
  for (const each of cases) {
    const { dir, clientId } = await setUp(`user-source-${each.name.replace(/\W+/g, "-")}`);
    const seeded = JSON.stringify(each.seed(clientId));
    arcade.requests = [];
    arcade.coordinatorRequests = [];
    const run = await setupArcade(dir, ENTER);
    if (each.name === "another client") console.log(`--- setup-arcade ${HOST}, a User Source that differs ---\n${run.stdout}${run.stderr}`);
    expect(run.code, `${each.name}: ${run.stdout}\n${run.stderr}`).toBe(1);
    for (const line of each.lines) expect(run.stderr, each.name).toContain(line.replace("{client}", clientId));
    expect(run.stderr).toContain("this command will not pick one or reuse one that differs");
    expect(run.stderr).toContain("No gateway was created, and the hooks are left disabled. In the dashboard (your project → User Sources), correct it or delete it, then run this again.");
    // A read, and nothing after it: no create, no edit, no pause, no gateway, no forms.
    expect(coordinatorSequence(), each.name).toEqual([`GET ${USER_SOURCES}`]);
    expect(JSON.stringify([...arcade.userSources.values()])).toBe(seeded);
    expect(arcade.tunnelRequests).toBe(0);
    expect(arcade.requests.filter((each) => each.path.includes("/gateways") && each.method !== "GET")).toEqual([]);
    expect(arcade.gateways.size).toBe(0);
    hooksAreRegistered(dir, "inactive");
    expect(formOrder(run.stdout)).toEqual([]);
  }
}, 180_000);

test("the User Source created and the gateway not: it says so and what is left, the hooks stay disabled, and a rerun finishes", async () => {
  arcade.coordinatorMode = "available";
  const dir = project("one-click-gateway-fails");
  arcade.nextGatewayCreate = { status: 500, body: { name: "internal", message: "the gateway service is having a moment" } };
  const run = await setupArcade(dir, ENTER);
  console.log(`--- setup-arcade ${HOST}, the gateway refused after the User Source ---\n${run.stdout}${run.stderr}`);
  expect(run.code).toBe(1);
  const [source] = [...arcade.userSources.values()] as [Json];
  expect(run.stderr).toContain(`setup-arcade: the gateway loan-approval-limits was not created: POST ${SCOPED}/gateways answered 500`);
  expect(run.stderr).toContain("Arcade says: the gateway service is having a moment");
  expect(run.stdout).toContain(`The User Source ${source.id} is registered (created by this run), and the gateway is not, so the hooks\nare left disabled.`);
  expect(run.stdout).toContain("What is left: run this same command again, which finds the User Source and creates the\ngateway through it");
  // Only the gateway form: the User Source is not to be made again.
  expect(formOrder(run.stdout)).toEqual(["gateway"]);
  expect(run.stdout).toContain(`→ Loan Approval Limits (${source.id}, already registered). Never Arcade Headers.`);
  expect(thenList(run.stdout)).not.toContain("User Source form");
  expect(arcade.requests.filter((each) => each.method === "PATCH")).toEqual([]);
  hooksAreRegistered(dir, "inactive");

  // The rerun: the User Source is found, the gateway made through it, the hooks turned on.
  arcade.coordinatorRequests = [];
  const again = await setupArcade(dir, { tty: true, input: "" });
  expect(again.code, `${again.stdout}\n${again.stderr}`).toBe(0);
  expect(coordinatorSequence()).toEqual([`GET ${USER_SOURCES}`]);
  expect(arcade.userSources.size).toBe(1);
  expect(again.stdout).toContain(`gateway: created loan-approval-limits, through the User Source ${source.id}`);
  hooksAreRegistered(dir, "active");
}, 90_000);

test("the other ways the gateway is not made after the User Source are each reported the same way", async () => {
  const cases: Array<{ name: string; arrange: () => void; says: string }> = [
    {
      name: "slug taken",
      arrange: () => (arcade.nextGatewayCreate = { status: 409, body: { name: "conflict", message: "slug taken" } }),
      says: "was not created: Arcade says the slug loan-approval-limits is taken. Blank ARCADE_GATEWAY_ID in .env and run this with --gateway <another-slug>",
    },
    { name: "no id", arrange: () => (arcade.nextGatewayCreate = { status: 201, body: { slug: "loan-approval-limits" } }), says: 'was not created: Arcade answered with no id: {"slug":"loan-approval-limits"}' },
    {
      name: "not listed back",
      arrange: () => (arcade.createdNotListed = true),
      says: "was not created: the User Source us_standin",
    },
  ];
  for (const each of cases) {
    arcade.stop();
    arcade = new StandIn();
    arcade.coordinatorMode = "available";
    each.arrange();
    const dir = project(`one-click-partial-${each.name.replace(/\W+/g, "-")}`);
    const run = await setupArcade(dir, ENTER);
    expect(run.code, `${each.name}: ${run.stdout}\n${run.stderr}`).toBe(1);
    expect(run.stderr, each.name).toContain(each.says);
    expect(run.stdout, each.name).toMatch(/The User Source us_standin\d+ is registered \(created by this run\), and the gateway is not/);
    expect(formOrder(run.stdout), each.name).toEqual(["gateway"]);
    hooksAreRegistered(dir, "inactive");
  }
}, 120_000);

test("the order does not depend on active hooks hiding tools: a fresh run passes under it, and only hooks already on meet it", async () => {
  // Hooks already on and no gateway: the #48 flow to the end, then the gateway deleted in the dashboard.
  const dir = project("hooks-on-first");
  expect((await setupArcade(dir)).code).toBe(0);
  dashboardGateway();
  expect((await setupArcade(dir)).code).toBe(0);
  hooksAreRegistered(dir, "active");
  arcade.gateways.clear();
  arcade.coordinatorMode = "available";

  // Under the worst case, the create after the hooks is refused, and the run says what is left.
  const refused = await setupArcade(dir, ENTER);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain("Arcade says: tool Loan.SearchLoans not found");
  expect(refused.stdout).toContain("and the gateway is not, so the hooks\nare left on.");
  expect(arcade.gateways.size).toBe(0);

  // Where the API does not filter, which is what the issue records of it, the same state finishes.
  arcade.activeHooksHideTools = false;
  const passed = await setupArcade(dir, { tty: true, input: "" });
  expect(passed.code, `${passed.stdout}\n${passed.stderr}`).toBe(0);
  expect(passed.stdout).toContain("gateway: created loan-approval-limits");
  expect(passed.stdout).toContain("hooks: already on (status active); nothing to do");
  // And the fresh run, under the worst case, is the first one-click test's: it creates the gateway before the hooks go on.
}, 120_000);

test("a gateway under the slug that authenticates through another User Source is refused, and the hooks stay disabled", async () => {
  arcade.coordinatorMode = "available";
  const dir = project("one-click-other-user-source");
  dashboardGateway({ user_source_id: "us_somebody_else" });
  const run = await setupArcade(dir, ENTER);
  expect(run.code).toBe(1);
  expect(run.stderr).toMatch(/the gateway loan-approval-limits does not authenticate through this app's User Source:\n {2}- user_source_id: Arcade has "us_somebody_else", this app needs "us_standin\d+"/);
  expect(run.stderr).toContain("The hooks are left disabled.");
  hooksAreRegistered(dir, "inactive");
  expect(arcade.requests.filter((each) => each.method === "PATCH")).toEqual([]);
}, 60_000);
