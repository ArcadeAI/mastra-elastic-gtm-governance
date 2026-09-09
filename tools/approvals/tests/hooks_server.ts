/** Real hooks application and SQLite; its external Lead/IdP URLs stay local. */
import { createHooksApp } from "../../../apps/hooks/src/app";

const dependency = process.env.TEST_DEPENDENCY_URL!;
if (new URL(dependency).hostname !== "127.0.0.1") throw new Error("Local dependencies required");
const app = createHooksApp({
  dbPath: process.env.TEST_HOOKS_DB!,
  hookSecret: "hook-test",
  operatorToken: "operator-test",
  approvalsToken: "approvals-test-service-token",
  webToken: "web-test",
  leadHost: dependency,
  leadToken: "lead-internal",
  idpHost: dependency,
  webOrigin: "http://localhost:3000",
  subjectEmails: {
    dana: "attendee@example.test", riley: "riley@example.test",
    sam: "sam@example.test", morgan: "morgan@example.test",
  },
  verificationUserId: "verify@example.test",
  elasticTools: [{ toolkit: "Elastic", name: "Observed_Search", arguments: ["query"] }],
  soloSlackDelivery: true,
  allowedSlackTeamId: "TWORKSHOP",
});
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
console.log(server.url.origin);
process.on("SIGTERM", () => { server.stop(true); app.close(); process.exit(0); });
