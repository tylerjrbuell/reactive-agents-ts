// Red-on-cut test for scripts/check-run-scope.sh (Plan 9 item 1R): per-run
// state lives in run slots on ONE FiberRef; a new FiberRef or a new
// Effect.locally / FiberRef.set binding outside the allowlist fails.
// The script takes [SCAN_ROOT], so the cases run against throwaway trees.

import { describe, it, expect, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-run-scope.sh");

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "run-scope-"));
  scratch.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
}

function run(root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync("bash", [SCRIPT, root], { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? "" };
  }
}

describe("check-run-scope.sh", () => {
  it("is green on the current repo", () => {
    const { code, out } = run(join(REPO_ROOT, "packages"));
    if (code !== 0) throw new Error(out);
    expect(code).toBe(0);
  }, 30_000);

  it("fails on a new FiberRef in package source", () => {
    const { code, out } = run(tree({ "runtime/src/leak.ts": 'export const Leak = FiberRef.unsafeMake<number>(0);\n' }));
    expect(code).toBe(1);
    expect(out).toContain("new FiberRef");
  });

  it("fails on a new Effect.locally binding outside the allowlist", () => {
    const { code, out } = run(tree({ "runtime/src/bind.ts": "export const x = Effect.void.pipe(Effect.locally(Leak, 1));\n" }));
    expect(code).toBe(1);
    expect(out).toContain("new binding");
  });

  it("ignores comments and test files", () => {
    const { code } = run(
      tree({
        "runtime/src/doc.ts": "// FiberRef.unsafeMake is banned here\nexport const ok = 1;\n",
        "runtime/src/x.test.ts": "export const T = FiberRef.unsafeMake<number>(0);\n",
      }),
    );
    expect(code).toBe(0);
  });

  it("fails on an empty scan root (no vacuous green)", () => {
    const { code, out } = run(tree({}));
    expect(code).toBe(1);
    expect(out).toContain("SCAN-EMPTY");
  });
});
