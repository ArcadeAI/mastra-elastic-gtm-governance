import "server-only";

import { MCPClient } from "@mastra/mcp";

const ARCADE_HOST = "api.arcade.dev";

/**
 * One short-lived client per workshop request. Arcade Headers is deliberately
 * the local-demo mode; production forks should use a gateway User Source.
 */
export function createArcadeClient(userId: string): MCPClient {
  const apiKey = required("ARCADE_API_KEY");
  const gateway = required("ARCADE_GATEWAY_ID");

  if (!/^[A-Za-z0-9_-]+$/.test(gateway)) {
    throw new Error("ARCADE_GATEWAY_ID must be a gateway slug, not a URL.");
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(userId)) {
    throw new Error("The workshop user must resolve to an email address.");
  }

  const servers = {
    arcade: {
      url: new URL(`https://${ARCADE_HOST}/mcp/${gateway}`),
      allowedHosts: [ARCADE_HOST],
      forwardInstructions: false,
      requestInit: {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Arcade-User-ID": userId,
        },
      },
    },
  };
  return new MCPClient({
    id: crypto.randomUUID(),
    servers,
    timeout: 60_000,
  });
}

export async function discoverArcadeTools(userId: string) {
  const client = createArcadeClient(userId);
  try {
    const result = await client.listToolDefinitionsWithErrors({
      perServerTimeoutMs: 10_000,
    });
    const definitions = result.definitions.arcade ?? {};

    return {
      tools: Object.values(definitions).map((definition) => ({
        name: definition.name,
        description: definition.description,
      })),
      errors: result.errors,
    };
  } finally {
    await client.disconnect();
  }
}

function required(name: "ARCADE_API_KEY" | "ARCADE_GATEWAY_ID"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
