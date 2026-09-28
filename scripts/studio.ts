/**
 * `bun run studio`: `mastra dev`, after one check (#54).
 *
 * `mastra dev` loads `.env`, `.env.local` and `.env.development` itself, and
 * never overrides a variable it inherited, so a shell that still exports an
 * older clone's `.env` runs Studio on that clone's values without a word. This
 * names each identity or secret key it would run on a value other than the
 * `.env` files' (`scripts/env-overrides.ts`), names only, then runs `mastra
 * dev` exactly as the package script did before: with the shell's environment
 * and nothing else.
 *
 * Run with `--no-env-file` (the package script does), for two reasons. This
 * process's environment is then the shell's own, so the comparison needs no
 * inference. And it is what `mastra dev` has always been handed: `bun run`
 * does not load `.env` into a package script's environment, measured on #54,
 * so a Studio started through here loads the files itself, as before, and
 * picks up an edited `.env` when it restarts.
 *
 * The check lives here and not in `src/mastra/index.ts` because it reads
 * `BETTER_AUTH_SECRET`, and no app source outside the identity provider does
 * (`app-test/identity/only-identity-mints.test.ts`).
 */
import { warnShellOverrides } from "./env-overrides.ts";

const root = new URL("..", import.meta.url).pathname;

// Advisory, as in `scripts/next.ts`: a check that cannot run says so and Studio starts.
try {
  warnShellOverrides("bun run studio", { dir: root, log: (line) => console.error(`[studio] ${line}\n`) });
} catch (error) {
  console.error(`[studio] could not compare the shell with .env: ${(error as Error).message}`);
}

const child = Bun.spawn(["bun", "run", "mastra", "dev", ...process.argv.slice(2)], {
  cwd: root,
  env: process.env,
  stdio: ["inherit", "inherit", "inherit"],
});

// Studio is stopped with Ctrl-C, and a launcher that dies without passing the
// signal on leaves `mastra dev` holding STUDIO_PORT, as `scripts/next.ts` says.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

process.exit(await child.exited);
