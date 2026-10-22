// Quality program Task 2 (GH #261-adjacent; plan
// wiki/Planning/Implementation-Plans/2026-10-22-quality-scalability-program.md).
// Red-on-cut mutation test for scripts/check-string-errors.sh — the string-throw
// ratchet that drains the 299-site `new Error(` pool toward the Phase-2 error
// algebra without a big-bang (audit 2026-10-22 item: error modeling signal C).
//
// Laws proven: count above baseline FAILS; count below baseline WITHOUT a
// deliberate edit FAILS (shrink-only ledger, same law as check-file-size /
// check-orphans); SCAN-EMPTY fails vacuous trees; test files are exempt.

import { describe, it, expect, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-string-errors.sh");

const scratchDirs: string[] = [];
afterEach(() => {
  while (scratchDirs.length > 0) {
    rmSync(join(tmpdir(), scratchDirs.pop()!), { recursive: true, force: true });
  }
});

function makeDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `strerr-${name}-`));
  scratchDirs.push(dir.split("/").pop()!);
  return dir;
}

function scriptWithBaseline(baseline: number): string {
  const original = readFileSync(SCRIPT, "utf8");
  const patched = original.replace(/STRING_ERRORS_BASELINE=\d+/, `STRING_ERRORS_BASELINE=${baseline}`);
  if (patched === original) throw new Error("baseline patch did not apply");
  const dir = makeDir("script");
  const path = join(dir, "check-string-errors.sh");
  writeFileSync(path, patched);
  return path;
}

/** Fixture tree with `throws` string-throw sites distributed over N files + M in tests. */
function makeTree(throws: number, testThrows: number): string {
  const root = makeDir("tree");
  const packages = join(root, "packages");
  mkdirSync(join(packages, "a/src"), { recursive: true });
  const body = (n: number) => Array.from({ length: n }, (_, i) => `export const f${i} = () => new Error("x${i}");`).join("\n");
  writeFileSync(join(packages, "a/src/mod.ts"), body(throws) + "\n");
  if (testThrows > 0) writeFileSync(join(packages, "a/src/mod.test.ts"), body(testThrows) + "\n");
  return packages;
}

function runGuard(scanDir: string, script: string = SCRIPT): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [script, scanDir], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("check-string-errors.sh — real tree", () => {
  it("is green on the current repo (the CI invariant)", () => {
    const { code, out } = runGuard(join(REPO_ROOT, "packages"));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });

  it("the script's echoed count and baseline agree with its own ledger (no hard-coded magic)", () => {
    // Parse the ledger from the script instead of pinning a literal here: a
    // deliberate future baseline edit (attributed drift, like the 299->300
    // #262 raise) must NOT require touching this test — only the real-tree
    // green-on-repo test above decides truth. The echo assertion guards the
    // metric itself from silent drift (e.g. a grep-pattern change).
    const script = readFileSync(SCRIPT, "utf8");
    const m = script.match(/STRING_ERRORS_BASELINE=(\d+)/);
    expect(m).not.toBeNull();
    const { code, out } = runGuard(join(REPO_ROOT, "packages"));
    expect(code).toBe(0);
    expect(out).toContain(`at baseline ${m![1]}`);
    expect(out).toContain(`${m![1]} string-throw sites`);
  });
});

describe("check-string-errors.sh — red-on-cut fixtures", () => {
  it("FAILS when the count GROWS above baseline", () => {
    const tree = makeTree(5, 0);
    const { code, out } = runGuard(tree, scriptWithBaseline(4));
    expect(code).toBe(1);
    expect(out.toLowerCase()).toContain("string-throw");
    expect(out).toContain("5");
  });

  it("FAILS when the count SHRINKS without a baseline edit (shrink-only law)", () => {
    const tree = makeTree(3, 0);
    const { code, out } = runGuard(tree, scriptWithBaseline(4));
    expect(code).toBe(1);
    expect(out.toLowerCase()).toContain("update the baseline");
  });

  it("PASSES after a deliberate baseline edit matching the shrink", () => {
    const tree = makeTree(3, 0);
    const { code, out } = runGuard(tree, scriptWithBaseline(3));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });

  it("ignores *.test.ts sites", () => {
    const tree = makeTree(3, 10);
    const { code, out } = runGuard(tree, scriptWithBaseline(3));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });

  it("FAILS on an empty scan root (SCAN-EMPTY: no vacuous green)", () => {
    const root = makeDir("empty");
    const { code, out } = runGuard(join(root, "packages"));
    expect(code).toBe(1);
    expect(out.toLowerCase()).toContain("scan-empty");
  });
});
