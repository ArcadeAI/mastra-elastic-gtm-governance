import { createHooksApp } from "./app";
import { baseUrl, type HooksConfig } from "./policy";

export function configFromEnv(env: Record<string, string | undefined> = process.env): HooksConfig {
  const required = (name: string) => { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required.`); return value; };
  return {
    dbPath: env.GOVERNANCE_DB_PATH || "./governance.db",
    hookSecret: env.ARCADE_HOOK_SECRET?.trim() || required("ARCADE_HOOK_SIGNING_SECRET"),
    operatorToken: required("WORKSHOP_OPERATOR_TOKEN"), approvalsToken: required("APPROVALS_SERVICE_TOKEN"), webToken: required("WEB_SERVICE_TOKEN"),
    leadHost: required("LEAD_APP_PUBLIC_HOST"), leadToken: required("LEAD_INTERNAL_TOKEN"), idpHost: required("IDP_PUBLIC_HOST"),
    webOrigin: env.WEB_PUBLIC_ORIGIN || baseUrl(required("WEB_PUBLIC_HOST")),
    subjectEmails: { dana: required("PERSONA_DANA_EMAIL"), riley: env.PERSONA_RILEY_EMAIL || "riley@example.test", sam: env.PERSONA_SAM_EMAIL || "sam@example.test", morgan: env.PERSONA_MORGAN_EMAIL || "morgan@example.test" },
    verificationUserId: env.WORKSHOP_VERIFICATION_USER_ID || "verification@example.test",
    elasticTools: JSON.parse(env.ARCADE_ELASTIC_HOOK_TOOLS || "[]"),
    mcpToolNames: { route: env.ARCADE_ROUTE_TOOL_NAME, classify: env.ARCADE_CLASSIFY_TOOL_NAME, requestApproval: env.ARCADE_REQUEST_APPROVAL_TOOL_NAME, decide: env.ARCADE_DECIDE_TOOL_NAME },
    leadToolkit: env.ARCADE_LEAD_TOOLKIT || "Lead", approvalsToolkit: env.ARCADE_APPROVALS_TOOLKIT || "Approvals",
    soloSlackDelivery: env.WORKSHOP_SOLO_SLACK === "true", allowedSlackTeamId: env.WORKSHOP_SLACK_TEAM_ID,
  };
}
if (import.meta.main) {
  const app = createHooksApp(configFromEnv());
  const server = Bun.serve({ port: Number(process.env.PORT || 8081), fetch: app.fetch });
  console.log(`[hooks] listening on :${server.port}`);
}
