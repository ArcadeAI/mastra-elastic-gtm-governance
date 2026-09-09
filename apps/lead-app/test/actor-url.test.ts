import { expect, test } from "bun:test";
import { actorFromRequest } from "../src/actor";

test.each(["bare", "url", "trailing-slash"])("resolves the caller against an IdP configured as %s", async form => {
  const requests: string[] = [];
  const server = Bun.serve({ port: 0, fetch(request) {
    requests.push(new URL(request.url).pathname);
    return request.headers.get("authorization") === "Bearer dana-token" ? Response.json({ email: "dana@example.test" }) : new Response(null, { status: 401 });
  } });
  try {
    const host = `127.0.0.1:${server.port}`;
    const configured = form === "bare" ? host : `http://${host}${form === "trailing-slash" ? "/" : ""}`;
    const request = new Request("http://lead.local/leads", { headers: { authorization: "Bearer dana-token" } });
    expect(await actorFromRequest(request, configured)).toBe("dana@example.test");
    expect(requests).toEqual(["/oauth2/userinfo"]);
  } finally { server.stop(true); }
});
