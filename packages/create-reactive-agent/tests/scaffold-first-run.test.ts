import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scaffold } from "../src/lib/scaffold.js";
import { listTemplates } from "../src/templates/index.js";
import type { TemplateName } from "../src/types.js";

/**
 * Hermetic first-run proof for every template: scaffold into a temp dir,
 * typecheck the generated project, run it keyless (no network, no Ollama)
 * on the deterministic `test` provider, and confirm the real-provider entry
 * fails with the named "Missing <KEY>" message instead of a stack trace.
 *
 * No npm install: the temp project's node_modules is a symlink to the
 * workspace's, so `reactive-agents` resolves to the packages in this repo.
 * Skips cleanly when the workspace is not installed.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const WORKSPACE_MODULES = path.join(REPO_ROOT, "node_modules");
const TSC = path.join(WORKSPACE_MODULES, ".bin", "tsc");
const BUN = process.execPath;
const READY = existsSync(path.join(WORKSPACE_MODULES, "reactive-agents")) && existsSync(TSC);

const KEY_VAR = "ANTHROPIC_API_KEY";
const WORKER_RUNNER = `import worker from "./src/index.ts";
const res = await worker.fetch(new Request("http://localhost/?q=hello"), { OPENAI_API_KEY: "unused" });
const body = (await res.json()) as { output?: string };
if (res.status !== 200 || typeof body.output !== "string") {
  console.error("worker bad response", res.status, JSON.stringify(body));
  process.exit(1);
}
console.log(body.output);
`;

/** Env with no provider keys; only what bun needs to start. HOME is the temp dir so memory writes stay inside it. */
function cleanEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: home, ...extra };
}

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "cra-first-run-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!READY)("first run, keyless, every template", () => {
  for (const tpl of listTemplates()) {
    const name: TemplateName = tpl.name;
    const isWorker = name === "cloudflare-worker";

    test(
      `${name}: typechecks and runs one task on the test provider`,
      async () => {
        const dir = path.join(root, name);
        await scaffold({
          dir,
          projectName: name,
          template: name,
          provider: isWorker ? "openai" : "anthropic",
          packageManager: "bun",
        });
        symlinkSync(WORKSPACE_MODULES, path.join(dir, "node_modules"), "dir");

        const tsc = spawnSync(TSC, ["--noEmit", "-p", dir], { encoding: "utf8", cwd: dir });
        expect(tsc.stdout + tsc.stderr).toBe("");
        expect(tsc.status).toBe(0);

        // Swap the real provider for the deterministic test provider. This is
        // the only edit; the typechecked source above is the shipped template.
        const entry = path.join(dir, "src/index.ts");
        const source = readFileSync(entry, "utf8");
        const patched = source.replace(
          /\.withProvider\("[^"]+"(?:,\s*\{[^}]*\})?\)/,
          '.withProvider("test")',
        );
        expect(patched).not.toBe(source);
        writeFileSync(entry, patched);

        const target = isWorker ? "run-worker.ts" : "src/index.ts";
        if (isWorker) writeFileSync(path.join(dir, target), WORKER_RUNNER);

        // The guard only checks that a non-placeholder key is set; the test
        // provider never sends it anywhere.
        const run = spawnSync(BUN, ["run", target], {
          encoding: "utf8",
          cwd: dir,
          env: cleanEnv(root, { [KEY_VAR]: "not-a-real-key" }),
          timeout: 45_000,
        });
        expect(run.stderr).not.toMatch(/\n\s+at /);
        expect(run.status).toBe(0);
        expect(run.stdout.trim().length).toBeGreaterThan(0);
      },
      90_000,
    );

    if (!isWorker) {
      test(`${name}: no key prints the named fix, not a stack trace`, async () => {
        const dir = path.join(root, `${name}-nokey`);
        await scaffold({
          dir,
          projectName: name,
          template: name,
          provider: "anthropic",
          packageManager: "bun",
        });
        symlinkSync(WORKSPACE_MODULES, path.join(dir, "node_modules"), "dir");

        const run = spawnSync(BUN, ["run", "src/index.ts"], {
          encoding: "utf8",
          cwd: dir,
          env: cleanEnv(root),
          timeout: 30_000,
        });
        expect(run.status).toBe(1);
        expect(run.stderr).toContain(`Missing ${KEY_VAR}`);
        expect(run.stderr).not.toMatch(/\n\s+at /);
      }, 45_000);

      // A provider failure (bad key, Ollama down) must surface as one line and
      // exit 1. Before the template's `.catch(fail)`, the rejected top-level
      // await printed the framework source frame + `triggerUncaughtException`.
      // Ollama on a closed port fails offline and needs no key.
      test(`${name}: provider failure prints one line, not a stack trace`, async () => {
        const dir = path.join(root, `${name}-down`);
        await scaffold({
          dir,
          projectName: name,
          template: name,
          provider: "ollama",
          packageManager: "bun",
        });
        symlinkSync(WORKSPACE_MODULES, path.join(dir, "node_modules"), "dir");

        const run = spawnSync(BUN, ["run", "src/index.ts"], {
          encoding: "utf8",
          cwd: dir,
          env: cleanEnv(root, { OLLAMA_HOST: "http://127.0.0.1:9" }),
          timeout: 30_000,
        });
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("Error: Provider connection failed");
        expect(run.stderr).not.toMatch(/\n\s+at /);
        expect(run.stderr).not.toContain("triggerUncaughtException");
        expect(run.stderr).not.toMatch(/\^\n/);
      }, 45_000);
    }
  }
});

describe.skipIf(!READY)("with-approval-gates off a TTY", () => {
  // A model that retries the gated call after every denial used to loop
  // deny -> resume -> pause for minutes off a TTY and then print
  // `Status: undefined`. The template now passes no onApproval without a TTY,
  // so the run stops at the first gated call, the tool never runs, and the
  // printed outcome is real.
  test("stops at the first gated call, writes nothing, prints the paused status", async () => {
    const dir = path.join(root, "approval-no-tty");
    await scaffold({
      dir,
      projectName: "approval-no-tty",
      template: "with-approval-gates",
      provider: "anthropic",
      packageManager: "bun",
    });
    symlinkSync(WORKSPACE_MODULES, path.join(dir, "node_modules"), "dir");

    const entry = path.join(dir, "src/index.ts");
    const source = readFileSync(entry, "utf8");
    const call = `{ toolCall: { name: "file-write", args: { path: "poem.txt", content: "haiku" } } }`;
    const patched = source.replace(
      /\.withProvider\("[^"]+"\)/,
      `.withProvider("test").withTestScenario([${Array(8).fill(call).join(", ")}, { text: "done" }])`,
    );
    expect(patched).not.toBe(source);
    writeFileSync(entry, patched);

    const run = spawnSync(BUN, ["run", "src/index.ts"], {
      encoding: "utf8",
      cwd: dir,
      // stdin "ignore" is not a TTY: the CI / pipe case.
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanEnv(dir, { [KEY_VAR]: "not-a-real-key" }),
      timeout: 45_000,
    });
    expect(run.stderr).not.toMatch(/\n\s+at /);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('[paused] "file-write" needs approval');
    expect(run.stdout).toContain("Outcome: awaiting-approval");
    expect(run.stdout).not.toContain("undefined");
    expect(existsSync(path.join(dir, "poem.txt"))).toBe(false);
  }, 60_000);
});
