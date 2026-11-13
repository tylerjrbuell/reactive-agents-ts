// Red-on-cut mutation test for scripts/check-cortex-compliance.sh (the Cortex ratchet gate).
//
// Laws proven: a count above its baseline FAILS; a count below it FAILS until the baseline is
// edited down (shrink-only ledger); comments, test files and the two exempt modules
// (cortex-log.ts for console.*, env-config.ts for process.env) do not count; a giant file that is
// not in SIZE_LEDGER FAILS; an empty scan FAILS (no vacuous green).

import { describe, it, expect, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-cortex-compliance.sh");

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

const makeDir = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `cortexgate-${name}-`));
  scratch.push(dir);
  return dir;
};

type Baselines = Partial<Record<
  | "SERVER_ANY" | "UI_ANY" | "SERVER_AS_UNKNOWN_AS" | "UI_AS_UNKNOWN_AS" | "NEW_ERROR"
  | "INSTANCEOF" | "CONSOLE" | "PROCESS_ENV" | "BUN_SQLITE",
  number
>>;

/** The script with every baseline set to `baselines` (default 0) and SIZE_LEDGER replaced by `ledger`. */
function patchedScript(baselines: Baselines = {}, ledger: readonly string[] = []): string {
  let text = readFileSync(SCRIPT, "utf8");
  for (const key of [
    "SERVER_ANY", "UI_ANY", "SERVER_AS_UNKNOWN_AS", "UI_AS_UNKNOWN_AS", "NEW_ERROR",
    "INSTANCEOF", "CONSOLE", "PROCESS_ENV", "BUN_SQLITE",
  ] as const) {
    const re = new RegExp(`^${key}_BASELINE=\\d+$`, "m");
    if (!re.test(text)) throw new Error(`baseline ${key} not found in the script`);
    text = text.replace(re, `${key}_BASELINE=${baselines[key] ?? 0}`);
  }
  const block = /SIZE_LEDGER=\([^)]*\)/;
  if (!block.test(text)) throw new Error("SIZE_LEDGER block not found in the script");
  text = text.replace(block, `SIZE_LEDGER=(${ledger.map((e) => `\n  "${e}"`).join("")}\n)`);
  const path = join(makeDir("script"), "check-cortex-compliance.sh");
  writeFileSync(path, text);
  return path;
}

/** A fixture apps/cortex tree: `files` maps a path under it to its content. */
function makeTree(files: Record<string, string>): string {
  const root = makeDir("tree");
  const all: Record<string, string> = { "server/clean.ts": "export const ok = 1;\n", ...files };
  for (const [rel, content] of Object.entries(all)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

function run(tree: string, script: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync("bash", [script, tree], { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const lines = (n: number): string => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";

describe("check-cortex-compliance.sh: real tree", () => {
  it("is green on the current repo (the CI invariant)", () => {
    const { code, out } = run(join(REPO_ROOT, "apps", "cortex"), SCRIPT);
    if (code !== 0) throw new Error(out);
    expect(out).toContain("all at baseline");
  });
});

describe("check-cortex-compliance.sh: fixtures", () => {
  it("passes a clean tree at zero baselines", () => {
    const { code, out } = run(makeTree({}), patchedScript());
    if (code !== 0) throw new Error(out);
  });

  it("FAILS when a new `as any` appears in server code", () => {
    const tree = makeTree({ "server/services/x.ts": "export const f = (b: unknown) => (b as any).x;\n" });
    const { code, out } = run(tree, patchedScript());
    expect(code).toBe(1);
    expect(out).toContain("server any/@ts-ignore GREW to 1");
  });

  it("FAILS when an `: any` annotation appears in ui code", () => {
    const tree = makeTree({ "ui/src/lib/a.ts": "export function f(x: any) { return x; }\n" });
    const { code, out } = run(tree, patchedScript());
    expect(code).toBe(1);
    expect(out).toContain("ui any/@ts-ignore GREW to 1");
  });

  it("FAILS when a new string `new Error(` appears (tagged errors only)", () => {
    const tree = makeTree({ "server/services/x.ts": 'export const f = () => { throw new Error("boom"); };\n' });
    const { code, out } = run(tree, patchedScript());
    expect(code).toBe(1);
    expect(out).toContain("string 'new Error(' GREW to 1");
    expect(out).toContain("server/errors.ts");
  });

  it("FAILS when the count SHRINKS below its baseline (the ledger must be lowered)", () => {
    const { code, out } = run(makeTree({}), patchedScript({ NEW_ERROR: 2 }));
    expect(code).toBe(1);
    expect(out).toContain("SHRANK to 0");
    expect(out).toContain("Update the baseline to 0");
  });

  it("PASSES after a deliberate baseline edit matching the count", () => {
    const tree = makeTree({ "server/services/x.ts": 'export const f = () => new Error("a");\nexport const g = () => new Error("b");\n' });
    const { code, out } = run(tree, patchedScript({ NEW_ERROR: 2 }));
    if (code !== 0) throw new Error(out);
  });

  it("FAILS on console.* outside cortex-log.ts and allows it inside", () => {
    const bad = makeTree({ "server/services/x.ts": 'console.log("x");\n' });
    const r = run(bad, patchedScript());
    expect(r.code).toBe(1);
    expect(r.out).toContain("console.* outside cortex-log.ts GREW to 1");
    const ok = makeTree({ "server/cortex-log.ts": 'console.log("x");\n' });
    expect(run(ok, patchedScript()).code).toBe(0);
  });

  it("FAILS on process.env outside env-config.ts and allows it inside", () => {
    const bad = makeTree({ "server/services/x.ts": "export const p = process.env.CORTEX_PORT;\n" });
    const r = run(bad, patchedScript());
    expect(r.code).toBe(1);
    expect(r.out).toContain("process.env reads outside env-config.ts GREW to 1");
    const ok = makeTree({ "server/env-config.ts": "export const p = process.env.CORTEX_PORT;\n" });
    expect(run(ok, patchedScript()).code).toBe(0);
  });

  it("FAILS on a new bun:sqlite import", () => {
    const tree = makeTree({ "server/db/x.ts": 'import type { Database } from "bun:sqlite";\n' });
    const { code, out } = run(tree, patchedScript());
    expect(code).toBe(1);
    expect(out).toContain("bun:sqlite imports GREW to 1");
  });

  it("ignores comments, trailing comments and test files", () => {
    const tree = makeTree({
      "server/services/x.ts": "// x as any, new Error(\"a\"), console.log(1), process.env.A\n/** `as any` */\nexport const a = 1; // as any\n",
      "server/tests/x.test.ts": 'export const f = (b: unknown) => (b as any) && new Error("t") && console.log(process.env.A);\n',
      "server/services/y.test.ts": "export const g = (b: unknown) => b as any;\n",
      "ui/src/lib/a.test.ts": "export const h = (b: unknown) => b as any;\n",
    });
    const { code, out } = run(tree, patchedScript());
    if (code !== 0) throw new Error(out);
  });

  it("FAILS a giant file that is not in SIZE_LEDGER", () => {
    const tree = makeTree({ "server/services/big.ts": lines(800) });
    const { code, out } = run(tree, patchedScript());
    expect(code).toBe(1);
    expect(out).toContain("server/services/big.ts is 800 LOC");
  });

  it("FAILS a ledgered file that grew, and one that shrank without a ledger edit", () => {
    const tree = makeTree({ "server/services/big.ts": lines(810) });
    const grew = run(tree, patchedScript({}, ["server/services/big.ts:805"]));
    expect(grew.code).toBe(1);
    expect(grew.out).toContain("GREW to 810 LOC (ceiling 805)");
    const shrank = run(tree, patchedScript({}, ["server/services/big.ts:900"]));
    expect(shrank.code).toBe(1);
    expect(shrank.out).toContain("SHRANK to 810 LOC but the ceiling is still 900");
  });

  it("PASSES a ledgered giant at its ceiling and FAILS a ledger entry whose file is gone", () => {
    const tree = makeTree({ "ui/src/lib/Big.svelte": lines(850) });
    expect(run(tree, patchedScript({}, ["ui/src/lib/Big.svelte:850"])).code).toBe(0);
    const gone = run(tree, patchedScript({}, ["ui/src/lib/Big.svelte:850", "server/services/gone.ts:900"]));
    expect(gone.code).toBe(1);
    expect(gone.out).toContain("lists server/services/gone.ts");
  });

  it("FAILS on an empty scan root (SCAN-EMPTY: no vacuous green)", () => {
    const { code, out } = run(makeDir("empty"), patchedScript());
    expect(code).toBe(1);
    expect(out).toContain("SCAN-EMPTY");
  });
});
