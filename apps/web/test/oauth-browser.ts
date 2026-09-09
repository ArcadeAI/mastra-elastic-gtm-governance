import { createHash, randomBytes } from "node:crypto";

export class OAuthBrowser {
  private cookies = new Map<string, string>();
  async fetch(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!; const index = pair.indexOf("=");
      if (/max-age=0/i.test(cookie)) this.cookies.delete(pair.slice(0, index)); else this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  async login(web: string, persona: string, email: string, password: string, returnTo = "/?run=pending-dana") {
    const begin = await this.fetch(`${web}/auth/login?${new URLSearchParams({ persona, returnTo })}`);
    if (begin.status !== 303) throw new Error(`Login start failed: ${await begin.text()}`);
    return this.fetch(await this.authorize(begin.headers.get("location")!, email, password));
  }
  async token(idp: string, client: { client_id: string; client_secret: string }, email: string, password: string) {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(20).toString("hex");
    const redirect = "http://localhost:3000/callback";
    const authorize = new URL(`${idp}/oauth2/authorize`);
    authorize.search = new URLSearchParams({ client_id: client.client_id, response_type: "code", redirect_uri: redirect, scope: "openid profile email", state, prompt: "login", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
    const callback = new URL(await this.authorize(authorize.toString(), email, password));
    if (callback.searchParams.get("state") !== state || callback.searchParams.get("iss") !== idp) throw new Error("Invalid real IdP response");
    const response = await fetch(`${idp}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: callback.searchParams.get("code")!, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirect, code_verifier: verifier }) });
    const value = await response.json() as any;
    if (!response.ok || !value.access_token) throw new Error(`Real IdP token failed: ${JSON.stringify(value)}`);
    return value.access_token as string;
  }
  private async authorize(authorize: string, email: string, password: string) {
    let response = await this.fetch(authorize);
    let location = new URL(response.headers.get("location")!, authorize);
    if (location.pathname === "/login") {
      response = await this.fetch(location.toString(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email, password, oauth_query: location.search.slice(1) }) });
      if (response.status !== 303) throw new Error(`IdP login failed: ${await response.text()}`);
      location = new URL(response.headers.get("location")!, location);
    }
    if (location.pathname === "/consent") {
      response = await this.fetch(location.toString(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ decision: "allow", oauth_query: location.search.slice(1) }) });
      location = new URL(response.headers.get("location")!, location);
    }
    return location.toString();
  }
}
