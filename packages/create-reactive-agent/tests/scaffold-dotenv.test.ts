import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { renderTemplate } from "../src/templates/index.js";
import { scaffold } from "../src/lib/scaffold.js";
import type { ScaffoldOptions, TemplateName } from "../src/types.js";

// W0.2: the scaffolded project must load `.env` (not crash-wall on a keyless
// run). Bun auto-loads `.env` at startup, so the bun arm needs no loader. The
// Node/tsx arm does: `tsx --env-file=.env` is NOT used because a missing `.env`
// makes node exit 9 with "node: .env: not found" (measured), and
// `--env-file-if-exists` needs Node >= 22.9 while the generated engines floor
// is >= 22.5. Instead the generated entry calls `process.loadEnvFile()` in a
// try/catch (Node 20.12+), so a missing `.env` falls through to the named
// key-guard error.

const NODE_TEMPLATES: TemplateName[] = [
  "minimal",
  "with-tools",
  "streaming",
  "with-structured-output",
  "with-approval-gates",
  "with-memory",
];

const GUARD_MARKER = "Missing ANTHROPIC_API_KEY";
// The named fix must tell the user what to DO, pointing at both files.
const GUARD_FIX = "copy .env.example to .env";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "cra-env-test-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function baseOpts(over: Partial<ScaffoldOptions> = {}): ScaffoldOptions {
  return {
    dir: path.join(tmpRoot, "proj"),
    projectName: "proj",
    template: "minimal",
    provider: "anthropic",
    packageManager: "npm",
    ...over,
  };
}

function entryContent(opts: ScaffoldOptions): string {
  const files = renderTemplate(opts);
  return files.find((f) => f.path === "src/index.ts")!.content;
}

function startScript(opts: ScaffoldOptions): string {
  const files = renderTemplate(opts);
  const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content) as {
    scripts: Record<string, string>;
  };
  return pkg.scripts.start;
}

describe("start scripts (W0.2)", () => {
  test("npm arm runs the entry through tsx (loader lives in the entry, not --env-file)", () => {
    const script = startScript(baseOpts({ packageManager: "npm" }));
    expect(script).toBe("tsx src/index.ts");
  });

  test("bun arm unchanged: bun loads .env automatically", () => {
    expect(startScript(baseOpts({ packageManager: "bun" }))).toBe("bun run src/index.ts");
  });
});

describe("generated entry .env loading (W0.2)", () => {
  test("non-bun entry calls process.loadEnvFile before the key guard", () => {
    const entry = entryContent(baseOpts());
    expect(entry).toContain("process.loadEnvFile");
    expect(entry.indexOf("process.loadEnvFile")).toBeLessThan(entry.indexOf(GUARD_MARKER));
  });

  test("bun entry omits the loader (bun auto-loads .env; bun-types lacks the API)", () => {
    const entry = entryContent(baseOpts({ packageManager: "bun" }));
    expect(entry).not.toContain("process.loadEnvFile");
    expect(entry).toContain(GUARD_MARKER);
  });

  test("ollama entry needs neither loader nor guard", () => {
    const entry = entryContent(baseOpts({ provider: "ollama" }));
    expect(entry).not.toContain("process.loadEnvFile");
    expect(entry).not.toContain("process.exit(1)");
  });
});

describe("keyless guard is one shared seam across templates (W0.2)", () => {
  for (const template of NODE_TEMPLATES) {
    test(`${template} prints the named instructive error for a cloud provider`, () => {
      const entry = entryContent(baseOpts({ template }));
      expect(entry).toContain(GUARD_MARKER);
      expect(entry).toContain(GUARD_FIX);
      expect(entry).toContain("process.exit(1)");
    });
  }
});

describe("README documents .env loading (W0.2)", () => {
  test("npm README points at .env.example and says the run loads it", () => {
    const files = renderTemplate(baseOpts({ packageManager: "npm" }));
    const readme = files.find((f) => f.path === "README.md")!.content;
    expect(readme).toContain(".env.example");
    expect(readme).toMatch(/loads .*\.env.*automatically/i);
  });

  test("bun README names bun's automatic .env load", () => {
    const files = renderTemplate(baseOpts({ packageManager: "bun" }));
    const readme = files.find((f) => f.path === "README.md")!.content;
    expect(readme).toMatch(/bun .*\.env/i);
  });
});

describe("keyless smoke (W0.2)", () => {
  test("running the scaffolded entry without the key prints the guard and exits non-zero", async () => {
    const result = await scaffold(baseOpts({ template: "minimal", packageManager: "npm" }));

    // Make the entry's `reactive-agents` import resolvable in the tmp project
    // by linking the workspace-built facade from the repo root node_modules.
    const facade = path.resolve(
      import.meta.dir,
      "../../../node_modules/reactive-agents",
    );
    expect(existsSync(facade)).toBe(true); // workspace must be installed/built
    await mkdir(path.join(result.dir, "node_modules"), { recursive: true });
    await symlink(facade, path.join(result.dir, "node_modules", "reactive-agents"));

    // Run with a minimal env: no ANTHROPIC_API_KEY anywhere, no .env file
    // present (scaffold writes only .env.example). Under bun the entry's
    // `process.loadEnvFile` is absent at runtime, exactly exercising the
    // guarded-missing-file fall-through the tsx/node arm relies on.
    const proc = Bun.spawnSync({
      cmd: [process.execPath, "src/index.ts"],
      cwd: result.dir,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
    const stderr = proc.stderr.toString();
    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain(GUARD_MARKER);
    expect(stderr).toContain(GUARD_FIX);
    // Not the crash walls this replaces:
    expect(stderr).not.toMatch(/loadEnvFile is not a function/);
    expect(stderr).not.toMatch(/\.env: not found/);
  }, 20000);
});
