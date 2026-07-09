// Run: bun test packages/reasoning/tests/enforcement-scripts.test.ts
//
// Program law (wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md §6):
//
//     "Every subsystem: one owner module + one grep-able enforcement script.
//      No script → not done."
//
// The wiring audit (2026-07-09) found that six of the eight scripts were never
// executed by anything — two of them appeared only inside code COMMENTS that
// claimed the invariant was enforced. `check-policy-compiler.sh` had been RED on
// main since Phase 7 landed a day earlier, correctly flagging a real
// single-owner violation, and nobody heard it.
//
// The law had quietly degraded from "the script must pass" to "the script must
// exist". This test restores it: every `scripts/check-*.sh` is DISCOVERED (not
// enumerated — a new script is picked up automatically) and executed. A red
// invariant is now a red test.

import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");

const enforcementScripts = readdirSync(SCRIPTS_DIR)
  .filter((f) => f.startsWith("check-") && f.endsWith(".sh"))
  .sort();

describe("enforcement scripts — every invariant script must actually run and pass", () => {
  it("discovers the enforcement scripts (guards against an empty, vacuously-green suite)", () => {
    // If this ever drops to zero the loop below would pass by doing nothing —
    // the exact failure mode ("a check that cannot fail") this file exists to end.
    expect(enforcementScripts.length).toBeGreaterThanOrEqual(8);
  });

  for (const script of enforcementScripts) {
    it(`${script} passes`, async () => {
      const proc = Bun.spawn(["bash", join(SCRIPTS_DIR, script)], {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(
          `${script} FAILED (exit ${exitCode}) — an architectural invariant is violated.\n\n${stdout}${stderr}`,
        );
      }
      expect(exitCode).toBe(0);
    }, 30_000);
  }
});
