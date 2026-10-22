// Program law (quality & scalability plan, GH #259): "Prose findings do not
// discharge debt. Only gates do." This is the red-on-cut mutation test for
// scripts/check-file-size.sh — the file-size ratchet that ends the regrowth
// disease documented three times (#217 +226, #218 +267, #219 +310 LOC in ~4
// weeks after each prior trim).
//
// Semantics proven here:
//   • green on the real tree (the CI invariant; also discovered automatically
//     by enforcement-scripts.test.ts via the scripts/check-*.sh glob);
//   • growth above a ceiling FAILS naming the file;
//   • SHRINKING below a ceiling without a baseline edit FAILS (the baseline may
//     only shrink deliberately, same law as check-orphans.sh);
//   • a new file at/above 1000 LOC that is not in the baseline FAILS;
//   • a baseline entry whose file disappeared FAILS (rename/delete is a
//     deliberate ledger edit);
//   • an empty scan root FAILS (SCAN-EMPTY; a check that cannot fail is theater);
//   • a deliberate baseline edit matching a shrink turns the tree green.
//
// The guard takes [SCAN_DIR] so these cases run against throwaway trees under
// /tmp; the production repo is never mutated. Baseline patches use the same
// scratch-copy technique as declaration-orphans.test.ts.

import { describe, it, expect, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-file-size.sh");

const scratchDirs: string[] = [];
afterEach(() => {
  while (scratchDirs.length > 0) {
    rmSync(join(tmpdir(), scratchDirs.pop()!), { recursive: true, force: true });
  }
});

function makeDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `filesize-${name}-`));
  scratchDirs.push(dir.split("/").pop()!);
  return dir;
}

/** Write a scratch COPY of the guard with SIZE_BASELINE replaced (fixture-only ledger). */
function scriptWithBaseline(entries: readonly string[]): string {
  const original = readFileSync(SCRIPT, "utf8");
  const patched = original.replace(
    /SIZE_BASELINE=\([^#]*\)/s,
    `SIZE_BASELINE=(\n${entries.map((e) => `  "${e}"`).join("\n")}\n)`,
  );
  if (patched === original && entries.length > 0) {
    throw new Error("baseline patch did not apply — SIZE_BASELINE literal drifted");
  }
  const dir = makeDir("script");
  const path = join(dir, "check-file-size.sh");
  writeFileSync(path, patched);
  return path;
}

/** A `packages`-shaped tree: files keyed by scan-relative path, value = line count. */
function makeTree(files: Record<string, number>): string {
  const root = makeDir("tree");
  const packages = join(root, "packages");
  for (const [rel, lines] of Object.entries(files)) {
    const abs = join(packages, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "// x\n".repeat(lines));
  }
  return packages;
}

function runGuard(
  scanDir: string,
  script: string = SCRIPT,
): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [script, scanDir], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: err.status ?? 1,
      out: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

describe("check-file-size.sh — real tree", () => {
  it("is green on the current repo (the CI invariant)", () => {
    const { code, out } = runGuard(join(REPO_ROOT, "packages"));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });

  it("discovers its baseline: the ledger is non-empty and every entry exists", () => {
    const src = readFileSync(SCRIPT, "utf8");
    const entries = [...src.matchAll(/"([^"]+):\d+"/g)].map((m) => m[1]);
    expect(entries.length).toBeGreaterThanOrEqual(23);
    for (const rel of entries) {
      expect(readFileSync(join(REPO_ROOT, "packages", rel), "utf8").length).toBeGreaterThan(0);
    }
  });
});

describe("check-file-size.sh — red-on-cut fixtures", () => {
  const BASE = ["a/src/big.ts:10", "a/src/kept.ts:6"];

  it("FAILS when a baselined file grows one line past its ceiling", () => {
    const tree = makeTree({ "a/src/big.ts": 11, "a/src/kept.ts": 6 });
    const { code, out } = runGuard(tree, scriptWithBaseline(BASE));
    expect(code).toBe(1);
    expect(out).toContain("a/src/big.ts");
    expect(out.toLowerCase()).toContain("grew");
  });

  it("FAILS when a baselined file SHRINKS without a baseline edit (shrink-only law)", () => {
    const tree = makeTree({ "a/src/big.ts": 8, "a/src/kept.ts": 6 });
    const { code, out } = runGuard(tree, scriptWithBaseline(BASE));
    expect(code).toBe(1);
    expect(out).toContain("a/src/big.ts");
    expect(out.toLowerCase()).toContain("update the baseline");
  });

  it("PASSES after a deliberate baseline edit matching the shrink", () => {
    const tree = makeTree({ "a/src/big.ts": 8, "a/src/kept.ts": 6 });
    const { code, out } = runGuard(tree, scriptWithBaseline(["a/src/big.ts:8", "a/src/kept.ts:6"]));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });

  it("FAILS on a new >=1000-line file absent from the ledger (new giant is forbidden)", () => {
    const tree = makeTree({
      "a/src/big.ts": 10,
      "a/src/kept.ts": 6,
      "b/src/monster.ts": 1000,
    });
    const { code, out } = runGuard(tree, scriptWithBaseline(BASE));
    expect(code).toBe(1);
    expect(out).toContain("b/src/monster.ts");
    expect(out.toLowerCase()).toContain("not baselined");
  });

  it("FAILS when a baselined file disappears (rename/delete needs a ledger edit)", () => {
    const tree = makeTree({ "a/src/big.ts": 10 });
    const { code, out } = runGuard(tree, scriptWithBaseline(BASE));
    expect(code).toBe(1);
    expect(out).toContain("a/src/kept.ts");
    expect(out.toLowerCase()).toContain("missing");
  });

  it("FAILS on an empty scan root (SCAN-EMPTY: no vacuous green)", () => {
    const root = makeDir("empty");
    const { code, out } = runGuard(join(root, "packages"));
    expect(code).toBe(1);
    expect(out.toLowerCase()).toContain("scan-empty");
  });

  it("ignores test files (*.test.ts) in the new-giant scan", () => {
    const tree = makeTree({
      "a/src/big.ts": 10,
      "a/src/kept.ts": 6,
      "b/src/huge.test.ts": 1000,
    });
    const { code, out } = runGuard(tree, scriptWithBaseline(BASE));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  });
});
