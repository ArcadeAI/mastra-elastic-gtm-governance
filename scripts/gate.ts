/**
 * `bun run gate`: the gate, in one command.
 *
 * The gate is `gate/`: the policies in `gate/policies/governance.json`, the
 * engine in `gate/engine`, the schema in `gate/schema`, and the webhook service
 * in `gate/service` that answers Arcade's /hooks/access, /hooks/pre and
 * /hooks/post. The service is a module of the app and runs inside `next dev`,
 * on the app's own port, so starting the gate is starting the app. Everything
 * it enforces is in this repo; nothing is fetched from a hosted policy store.
 *
 * What this adds over `bun run dev` is the summary first: the policies the
 * service will seed `governance.db` from (when it has none), rule by rule, so
 * the room can read what is about to be enforced before a tool call hits it.
 * Then it hands over to the same dev server `bun run dev` runs.
 */

import { spawn } from "node:child_process";

import { loadSeed } from "../gate/service/policy-store.ts";

const toolkit = process.env.ARCADE_TOOLKIT?.trim() || "DealDesk";
const seed = loadSeed({ toolkit });

const byHook = (hook: string) => seed.policy_rules.filter((rule) => rule.hook === hook);
const line = (rule: { id: string; match: { toolkit: string; tool: string } }) => `    ${rule.id}  (${rule.match.toolkit}.${rule.match.tool})`;

console.log(`gate: ${seed.policy_rules.length + seed.output_rules.length} rules over ${Object.keys(seed.catalogue[toolkit] ?? {}).length} ${toolkit} tools, from gate/policies/governance.json`);
console.log(`  /hooks/access  who sees which tool (${byHook("access").length})`);
for (const rule of byHook("access")) console.log(line(rule));
console.log(`  /hooks/pre     what a call may do, before it runs (${byHook("pre").length})`);
for (const rule of byHook("pre")) console.log(line(rule));
console.log(`  /hooks/post    what comes back, before the model reads it (${seed.output_rules.length})`);
for (const rule of seed.output_rules) console.log(line(rule));
console.log("  governance.db is seeded from this file only when it has no schema; after that the rows are the policy.");
console.log("");

// The same dev server `bun run dev` starts: the gate is a module of it.
const child = spawn("bun", ["scripts/next.ts", "dev", ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
