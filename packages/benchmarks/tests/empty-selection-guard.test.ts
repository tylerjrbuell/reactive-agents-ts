// Run: bun test packages/benchmarks/tests/empty-selection-guard.test.ts
//
// The measurement instrument must not report success when it measured nothing.
//
// Executed 2026-07-09, against real HEAD:
//
//   bun run src/run.ts --provider ollama --model cogito:8b \
//     --task rw-4,rw-8,rw-9 --variant manual-react,ra-full --runs 3 --gate ...
//
//   →  Tasks 0
//      ✨ All 0 tasks completed in 0.0s
//      ┌── Results ──┐ Duration 0ms · Tokens 0 · Cost $0.0000
//      Report written to bench-capability.json
//      exit code 0
//
// The cause: `--task`/`--variant`/`--gate` are only honored on the SESSION path
// (`run.ts:205+`). The legacy path filters `BENCHMARK_TASKS` — a different, much
// smaller task list that contains no `rw-*` — so every requested id matched
// nothing, and `runBenchmarks` happily ran the empty set to completion.
//
// A green bench over zero cells is worse than a red one: it writes a report that
// later runs will diff against, and it will eventually certify a regression as a
// win. There was no `tasks.length === 0` guard anywhere in run.ts or runner.ts.
//
// Same disease as the rest of the wiring audit, in the instrument we use to
// detect the disease.

import { describe, expect, it } from "bun:test";
import { assertNonEmptySelection } from "../src/session.js";
import { runBenchmarks } from "../src/runner.js";

describe("assertNonEmptySelection — an empty selection is an ERROR, not an empty run", () => {
  it("throws when no task matched, and names what was requested", () => {
    expect(() =>
      assertNonEmptySelection({
        tasks: [],
        requestedTaskIds: ["rw-4", "rw-8"],
        available: ["quick-1", "quick-2"],
      }),
    ).toThrow(/no tasks matched/i);
  });

  it("the error names the requested ids and what WAS available (diagnosable)", () => {
    try {
      assertNonEmptySelection({
        tasks: [],
        requestedTaskIds: ["rw-9"],
        available: ["quick-1"],
      });
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("rw-9");
      expect(msg).toContain("quick-1");
    }
  });

  it("does NOT throw when at least one task matched", () => {
    expect(() =>
      assertNonEmptySelection({
        tasks: [{ id: "rw-4" }],
        requestedTaskIds: ["rw-4"],
        available: ["rw-4"],
      }),
    ).not.toThrow();
  });

  it("throws when tasks exist but every variant was filtered away", () => {
    expect(() =>
      assertNonEmptySelection({
        tasks: [{ id: "rw-4" }],
        variants: [],
        requestedVariantIds: ["ra-full"],
        available: ["rw-4"],
      }),
    ).toThrow(/no variants matched/i);
  });
});

// ─── WIRING: the real entrypoint must refuse to run an empty benchmark ───────
//
// The unit tests above would stay green if nothing called the guard. This drives
// `runBenchmarks` — the legacy path that actually produced the silent 0-task
// report — and asserts it now rejects instead of returning a zeroed report.

describe("WIRING: runBenchmarks refuses an empty task selection", () => {
  it("rejects when every requested task id matches nothing", async () => {
    // Before the guard this RESOLVED with a report of zeros and exit 0.
    await expect(
      runBenchmarks({
        provider: "test",
        taskIds: ["__does-not-exist__"],
      } as Parameters<typeof runBenchmarks>[0]),
    ).rejects.toThrow(/no tasks matched/i);
  });

  it("the rejection names the offending id", async () => {
    const err = await runBenchmarks({
      provider: "test",
      taskIds: ["rw-9"], // real task, but NOT in the legacy BENCHMARK_TASKS list
    } as Parameters<typeof runBenchmarks>[0]).catch((e: Error) => e);
    expect((err as Error).message).toContain("rw-9");
  });
});
