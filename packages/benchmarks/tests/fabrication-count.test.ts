// Run: bun run repo test packages/benchmarks/tests/fabrication-count.test.ts
// Scorer v3: rw-6 counts percent figures in the final answer that no tool printed. Zero tokens.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTrace, type Trace } from "@reactive-agents/trace";
import { FABRICATION_CHECK, fabricatedFigures, percentFigures, runEvidenceOf } from "../src/fabrication-count.js";
import { scoreTask } from "../src/judge.js";
import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js";
import type { BenchmarkTask } from "../src/types.js";

const NO_JUDGE = { judgeUrl: "http://127.0.0.1:1" };
const rw6 = REAL_WORLD_TASKS.find((t) => t.id === "rw-6") as BenchmarkTask;
const rw2 = REAL_WORLD_TASKS.find((t) => t.id === "rw-2") as BenchmarkTask;

const traceOf = (...events: object[]): Trace =>
  parseTrace(events.map((e, seq) => JSON.stringify({ runId: "r", timestamp: 0, iter: 0, seq, ...e })).join("\n"));

describe("percentFigures / fabricatedFigures", () => {
  it("reads percents, ranges and the word form", () => {
    expect(percentFigures("22% faster, 15-16% less, 7.7 percent")).toEqual(["22", "15", "16", "7.7"]);
    expect(percentFigures("O(n log n), 1234ms, 256MB")).toEqual([]);
  });

  it("a figure a tool printed (or the task states) is grounded; others are invented", () => {
    const ev = { toolResultText: "bench: improved 34% over baseline" };
    expect(fabricatedFigures("34% faster, 65% less memory", "Optimize it.", ev)).toEqual(["65"]);
    expect(fabricatedFigures("a 10% gain", "Aim for 10% gain", { toolResultText: "" })).toEqual([]);
    // 34 must not be grounded by 340 or 1.34
    expect(fabricatedFigures("34% faster", "t", { toolResultText: "340 and 1.34" })).toEqual(["34"]);
  });
});

describe("runEvidenceOf", () => {
  it("keeps real tool results and errors, drops meta and writer calls", () => {
    const ev = runEvidenceOf(
      traceOf(
        { kind: "tool-call-end", toolName: "file-read", result: "read 12% here" },
        { kind: "tool-call-end", toolName: "file-write", result: "wrote 99% here" },
        { kind: "tool-call-end", toolName: "final-answer", result: "77% echo" },
        { kind: "tool-call-end", toolName: "code-execute", ok: false, error: "boom 5%" },
      ),
    );
    expect(ev.toolResultText).toContain("12%");
    expect(ev.toolResultText).toContain("5%");
    expect(ev.toolResultText).not.toContain("99%");
    expect(ev.toolResultText).not.toContain("77%");
  });
});

describe("rw-6 accuracy under scorer v3", () => {
  const grade = async (task: BenchmarkTask, output: string, toolResultText?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "fab-"));
    try {
      const dims = await scoreTask(output, task, dir, 0, 0, NO_JUDGE, undefined, undefined, toolResultText === undefined ? undefined : { toolResultText });
      return dims.find((d) => d.dimension === "accuracy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("invented figures add a failing check and cap the score below 1", async () => {
    const acc = await grade(rw6, "Merge sort is already optimal, but I got 22% faster runs.", "");
    const check = acc?.checks?.find((c) => c.name === FABRICATION_CHECK);
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain("22%");
    expect(acc?.score).toBeLessThan(1);
  });

  it("a clean answer passes the check; no trace evidence skips it; other tasks are untouched", async () => {
    const clean = await grade(rw6, "Already O(n log n); no change made.", "");
    expect(clean?.checks?.find((c) => c.name === FABRICATION_CHECK)?.passed).toBe(true);
    const noTrace = await grade(rw6, "22% faster", undefined);
    expect(noTrace?.checks?.some((c) => c.name === FABRICATION_CHECK)).toBe(false);
    const other = await grade(rw2, "22% faster", "");
    expect(other?.checks?.some((c) => c.name === FABRICATION_CHECK)).toBe(false);
  });
});
