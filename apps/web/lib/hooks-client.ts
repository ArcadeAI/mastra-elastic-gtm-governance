export class ServiceError extends Error {
  constructor(message: string, readonly status = 502, readonly details?: unknown) { super(message); }
}

export function serviceOrigin(host: string): string {
  return (host.startsWith("http://") || host.startsWith("https://") ? host : `${/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https"}://${host}`).replace(/\/+$/, "");
}

export class HooksClient {
  constructor(readonly origin: string, private token: string) {}
  async request<T = any>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${serviceOrigin(this.origin)}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({ error: "Invalid control-plane response" }));
    if (!response.ok) throw new ServiceError(typeof result.error === "string" ? result.error : `Control plane returned ${response.status}`, response.status, result);
    return result as T;
  }
}
