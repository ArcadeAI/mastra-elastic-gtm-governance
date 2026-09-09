import type { NextConfig } from "next";

const config: NextConfig = {
  // Render runs this service from a Dockerfile; standalone keeps the runtime
  // image to the server plus only the dependencies it actually traced.
  output: "standalone",
  // Cross-service integration tests run/typecheck from the full checkout; the
  // production image only copies the web service and workspace packages.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // The monorepo root, so tracing picks up files linked from packages/.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // Mastra resolves provider adapters dynamically. Keep it server-side instead
  // of asking webpack to statically enumerate every possible adapter.
  serverExternalPackages: ["@mastra/core", "@mastra/mcp", "@mastra/libsql"],
};

export default config;
