/**
 * `bun run workshop`: everything a module needs, in one command, safe to run again.
 *
 * Reads `.env` and does, in order:
 *
 *   1. starts the app and the tunnel (`bun run up`), and waits until the app answers
 *      through the tunnel;
 *   2. `bun run setup-arcade <APP_PUBLIC_HOST>`, answering its one pause itself: the
 *      deploy, the provider, the hooks, the User Source, the gateway, the hooks on.
 *      With `ELASTIC_MODULE=on` that same run uploads the Elastic secrets and adds
 *      the 26 tools to the gateway;
 *   3. the demo cast, from `WORKSHOP_EMAIL` (you, Alice) and `WORKSHOP_APPROVER`
 *      (Charlie, the host's address), password `WORKSHOP_PASSWORD` or "password";
 *      anyone who exists is kept;
 *   4. with `ELASTIC_MODULE=on`, `bun run seed:elastic`;
 *
 * then leaves the app and the tunnel running in this terminal. Ctrl-C stops both.
 *
 * Every step is one the module pages describe and every one is idempotent, so
 * "behind?" is always the same answer: run this again, then `bun run reset`.
 * What it cannot do is sign in for you: the gateway, the loan API and Slack
 * each ask once, in the browser, the first time a tool needs them.
 */

import { spawn } from "node:child_process";

const env = process.env;
const host = (env.APP_PUBLIC_HOST ?? "").trim();
const me = (env.WORKSHOP_EMAIL ?? "").trim();
const approver = (env.WORKSHOP_APPROVER ?? "").trim();
// The cast's one password on this laptop's own sign-in and nowhere else: "password" unless set.
const password = (env.WORKSHOP_PASSWORD ?? "").trim() || "password";
const elastic = ["on", "true", "yes", "1"].includes((env.ELASTIC_MODULE ?? "").trim().toLowerCase());

const missing = [
  ["ANTHROPIC_API_KEY", env.ANTHROPIC_API_KEY],
  ["ARCADE_API_KEY", env.ARCADE_API_KEY],
  ["APP_PUBLIC_HOST", host],
  ["WORKSHOP_EMAIL", me],
  ["WORKSHOP_APPROVER", approver],
].filter(([, value]) => !(value ?? "").trim()).map(([key]) => key);
if (missing.length > 0) {
  console.error(`workshop: fill these in .env first: ${missing.join(", ")}`);
  process.exit(64);
}

const say = (line: string) => console.log(`\n[workshop] ${line}`);

function run(label: string, cmd: string[], input?: string, extra: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { stdio: [input === undefined ? "ignore" : "pipe", "inherit", "inherit"], env: { ...env, ...extra } });
    if (input !== undefined) { child.stdin?.write(input); child.stdin?.end(); }
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (error) => { console.error(`[workshop] ${label}: ${error.message}`); resolve(1); });
  });
}

async function appAnswers(): Promise<boolean> {
  try {
    const response = await fetch(`https://${host}/health`, { headers: { "ngrok-skip-browser-warning": "1" }, signal: AbortSignal.timeout(4000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

// 1. The app and the tunnel, kept for the whole session.
say(`starting the app and the tunnel on https://${host}`);
const up = spawn("bun", ["scripts/up.ts"], { stdio: "inherit", env });
let stopping = false;
const stop = (code: number) => {
  if (stopping) return;
  stopping = true;
  if (up.exitCode === null) up.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
up.on("exit", (code) => { if (!stopping) { console.error(`[workshop] the app or the tunnel stopped (${code}); see above.`); process.exit(code ?? 1); } });

const deadline = Date.now() + 90_000;
while (!(await appAnswers())) {
  if (Date.now() > deadline) { console.error(`[workshop] https://${host}/health did not answer in 90s. Is the tunnel up and APP_PUBLIC_HOST yours?`); stop(1); await new Promise(() => {}); }
  await new Promise((r) => setTimeout(r, 2000));
}
say("the app answers through the tunnel");

// 2. Arcade: every registration, the one deploy, the gateway. The pause is answered with Enter.
say("registering with Arcade (the first run deploys, about three minutes)");
const setup = await run("setup-arcade", ["bun", "--no-env-file", "scripts/setup-arcade.ts", host], "\n", { CG_SETUP_ARCADE_TTY: "1" });
if (setup !== 0) { console.error("[workshop] setup-arcade did not finish; its output is above. Fix that and run this again."); stop(setup); await new Promise(() => {}); }

// 3. The cast. Existing people are kept.
say("the cast: you as Alice, the host's address as Charlie, Bob and Michael");
await run("users", ["bun", "scripts/users.ts", "seed-demo", "--alice", me, "--charlie", approver, "--bob", "bob@example.com", "--michael", "michael@example.com", "--password", password]);

// 4. Module 3, when it is on.
if (elastic) {
  say("Elastic module is on: seeding deal-files as Michael");
  const seeded = await run("seed:elastic", ["bun", "elastic/seed.ts"], undefined, { ELASTIC_SEED_USER: (env.ELASTIC_SEED_USER ?? "").trim() || "michael@example.com" });
  if (seeded !== 0) console.error("[workshop] the Elastic seed did not finish; see above. The rest is ready.");
}

say(`ready. Open https://${host}, sign in as ${me}, password "${password}", and authorize the gateway once.`);
say("Behind later? Run this again, then `bun run reset`. Ctrl-C stops the app and the tunnel.");
