import { createHooksApp } from "./app";
import { baseUrl, type HooksConfig } from "./policy";

export function configFromEnv(env: Record<string, string | undefined> = process.env): HooksConfig {
  const required = (name: string) => { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required.`); return value; };
  return {
    dbPath: env.GOVERNANCE_DB_PATH || "./governance-discount.db",
    hookSecret: env.ARCADE_HOOK_SECRET?.trim() || required("ARCADE_HOOK_SIGNING_SECRET"),
    operatorToken: required("WORKSHOP_OPERATOR_TOKEN"), approvalsToken: required("APPROVALS_SERVICE_TOKEN"), webToken: required("WEB_SERVICE_TOKEN"),
    leadHost: required("LEAD_APP_PUBLIC_HOST"), leadToken: required("LEAD_INTERNAL_TOKEN"), idpHost: required("IDP_PUBLIC_HOST"),
    webOrigin: env.WEB_PUBLIC_ORIGIN || baseUrl(required("WEB_PUBLIC_HOST")),
    subjectEmails: { dana: required("PERSONA_DANA_EMAIL"), riley: env.PERSONA_RILEY_EMAIL || "riley@example.test", sam: env.PERSONA_SAM_EMAIL || "sam@example.test", morgan: env.PERSONA_MORGAN_EMAIL || "morgan@example.test" },
    verificationUserId: env.WORKSHOP_VERIFICATION_USER_ID || "verification@example.test",
    elasticTools: JSON.parse(env.ARCADE_ELASTIC_HOOK_TOOLS || "[]"),
    mcpToolNames: { discount: env.ARCADE_DISCOUNT_TOOL_NAME },
    salesToolkit: env.ARCADE_SALES_TOOLKIT || "Sales",
    soloSlackDelivery: env.WORKSHOP_SOLO_SLACK === "true", allowedSlackTeamId: env.WORKSHOP_SLACK_TEAM_ID,
  };
}
if (import.meta.main) {
  const app = createHooksApp(configFromEnv());
  const server = Bun.serve({ port: Number(process.env.PORT || 8081), fetch: app.fetch });
  console.log(`[hooks] listening on :${server.port}`);
}
