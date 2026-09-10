import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ServiceError, serviceOrigin } from "./hooks-client";

export const personaKeys = ["dana", "sam", "riley", "morgan"] as const;
export type Persona = typeof personaKeys[number];
const sessionPersonas = z.enum([...personaKeys, "verification"]);
export type SessionPersona = z.infer<typeof sessionPersonas>;
export interface SessionConfig {
  origin: string; idp: string; clientId: string; clientSecret: string; secret: string;
  emails: Record<Persona, string>; demoMode: boolean; verificationEmail?: string;
}
const sessionSchema = z.object({ email: z.string().email(), persona: sessionPersonas, token: z.string(), csrf: z.string(), expires: z.number() });
const transactionSchema = z.object({ state: z.string(), verifier: z.string(), email: z.string().email(), persona: sessionPersonas, returnTo: z.string(), expires: z.number() });
export type Session = z.infer<typeof sessionSchema>;

function cookies(request: Request) {
  return Object.fromEntries((request.headers.get("cookie") ?? "").split(";").map((part) => { const index = part.indexOf("="); return [part.slice(0, index).trim(), part.slice(index + 1)]; }));
}
function seal(value: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
function unseal(value: string | undefined, secret: string): unknown {
  if (!value) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  } catch { return null; }
}
function equal(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

export function createSessions(config: SessionConfig) {
  if (config.secret.length < 32) throw new ServiceError("WEB_SESSION_SECRET must contain at least 32 characters.", 503);
  const origin = serviceOrigin(config.origin);
  const idp = serviceOrigin(config.idp);
  const callback = `${origin}/auth/callback`;
  function selectedEmail(persona: SessionPersona) {
    if (persona !== "verification") return config.emails[persona];
    const email = config.verificationEmail;
    // Setup identity is separate from the four attendee roles and can only be
    // used while its explicit demo configuration remains enabled.
    return config.demoMode && email && z.string().email().safeParse(email).success && !Object.values(config.emails).includes(email) ? email : undefined;
  }
  const cookie = (name: string, value: string, seconds = 3600) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin.startsWith("https:") ? "; Secure" : ""}`;
  async function userinfo(token: string) {
    const response = await fetch(`${idp}/oauth2/userinfo`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (response.status === 429) throw new ServiceError("Identity checks are temporarily rate limited. Wait a minute, then retry.", 429);
    if (!response.ok) throw new ServiceError("Your sign-in expired. Sign in again.", 401);
    return z.object({ email: z.string().email() }).parse(await response.json());
  }
  return {
    async current(request: Request): Promise<Session | null> {
      const parsed = sessionSchema.safeParse(unseal(cookies(request).workshop_session, config.secret));
      if (!parsed.success || parsed.data.expires <= Date.now()) return null;
      const expected = selectedEmail(parsed.data.persona);
      if (!expected || expected !== parsed.data.email) throw new ServiceError("The session identity no longer matches the selected role.", 401);
      const identity = await userinfo(parsed.data.token);
      if (identity.email !== parsed.data.email || expected !== identity.email) throw new ServiceError("The session identity no longer matches the selected role.", 401);
      return parsed.data;
    },
    csrf(request: Request, session: Session) {
      if (request.headers.get("origin") !== origin || !equal(request.headers.get("x-csrf-token") ?? "", session.csrf)) throw new ServiceError("The request needs this session's CSRF token.", 403);
    },
    login(request: Request) {
      if (!config.demoMode) throw new ServiceError("Workshop demo sign-in is disabled. Enable WORKSHOP_DEMO_MODE for the supplied demo identities.", 503);
      const url = new URL(request.url);
      const persona = sessionPersonas.parse(url.searchParams.get("persona"));
      const email = selectedEmail(persona);
      if (!email) throw new ServiceError("The selected identity is not configured.", 503);
      const requested = url.searchParams.get("returnTo") ?? "/";
      const returnTo = requested.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\") ? requested : "/";
      const state = randomBytes(24).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const transaction = { state, verifier, email, persona, returnTo, expires: Date.now() + 600_000 };
      const authorize = new URL(`${idp}/oauth2/authorize`);
      authorize.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: callback, scope: "openid profile email", state, prompt: "login", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
      return new Response(null, { status: 303, headers: { location: authorize.toString(), "set-cookie": cookie("workshop_oauth", seal(transaction, config.secret), 600) } });
    },
    async callback(request: Request) {
      const url = new URL(request.url);
      const parsed = transactionSchema.safeParse(unseal(cookies(request).workshop_oauth, config.secret));
      if (!parsed.success || parsed.data.expires <= Date.now() || !equal(parsed.data.state, url.searchParams.get("state") ?? "")) throw new ServiceError("Sign-in state is invalid or expired. Start sign-in again.", 400);
      if (selectedEmail(parsed.data.persona) !== parsed.data.email) throw new ServiceError("The selected identity is no longer configured. Start sign-in again.", 503);
      if (url.searchParams.get("iss") !== idp) throw new ServiceError("Unexpected sign-in issuer.", 400);
      const code = url.searchParams.get("code");
      if (!code) throw new ServiceError("Sign-in was not completed.", 400);
      const response = await fetch(`${idp}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callback, client_id: config.clientId, client_secret: config.clientSecret, code_verifier: parsed.data.verifier }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new ServiceError("The identity provider rejected the sign-in code.", 401);
      const tokens = z.object({ access_token: z.string(), expires_in: z.number().positive().optional() }).parse(await response.json());
      const identity = await userinfo(tokens.access_token);
      if (identity.email !== parsed.data.email) throw new ServiceError(`Sign-in returned a different identity. Sign in as ${parsed.data.persona}.`, 403);
      const seconds = Math.min(tokens.expires_in ?? 3600, 14_400);
      const session: Session = { email: identity.email, persona: parsed.data.persona, token: tokens.access_token, csrf: randomBytes(24).toString("base64url"), expires: Date.now() + seconds * 1000 };
      const headers = new Headers({ location: `${origin}${parsed.data.returnTo}` });
      headers.append("set-cookie", cookie("workshop_oauth", "", 0));
      headers.append("set-cookie", cookie("workshop_session", seal(session, config.secret), seconds));
      return new Response(null, { status: 303, headers });
    },
    logout() { return new Response(null, { status: 204, headers: { "set-cookie": cookie("workshop_session", "", 0) } }); },
  };
}
