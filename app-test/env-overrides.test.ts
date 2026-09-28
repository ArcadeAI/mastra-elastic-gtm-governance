/**
 * A shell variable that beats `.env` is named on start, never valued (#54).
 *
 * The #52 live test: the human's terminal still exported an older clone's
 * `.env`, `bun run dev` ran on its `IDP_CLIENT_ID`, and sign-in failed with
 * `invalid_client` while nothing on screen mentioned the shell. `bun run dev`
 * and `bun run studio` now print one warning naming each identity or secret
 * key the shell sets to a value no `.env` file holds; `bun run setup-arcade`
 * refuses (`setup-arcade.test.ts`), and Studio's warning is measured where
 * Studio boots for real (`studio-dev-server.test.ts`).
 *
 * The first half plants each case against `scripts/env-overrides.ts` directly. The
 * second runs the packaged `dev` script, verbatim, in a throwaway project, the
 * way `dev-port.test.ts` does, because a warning in a function nobody calls is
 * the silent failure this repo keeps shipping.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isOverrideWarned, overrideWarning, shellOverrides, type EnvFiles } from "../scripts/env-overrides.ts";
import { childEnv } from "./child-env.ts";
import { spawnChild } from "./child.ts";

const ROOT = join(import.meta.dir, "..");

/** #54's list, and a spread of `IDP_*`: the ones `.env.example` ships and two it leaves commented out. */
const WARNED = [
  "SESSION_SECRET",
  "BETTER_AUTH_SECRET",
  "APP_PUBLIC_HOST",
  "ARCADE_API_KEY",
  "ARCADE_HOOK_SIGNING_SECRET",
  "APPROVALS_STORE_TOKEN",
  "IDP_CLIENT_ID",
  "IDP_CLIENT_SECRET",
  "IDP_OAUTH_CLIENTS",
  "IDP_OAUTH_REDIRECT_URIS_WEB",
  "IDP_DB_PATH",
  "IDP_SCOPES",
] as const;

/** A value nobody would type, so finding it in the output means it was printed. */
const planted = (key: string) => `planted-${key.toLowerCase()}-${crypto.randomUUID()}`;
const none: EnvFiles = { env: {}, local: {} };

describe("each identity or secret key the shell sets", () => {
  test.each(WARNED.map((key): [string] => [key]))("%s: named when no file holds its value, and not when one does", (key) => {
    const value = planted(key);
    expect(isOverrideWarned(key)).toBe(true);
    // Different from .env's.
    expect(shellOverrides({ [key]: value }, { env: { [key]: "from-dotenv" }, local: {} })).toEqual([key]);
    // Set in the shell, blank in .env, as `.env.example` ships the second block.
    expect(shellOverrides({ [key]: value }, { env: { [key]: "" }, local: {} })).toEqual([key]);
    // Set in the shell, absent from every file.
    expect(shellOverrides({ [key]: value }, none)).toEqual([key]);
    // Exported empty over a file's value: the shell's empty string still wins.
    expect(shellOverrides({ [key]: "" }, { env: { [key]: "from-dotenv" }, local: {} })).toEqual([key]);
    // The same value as .env, or as .env.local: the file's value, however it got there.
    expect(shellOverrides({ [key]: value }, { env: { [key]: value }, local: {} })).toEqual([]);
    expect(shellOverrides({ [key]: value }, { env: { [key]: "from-dotenv" }, local: { [key]: value } })).toEqual([]);
    // Exported empty where the files have nothing is no override either.
    expect(shellOverrides({ [key]: "" }, none)).toEqual([]);
  });

  test("keys that are neither identity nor secret are not warned about, however they differ", () => {
    const env = { PORT: "1", STUDIO_PORT: "2", ANTHROPIC_API_KEY: "shell", MODEL_ID: "x", GOVERNANCE_STREAM: "hooks", NODE_ENV: "test" };
    for (const key of Object.keys(env)) expect(isOverrideWarned(key)).toBe(false);
    expect(shellOverrides(env, none)).toEqual([]);
  });

  test("the warning names every key, says the shell's value wins, and says how to stop it", () => {
    const line = overrideWarning(["BETTER_AUTH_SECRET", "IDP_CLIENT_ID"], "bun run dev");
    expect(line).toContain("BETTER_AUTH_SECRET, IDP_CLIENT_ID are set in this shell");
    expect(line).toContain("the shell's value wins: `bun run dev` runs on them, not on .env");
    expect(line).toContain("unset BETTER_AUTH_SECRET IDP_CLIENT_ID");
    expect(overrideWarning(["IDP_CLIENT_ID"], "bun run studio")).toContain("IDP_CLIENT_ID is set in this shell to a value");
  });
});

// --- `bun run dev`, for real ---------------------------------------------------

const fixtures = join(ROOT, ".test-fixtures");
mkdirSync(fixtures, { recursive: true });
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/**
 * A listener on the port the fixture's `.env.local` names. The launcher warns
 * first, then refuses a port somebody holds (#30) and exits, so no Next server
 * starts: a run that got past the warning is one that reached that check.
 */
const holder = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("held") });
afterAll(() => holder.stop(true));

/**
 * A project with the real launchers, the real `dev` script string, and a `.env`
 * and `.env.local` of its own.
 */
async function devProject(dotenv: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(join(fixtures, "env-overrides-"));
  made.push(dir);
  cpSync(join(ROOT, "scripts"), join(dir, "scripts"), { recursive: true });
  const { scripts } = (await Bun.file(join(ROOT, "package.json")).json()) as { scripts: Record<string, string> };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "env-overrides-fixture", private: true, scripts: { dev: scripts.dev } }, null, 2)}\n`);
  writeFileSync(join(dir, ".env"), Object.entries(dotenv).map(([key, value]) => `${key}=${value}\n`).join(""));
  // The held port, and a host in .env.local the way `scripts/orca-setup.sh` writes one.
  writeFileSync(join(dir, ".env.local"), `PORT=${holder.port}\nAPP_PUBLIC_HOST=localhost:4560\n`);
  return dir;
}

/** `bun run dev` in `dir`, with `shell` exported, to its exit. */
async function dev(dir: string, shell: Record<string, string>): Promise<string> {
  // An allowlist: no NODE_ENV, under which Bun skips `.env.local`, and nothing
  // of this checkout's own environment.
  const child = spawnChild(["bun", "run", "--cwd", dir, "dev"], { env: childEnv(shell), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return `${stdout}${stderr}`;
}

test("`bun run dev` names each key a shell sets to a value .env does not hold, once, and prints none of the values", async () => {
  const dotenv = Object.fromEntries(WARNED.map((key) => [key, `dotenv-${key.toLowerCase()}`]));
  // APP_PUBLIC_HOST agrees with .env.local here: the files decide it, not the shell.
  const dir = await devProject({ ...dotenv, APP_PUBLIC_HOST: "" });
  const overridden = WARNED.filter((key) => key !== "APP_PUBLIC_HOST");
  const shell = Object.fromEntries(overridden.map((key) => [key, planted(key)]));

  const output = await dev(dir, { ...shell, APP_PUBLIC_HOST: "localhost:4560" });
  console.log(`--- bun run dev, with an older clone's values exported ---\n${output}`);

  const warnings = output.split("\n").filter((line) => line.includes("set in this shell"));
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain(`[next.ts] warning: ${[...overridden].sort().join(", ")} are set in this shell`);
  expect(warnings[0]).toContain("the shell's value wins: `bun run dev` runs on them");
  expect(warnings[0]).not.toContain("APP_PUBLIC_HOST");
  for (const [key, value] of Object.entries(shell)) expect(output, `bun run dev printed ${key}'s value`).not.toContain(value);
  // It warned and went on, to the port check, which stops the run before Next.
  expect(output).toContain(`Port ${holder.port} is already in use`);
  expect(output.indexOf("set in this shell")).toBeLessThan(output.indexOf(`Port ${holder.port} is already in use`));
}, 60_000);

test("`bun run dev` says nothing when the shell exports what .env holds, or nothing at all", async () => {
  const dotenv = { IDP_CLIENT_ID: "the-same-client", BETTER_AUTH_SECRET: "the-same-secret" };
  const dir = await devProject(dotenv);
  for (const shell of [dotenv, {}]) {
    const output = await dev(dir, shell);
    expect(output).toContain(`Port ${holder.port} is already in use`);
    expect(output).not.toContain("set in this shell");
  }
}, 60_000);
