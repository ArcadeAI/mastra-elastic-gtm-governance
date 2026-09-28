/**
 * The app's `.env` files, and the shell variables that beat them (#54).
 *
 * A real environment variable wins over `.env` for every process this repo
 * starts: Bun's own precedence for `bun run dev` (`scripts/next.ts`), Mastra's
 * for `bun run studio` (`mastra dev` never overrides a variable it inherited),
 * and Next's under both. That is right for a host that injects its
 * configuration, and it is a trap on a laptop. On the #52 live test the
 * human's terminal still exported an older clone's `.env`: `bun run dev` ran on
 * that clone's `IDP_CLIENT_ID`, sign-in failed with `invalid_client`, and the
 * same stale `BETTER_AUTH_SECRET` encrypted `idp.db`'s signing key, so the next
 * clean boot refused it. Nothing said the shell was involved.
 *
 * So each of those commands names, on start, every identity or secret key the
 * shell sets to a value no `.env` file holds, and says the shell's value wins.
 * Names only, never a value: the warning goes to a terminal, and the values
 * are secrets. `bun run setup-arcade` goes further and refuses to run
 * (`shellConflicts` in `scripts/setup-arcade/env-file.ts`), because it decides
 * what to register from `.env` alone.
 *
 * Node-safe on purpose: `src/mastra/index.ts` imports it, and Studio runs
 * under Node (`app-test/studio-entry.test.ts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** `KEY=value` lines to a record. Comments, blanks and `export ` are handled; quotes are stripped. */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (!match) continue;
    env[match[1]!] = unquote(match[2]!);
  }
  return env;
}

function unquote(raw: string): string {
  const value = raw.trim();
  const quoted = /^(['"])(.*)\1$/.exec(value);
  if (quoted) return quoted[2]!;
  // An unquoted value ends at a ` #` comment, the way dotenv reads it.
  return value.replace(/\s+#.*$/, "");
}

/** The file at `path`, or `""` when there is none. */
export function readEnvText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** The two files every command here loads from the project root: `.env`, and `.env.local` over it. */
export interface EnvFiles {
  env: Record<string, string>;
  local: Record<string, string>;
}

export function readEnvFiles(dir: string): EnvFiles {
  return { env: parseEnv(readEnvText(join(dir, ".env"))), local: parseEnv(readEnvText(join(dir, ".env.local"))) };
}

/**
 * The keys a shell override is worth a warning for: every `IDP_*`, and the
 * secrets and host the identity and the Arcade registration are keyed on. The
 * first five are #54's list; `ARCADE_HOOK_SIGNING_SECRET` and
 * `APPROVALS_STORE_TOKEN` are the other two secrets `setup-arcade` writes and
 * registers with Arcade, so a stale one fails the same way, out of sight.
 */
export const OVERRIDE_WARNED_KEYS = [
  "SESSION_SECRET",
  "BETTER_AUTH_SECRET",
  "APP_PUBLIC_HOST",
  "ARCADE_API_KEY",
  "ARCADE_HOOK_SIGNING_SECRET",
  "APPROVALS_STORE_TOKEN",
] as const;

export function isOverrideWarned(key: string): boolean {
  return key.startsWith("IDP_") || (OVERRIDE_WARNED_KEYS as readonly string[]).includes(key);
}

/**
 * The warned keys whose value in `env`, the running process's, is neither
 * `.env`'s nor `.env.local`'s, sorted: the ones only the shell can have put
 * there, because the loaders never override a variable that is already set.
 * A key no file holds counts as blank in them, so a shell that exports it
 * empty is no override, and one that exports a value is.
 */
export function shellOverrides(env: Record<string, string | undefined>, files: EnvFiles): string[] {
  return Object.keys(env)
    .filter(isOverrideWarned)
    .filter((key) => {
      const value = env[key]!.trim();
      const held = [files.env[key], files.local[key]].filter((each) => each !== undefined).map((each) => each.trim());
      return !(held.length > 0 ? held : [""]).includes(value);
    })
    .sort();
}

/** The one warning, naming each key and never a value. `command` is what the developer typed. */
export function overrideWarning(keys: readonly string[], command: string): string {
  const one = keys.length === 1;
  return (
    `warning: ${keys.join(", ")} ${one ? "is" : "are"} set in this shell to ${one ? "a value" : "values"} ` +
    `neither .env nor .env.local holds, and the shell's value wins: \`${command}\` runs on ${one ? "it" : "them"}, not on .env. ` +
    `A shell that exported an older clone's .env is the usual cause, and sign-in then fails. ` +
    `Open a new terminal, or run: unset ${keys.join(" ")}`
  );
}

/** Prints {@link overrideWarning} when there is anything to warn about, and returns the keys. */
export function warnShellOverrides(
  command: string,
  { env = process.env, dir = process.cwd(), log = console.warn }: { env?: Record<string, string | undefined>; dir?: string; log?: (line: string) => void } = {},
): string[] {
  const keys = shellOverrides(env, readEnvFiles(dir));
  if (keys.length > 0) log(overrideWarning(keys, command));
  return keys;
}
