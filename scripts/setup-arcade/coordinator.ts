/**
 * The Coordinator API, as far as `bun run setup-arcade` uses it (#52): the
 * project's User Sources, listed and, when this app has none, created.
 *
 * This is the one place that knows the Coordinator's shapes. **They are
 * unmeasured** until the human's live run: every field name below is in
 * {@link SHAPE}, and every answer is read by {@link parseUserSource} and
 * {@link parseUserSourceList}, so a correction is a change here and nowhere
 * else. An answer that does not have the shape is not guessed at: it is a
 * failed call like a 404 or a refused connection, and the run falls back to the
 * dashboard forms of #48 (`forms.ts`), with the hooks left disabled.
 *
 * - The host is `ARCADE_COORDINATOR_URL`, default `https://cloud.arcade.dev/api`,
 *   and the routes are under the same org and project as the hooks and the
 *   gateway (`context.ts`): `GET` and `POST
 *   /v1/orgs/{org_id}/projects/{project_id}/user_sources`.
 * - **Never experience.arcade.dev.** That is the dashboard's own proxy, on the
 *   browser's session. A configured URL on that host is refused before anything
 *   is sent, and the run falls back.
 * - Auth is `Authorization: Bearer <ARCADE_API_KEY>`, the same project key as
 *   `arcade.ts`.
 * - Create-only, like the provider: a User Source is hop 1, the access model
 *   itself. One that exists and differs is reported, never reused and never
 *   edited (`setup-arcade.ts`).
 */
import type { ProjectScope } from "./arcade.ts";

export const DEFAULT_COORDINATOR_URL = "https://cloud.arcade.dev/api";

/** The dashboard's proxy. Nothing here ever calls it. */
const FORBIDDEN_HOST = "experience.arcade.dev";

/** The callback every User Source signs in through, which the app's `arcade-user-source` client allowlists. */
export const USER_SOURCE_CALLBACK = "https://cloud.arcade.dev/oauth2/intermediate_callback";

/** The name this app's User Source goes by, the same as the dashboard form's (`forms.ts`). */
export const USER_SOURCE_NAME = "Loan Approval Limits";

/**
 * Where each field sits in the Coordinator's JSON. **Unmeasured** (#52): the
 * stand-in in `app-test/setup-arcade.test.ts` is written against this, and the
 * human's measurement replaces it.
 */
export const SHAPE = {
  /** The list answer's array; `null` for a bare array. */
  listItems: "items",
  id: "id",
  name: "name",
  issuer: "issuer_url",
  clientId: "client_id",
  callback: "redirect_uri",
  subjectClaim: "subject_claim",
  scopes: "scopes",
  /** The create request's secret, which no read returns. */
  clientSecret: "client_secret",
  description: "description",
} as const;

/** A User Source as this script reads it. `null` is a field the answer left out. */
export interface UserSource {
  id: string;
  name: string | null;
  issuer: string | null;
  clientId: string | null;
  callback: string | null;
  subjectClaim: string | null;
}

/** What this app needs its User Source to be. */
export interface UserSourceSpec {
  issuer: string;
  clientId: string;
  callback: string;
}

function at(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown, key: string): string | null {
  const found = at(value, key);
  return typeof found === "string" ? found : null;
}

/** One User Source, or `null` when the answer is not one: no string id, or a field of the wrong type. */
export function parseUserSource(json: unknown): UserSource | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const id = text(json, SHAPE.id);
  if (id === null || id === "") return null;
  for (const key of [SHAPE.name, SHAPE.issuer, SHAPE.clientId, SHAPE.callback, SHAPE.subjectClaim]) {
    const value = at(json, key);
    if (value !== undefined && value !== null && typeof value !== "string") return null;
  }
  return {
    id,
    name: text(json, SHAPE.name),
    issuer: text(json, SHAPE.issuer),
    clientId: text(json, SHAPE.clientId),
    callback: text(json, SHAPE.callback),
    subjectClaim: text(json, SHAPE.subjectClaim),
  };
}

/** The list answer, or `null` when it is not a list of User Sources: one bad entry makes the whole list unreadable. */
export function parseUserSourceList(json: unknown): UserSource[] | null {
  const items = SHAPE.listItems === null ? json : at(json, SHAPE.listItems);
  if (!Array.isArray(items)) return null;
  const parsed = items.map(parseUserSource);
  return parsed.every((each): each is UserSource => each !== null) ? parsed : null;
}

/** The create request's body: the dashboard form's fields (`forms.ts` `userSourceForm`). */
export function userSourceBody({ issuer, clientId, clientSecret }: { issuer: string; clientId: string; clientSecret: string }) {
  return {
    [SHAPE.name]: USER_SOURCE_NAME,
    [SHAPE.description]: "The app's own sign-in (hop 1)",
    [SHAPE.issuer]: issuer,
    [SHAPE.clientId]: clientId,
    [SHAPE.clientSecret]: clientSecret,
    [SHAPE.scopes]: "openid profile email",
    [SHAPE.subjectClaim]: "email",
  };
}

/** An issuer as a URL compares: a trailing slash is the same issuer. */
const sameIssuer = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/**
 * The User Sources that are this app's, or claim to be: the issuer is the app's
 * origin, or the client is the app's `arcade-user-source`. Each of them is held
 * to the whole spec, so one that shares only its issuer or only its client is
 * a mismatch to report, never a stranger to ignore.
 */
export function candidates(sources: UserSource[], want: UserSourceSpec): UserSource[] {
  return sources.filter((each) => (each.issuer !== null && sameIssuer(each.issuer, want.issuer)) || each.clientId === want.clientId);
}

/**
 * `field: Arcade has X, this app needs Y`, one line per difference. The issuer
 * and the client id are required: absent, the User Source cannot be shown to
 * be this app's. The callback and the subject claim are compared when the
 * answer carries them, and absent is not a difference, the rule `arcade.ts`
 * holds the hooks' read-back to.
 */
export function userSourceDifferences(found: UserSource, want: UserSourceSpec): string[] {
  const differences: string[] = [];
  const line = (field: string, have: string | null, need: string) =>
    differences.push(`${field}: Arcade has ${have === null ? "nothing" : JSON.stringify(have)}, this app needs ${JSON.stringify(need)}`);
  if (found.issuer === null || !sameIssuer(found.issuer, want.issuer)) line("issuer", found.issuer, want.issuer);
  if (found.clientId !== want.clientId) line("client id", found.clientId, want.clientId);
  if (found.callback !== null && found.callback !== want.callback) line("callback", found.callback, want.callback);
  if (found.subjectClaim !== null && found.subjectClaim !== "email") line("subject claim", found.subjectClaim, "email");
  return differences;
}

/** A Coordinator call that did not give this script what it needs, as the run prints it in one line. */
export interface CoordinatorFailure {
  ok: false;
  /** `METHOD <url>`. */
  call: string;
  /** `404`, `a refused connection`, `200 with a body that is not a list of User Sources`, … */
  status: string;
  /** The HTTP status when there was one, for the tests and the partial-state message. */
  code: number | null;
}

export type CoordinatorResult<T> = { ok: true; value: T } | CoordinatorFailure;

/** One line, naming the call and its status: the first thing a fallback prints (#52). */
export function failureLine(failure: CoordinatorFailure): string {
  return `coordinator: ${failure.call} answered ${failure.status}`;
}

/**
 * `ARCADE_COORDINATOR_URL`, or the default, with no trailing slash; or why it
 * is refused. Refused: not an http(s) URL, or the dashboard's proxy.
 */
export function coordinatorUrl(configured: string | undefined): { url: string } | { url: null; why: string } {
  const raw = (configured?.trim() || DEFAULT_COORDINATOR_URL).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: null, why: `ARCADE_COORDINATOR_URL=${raw} is not a URL` };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return { url: null, why: `ARCADE_COORDINATOR_URL=${raw} is not an http(s) URL` };
  const host = parsed.hostname.toLowerCase();
  if (host === FORBIDDEN_HOST || host.endsWith(`.${FORBIDDEN_HOST}`)) {
    return { url: null, why: `ARCADE_COORDINATOR_URL=${raw} is the dashboard's own proxy, which this command never calls` };
  }
  return { url: raw };
}

/** How long one Coordinator call may take before it counts as failed. */
const TIMEOUT_MS = 20_000;

/**
 * The User Source calls. Like `ArcadeAdmin`: under `--dry-run` it prints each
 * request, the key and the client secret as placeholders, and sends nothing;
 * for real it prints one line per call and never a body.
 */
export class Coordinator {
  constructor(
    readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly dryRun: boolean,
    private readonly log: (line: string) => void,
  ) {}

  path(scope: ProjectScope): string {
    return `/v1/orgs/${encodeURIComponent(scope.orgId)}/projects/${encodeURIComponent(scope.projectId)}/user_sources`;
  }

  async list(scope: ProjectScope): Promise<CoordinatorResult<UserSource[]>> {
    const answer = await this.send("GET", this.path(scope));
    if (!answer.ok) return answer;
    const sources = parseUserSourceList(answer.json);
    return sources === null ? this.unreadable("GET", this.path(scope), answer.code, "a list of User Sources") : { ok: true, value: sources };
  }

  async create(scope: ProjectScope, body: ReturnType<typeof userSourceBody>): Promise<CoordinatorResult<UserSource>> {
    const answer = await this.send("POST", this.path(scope), body);
    if (!answer.ok) return answer;
    const source = parseUserSource(answer.json);
    return source === null ? this.unreadable("POST", this.path(scope), answer.code, "a User Source") : { ok: true, value: source };
  }

  private unreadable(method: string, path: string, code: number, what: string): CoordinatorFailure {
    return { ok: false, call: `${method} ${this.baseUrl}${path}`, status: `${code} with a body that is not ${what}`, code };
  }

  private async send(method: string, path: string, body?: unknown): Promise<{ ok: true; code: number; json: unknown } | CoordinatorFailure> {
    const url = `${this.baseUrl}${path}`;
    const call = `${method} ${url}`;
    if (this.dryRun) {
      this.log(`  ${method} ${url}`);
      this.log(`    Authorization: Bearer <ARCADE_API_KEY>`);
      if (body !== undefined) {
        this.log(`    Content-Type: application/json`);
        for (const line of JSON.stringify(body, null, 2).split("\n")) this.log(`    ${line}`);
      }
      return { ok: true, code: 0, json: null };
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "manual",
      });
    } catch (error) {
      const reason = (error as Error).name === "TimeoutError" ? `nothing within ${TIMEOUT_MS / 1000}s` : `a network error (${(error as Error).message})`;
      this.log(`  coordinator ${method} ${path} → ${reason}`);
      return { ok: false, call, status: reason, code: null };
    }
    const raw = await response.text();
    this.log(`  coordinator ${method} ${path} → ${response.status}`);
    const expected = method === "POST" ? [200, 201] : [200];
    if (!expected.includes(response.status)) return { ok: false, call, status: String(response.status), code: response.status };
    try {
      return { ok: true, code: response.status, json: raw ? (JSON.parse(raw) as unknown) : null };
    } catch {
      return { ok: false, call, status: `${response.status} with a body that is not JSON`, code: response.status };
    }
  }
}
