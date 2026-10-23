// Quality program Task 2 + Task 3 (plan
// wiki/Planning/Implementation-Plans/2026-10-22-quality-scalability-program.md).
// Red-on-cut mutation test for scripts/check-string-errors.sh — the twin
// ratchets draining the untyped-error pool toward the Phase-2 error algebra
// without a big-bang (audit 2026-10-22 signal C):
//   • STRING_ERRORS_BASELINE: `new Error(` sites (299 capture, 300 after the
//     attributed #262 raise).
//   • INSTANCEOF_BASELINE: `instanceof Error|*Error` sites (129 occurrences;
//     128 lines — one line carries two matches). These are the public
//     rejection-identity consumers that make mass error-type conversion unsafe;
//     the D3 task converts framework-internal ones and this number follows.
//
// Laws proven per counter: count above baseline FAILS; count below baseline
// WITHOUT a deliberate edit FAILS (shrink-only ledger); SCAN-EMPTY fails
// vacuous trees; test files are exempt for both.

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

function scriptWithBaselines(stringBaseline: number, instanceOfBaseline: number): string {
  const original = readFileSync(SCRIPT, "utf8");
  let patched = original.replace(/STRING_ERRORS_BASELINE=\d+/, `STRING_ERRORS_BASELINE=${stringBaseline}`);
  patched = patched.replace(/INSTANCEOF_BASELINE=\d+/, `INSTANCEOF_BASELINE=${instanceOfBaseline}`);
  if (patched === original || !patched.includes(`INSTANCEOF_BASELINE=${instanceOfBaseline}`)) {
    throw new Error("baseline patch did not apply");
  }
  const dir = makeDir("script");
  const path = join(dir, "check-string-errors.sh");
  writeFileSync(path, patched);
  return path;
}

/** Fixture tree: `throws` + `instanceofs` sites in a src module, plus test-file decoys. */
function makeTree(throws: number, testThrows: number, instanceofs = 0, testInstanceofs = 0): string {
  const root = makeDir("tree");
  const packages = join(root, "packages");
  mkdirSync(join(packages, "a/src"), { recursive: true });
  const body = (n: number) => Array.from({ length: n }, (_, i) => `export const f${i} = () => new Error("x${i}");`).join("\n");
  const ibody = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => `export const ${tag}${i} = (e: unknown) => e instanceof Error;`).join("\n");
  writeFileSync(join(packages, "a/src/mod.ts"), [body(throws), ibody(instanceofs, "ix")].filter(Boolean).join("\n") + "\n");
  if (testThrows > 0 || testInstanceofs > 0) {
    writeFileSync(
      join(packages, "a/src/mod.test.ts"),
      [body(testThrows), ibody(testInstanceofs, "tx")].filter(Boolean).join("\n") + "\n",
    );
  }
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

  it("the script's echoed counts and baselines agree with its own ledger (no hard-coded magic)", () => {
    // Parse BOTH ledgers from the script instead of pinning literals here: a
    // deliberate future baseline edit (attributed drift, like the 299->300
    // #262 raise) must NOT require touching this test — only the real-tree
    // green-on-repo test above decides truth. The echo assertion guards the
    // metrics themselves from silent drift (e.g. a grep-pattern change).
    const script = readFileSync(SCRIPT, "utf8");
    const s = script.match(/STRING_ERRORS_BASELINE=(\d+)/);
    const i = script.match(/INSTANCEOF_BASELINE=(\d+)/);
    expect(s).not.toBeNull();
    expect(i).not.toBeNull();
    const { code, out } = runGuard(join(REPO_ROOT, "packages"));
    expect(code).toBe(0);
    expect(out).toContain(`string-throw sites at baseline ${s![1]}`);
    expect(out).toContain(`instanceof sites at baseline ${i![1]}`);
  });
});

describe("check-string-errors.sh — string-throw red-on-cut fixtures", () => {
  it("FAILS when the string count GROWS above baseline", () => {
    const tree = makeTree(5, 0, 1);
    const { code, out } = runGuard(tree, scriptWithBaselines(4, 1));
    expect(code).toBe(1);
    expect(out.toLowerCase()).toContain("string-throw");
    expect(out).toContain("5");
  });

  it("FAILS when the string count SHRINKS without a baseline edit (shrink-only law)", () => {
    const tree = makeTree(3, 0, 1);
    const { code, out } = runGuard(tree, scriptWithBaselines(4, 1));
    expect(code).toBe(1);
    expect(out.toLowerCase()).toContain("update the baseline");
  });

  it("PASSES after a deliberate baseline edit matching a string shrink", () => {
    const tree = makeTree(3, 0, 1);
    const { code, out } = runGuard(tree, scriptWithBaselines(3, 1));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });

  it("ignores *.test.ts string sites", () => {
    const tree = makeTree(3, 10, 1, 0);
    const { code, out } = runGuard(tree, scriptWithBaselines(3, 1));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });
});

describe("check-string-errors.sh — instanceof red-on-cut fixtures", () => {
  it("FAILS when the instanceof count GROWS above baseline", () => {
    const tree = makeTree(3, 0, 2);
    const { code, out } = runGuard(tree, scriptWithBaselines(3, 1));
    expect(code).toBe(1);
    expect(out.toLowerCase()).toContain("instanceof");
    expect(out).toContain("2");
  });

  it("FAILS when the instanceof count SHRINKS without a baseline edit (shrink-only law)", () => {
    const tree = makeTree(3, 0, 0);
    const { code, out } = runGuard(tree, scriptWithBaselines(3, 1));
    expect(code).toBe(1);
    expect(out.toLowerCase()).toContain("update the baseline");
    expect(out.toLowerCase()).toContain("instanceof");
  });

  it("PASSES after a deliberate baseline edit matching an instanceof shrink", () => {
    const tree = makeTree(3, 0, 0);
    const { code, out } = runGuard(tree, scriptWithBaselines(3, 0));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });

  it("ignores *.test.ts instanceof sites", () => {
    const tree = makeTree(3, 0, 1, 9);
    const { code, out } = runGuard(tree, scriptWithBaselines(3, 1));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });
});

describe("check-string-errors.sh — scan guard", () => {
  it("FAILS on an empty scan root (SCAN-EMPTY: no vacuous green)", () => {
    const root = makeDir("empty");
    const { code, out } = runGuard(join(root, "packages"));
    expect(code).toBe(1);
    expect(out.toLowerCase()).toContain("scan-empty");
  });
});
