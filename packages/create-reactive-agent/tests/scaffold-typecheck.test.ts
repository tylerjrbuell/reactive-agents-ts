import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, symlink, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scaffold } from "../src/lib/scaffold.js";
import { listTemplates } from "../src/templates/index.js";
import type { PackageManager, ScaffoldOptions, TemplateName } from "../src/types.js";

// Invariant: every template's generated project typechecks against the
// current framework API. A template on a removed or renamed wither must fail
// here, not on a new user's machine. Dependencies resolve from the workspace
// (the facade links to packages/reactive-agents), not from npm.

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const ROOT_MODULES = path.join(REPO_ROOT, "node_modules");
const TSC = path.join(ROOT_MODULES, ".bin", "tsc");
const LINKED = ["reactive-agents", "effect", "bun-types", "@types"] as const;

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "cra-tsc-test-"));
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function scaffoldLinked(
  template: TemplateName,
  packageManager: PackageManager,
  suffix = "",
): Promise<string> {
  const name = `${template}-${packageManager}${suffix}`;
  const opts: ScaffoldOptions = {
    dir: path.join(tmpRoot, name),
    projectName: name,
    template,
    provider: "anthropic",
    packageManager,
  };
  const result = await scaffold(opts);
  await mkdir(path.join(result.dir, "node_modules"), { recursive: true });
  for (const dep of LINKED) {
    await symlink(path.join(ROOT_MODULES, dep), path.join(result.dir, "node_modules", dep));
  }
  return result.dir;
}

function typecheck(dir: string): { code: number | null; output: string } {
  const proc = Bun.spawnSync({ cmd: [TSC, "--noEmit", "-p", dir], cwd: dir });
  return { code: proc.exitCode, output: proc.stdout.toString() + proc.stderr.toString() };
}

describe("scaffolded projects typecheck against the workspace framework", () => {
  test("workspace deps are installed", () => {
    expect(existsSync(TSC)).toBe(true);
    for (const dep of LINKED) expect(existsSync(path.join(ROOT_MODULES, dep))).toBe(true);
  });

  for (const t of listTemplates()) {
    test(`${t.name} (bun) typechecks`, async () => {
      const dir = await scaffoldLinked(t.name, "bun");
      const r = typecheck(dir);
      expect(r.output).toBe("");
      expect(r.code).toBe(0);
    }, 60_000);
  }

  test("minimal (npm, Node types) typechecks", async () => {
    const dir = await scaffoldLinked("minimal", "npm");
    const r = typecheck(dir);
    expect(r.output).toBe("");
    expect(r.code).toBe(0);
  }, 60_000);

  // Control: the check must be able to fail, or the passes above prove nothing.
  test("a removed wither fails the typecheck", async () => {
    const dir = await scaffoldLinked("minimal", "bun", "-control");
    const entry = path.join(dir, "src", "index.ts");
    const source = await readFile(entry, "utf8");
    await writeFile(entry, source.replace(".withMaxIterations(3)", ".withNoSuchWither(3)"), "utf8");
    const r = typecheck(dir);
    expect(r.code).not.toBe(0);
    expect(r.output).toContain("withNoSuchWither");
  }, 60_000);
});
