import "server-only";
import { LibSQLStore } from "@mastra/libsql";
import { createArcadeClient } from "./arcade";
import { createRuntime, type Stage } from "./agent-runtime";
import { HooksClient, ServiceError } from "./hooks-client";
import { personaKeys, type Persona } from "./session";
import { createWebApp } from "./web-app";
import { createApprovalClient } from "./approval-client";
import { resetSnapshots } from "./snapshot-reset";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceError(`${name} is not configured. Complete the corresponding workshop setup.`, 503);
  return value;
}
const hooks = () => new HooksClient(required("HOOKS_PUBLIC_HOST"), required("WEB_SERVICE_TOKEN"));
const approvals = () => createApprovalClient({ hooksHost: required("HOOKS_PUBLIC_HOST"), serviceToken: required("APPROVALS_SERVICE_TOKEN"), arcadeKey: required("ARCADE_API_KEY"), slackSignature: process.env.WORKSHOP_SLACK_SIGNATURE ?? "" });
let storage: LibSQLStore | undefined;
function snapshots() { return storage ??= new LibSQLStore({ id: "workshop-agent", url: required("MASTRA_DB_URL") }); }
function runtime(stage: Stage) {
  if (stage === "supplied") return createRuntime({});
  const connection = { clientFor: createArcadeClient, danaUserId: required("PERSONA_DANA_EMAIL"), elasticTools: required("ARCADE_ELASTIC_TOOL_NAMES").split(",").map((name) => name.trim()).filter(Boolean) };
  if (stage === "elastic") return createRuntime(connection);
  return createRuntime({ ...connection, hooks: hooks(), storage: snapshots(), approvals: approvals(), names: {
    discount: required("ARCADE_DISCOUNT_TOOL_NAME"), getOffer: required("ARCADE_GET_OFFER_TOOL_NAME"),
  } });
}
export const webApp = createWebApp({ runtime, hooks, approvals,
  operatorToken: () => required("WORKSHOP_OPERATOR_TOKEN"),
  resetSnapshots: (epoch) => resetSnapshots(snapshots(), new HooksClient(required("HOOKS_PUBLIC_HOST"), required("WORKSHOP_OPERATOR_TOKEN")), epoch),
  arcadeKey: () => required("ARCADE_API_KEY"),
  session: () => ({ origin: required("WEB_PUBLIC_ORIGIN"), idp: required("IDP_PUBLIC_HOST"), clientId: required("WEB_OAUTH_CLIENT_ID"), clientSecret: required("WEB_OAUTH_CLIENT_SECRET"), secret: required("WEB_SESSION_SECRET"),
    ...(process.env.WORKSHOP_VERIFICATION_USER_ID?.trim() ? { verificationEmail: process.env.WORKSHOP_VERIFICATION_USER_ID.trim() } : {}),
    emails: Object.fromEntries(personaKeys.map((persona) => [persona, required(`PERSONA_${persona.toUpperCase()}_EMAIL`)])) as Record<Persona, string>, demoMode: process.env.WORKSHOP_DEMO_MODE === "true" }),
});
