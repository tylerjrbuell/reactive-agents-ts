// Run: bun test packages/benchmarks/tests/drift-dropped-cells.test.ts
//
// P1 of the capability-measurement wave: record the series, so "are the agents
// getting more capable?" becomes answerable. Before storing a baseline, the
// thing that reads it has to be correct.
//
// `computeDrift` iterates the CURRENT reports and looks each one up in the
// baseline:
//
//     for (const cur of current) {
//       const base = baseline.find(...)
//       if (!base) continue          // <-- one direction only
//
// So a cell that EXISTS IN THE BASELINE and is ABSENT from the current run is
// never examined. A task that was deleted, renamed, filtered out, or crashed
// hard enough to produce no report registers as *no regression*.
//
// That is the worst possible failure for a regression gate: the way to make the
// gate green is to stop measuring. It is the same disease as the bench that
// reported success over zero tasks (fixed in eed36fd9) — silence read as health.
//
// A dropped cell is not "no data", it is a REGRESSION IN COVERAGE, and the gate
// must say so.

import { describe, expect, it } from "bun:test";
import { computeDrift, exceedsThreshold } from "../src/ci.js";
import type { TaskVariantReport } from "../src/types.js";

const cell = (taskId: string, variantId: string, accuracy: number): TaskVariantReport =>
  ({
    taskId,
    variantId,
    modelVariantId: "cogito-8b",
    variantLabel: variantId,
    runs: [],
    meanScores: [{ dimension: "accuracy", score: accuracy }],
    variance: 0,
    meanTokens: 0,
    meanDurationMs: 0,
    passRate: 1,
    solveRate: accuracy >= 1 ? 1 : 0,
  }) as unknown as TaskVariantReport;

const BASE = [cell("rw-4", "ra-full", 0.8), cell("rw-8", "ra-full", 0.8), cell("rw-9", "ra-full", 0.8)];

describe("computeDrift — a cell that disappears is a coverage regression, not silence", () => {
  it("BUG: a baseline cell missing from the current run is reported as dropped", () => {
    const current = [cell("rw-4", "ra-full", 0.8), cell("rw-8", "ra-full", 0.8)]; // rw-9 vanished
    const drift = computeDrift(BASE, current, "abc123");
    expect(drift.droppedCells).toHaveLength(1);
    expect(drift.droppedCells[0]).toMatchObject({ taskId: "rw-9", variantId: "ra-full" });
  });

  it("a dropped cell FAILS the gate — you cannot go green by measuring less", () => {
    const current = [cell("rw-4", "ra-full", 0.8), cell("rw-8", "ra-full", 0.8)];
    const drift = computeDrift(BASE, current, "abc123");
    // Scores of the surviving cells are unchanged, so without this rule the gate
    // would pass a run that quietly stopped measuring a third of the suite.
    expect(drift.regressions).toHaveLength(0);
    expect(exceedsThreshold(drift)).toBe(true);
  });

  it("dropping EVERY cell is the loudest possible failure, not a clean pass", () => {
    const drift = computeDrift(BASE, [], "abc123");
    expect(drift.droppedCells).toHaveLength(3);
    expect(exceedsThreshold(drift)).toBe(true);
  });

  it("a NEW cell is recorded but does not fail the gate (adding coverage is good)", () => {
    const current = [...BASE, cell("rw-10", "ra-full", 0.5)];
    const drift = computeDrift(BASE, current, "abc123");
    expect(drift.newCells).toHaveLength(1);
    expect(drift.newCells[0]).toMatchObject({ taskId: "rw-10" });
    expect(exceedsThreshold(drift)).toBe(false);
  });

  it("an identical run drifts nowhere and passes", () => {
    const drift = computeDrift(BASE, [...BASE], "abc123");
    expect(drift.droppedCells).toHaveLength(0);
    expect(drift.newCells).toHaveLength(0);
    expect(drift.hasRegressions).toBe(false);
    expect(exceedsThreshold(drift)).toBe(false);
  });

  it("a real score regression still fails (the original behaviour is intact)", () => {
    const current = [cell("rw-4", "ra-full", 0.2), cell("rw-8", "ra-full", 0.8), cell("rw-9", "ra-full", 0.8)];
    const drift = computeDrift(BASE, current, "abc123");
    expect(drift.regressions).toHaveLength(1);
    expect(exceedsThreshold(drift)).toBe(true);
  });

  it("a real improvement is recorded and does not fail", () => {
    const current = [cell("rw-4", "ra-full", 1.0), cell("rw-8", "ra-full", 0.8), cell("rw-9", "ra-full", 0.8)];
    const drift = computeDrift(BASE, current, "abc123");
    expect(drift.improvements).toHaveLength(1);
    expect(exceedsThreshold(drift)).toBe(false);
  });
});

// ─── The stored baseline is a committed artifact — keep it lean and valid ────

import { saveBaseline, loadBaseline } from "../src/ci.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("saveBaseline — a tracked baseline must not carry raw model output", () => {
  it("strips run outputs, traces and diagnoses (drift reads meanScores, not prose)", () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-"));
    try {
      const fat = [
        {
          ...cell("rw-4", "ra-full", 0.8),
          runs: [
            {
              runIndex: 0,
              status: "pass",
              tokensUsed: 100,
              durationMs: 1,
              dimensions: [{ dimension: "accuracy", score: 0.8 }],
              output: "SECRET-MODEL-PROSE-THAT-SHOULD-NOT-BE-COMMITTED",
              traceId: "t1",
              diagnosis: { honestyLabel: "x", honestyEvidence: "y", failureModes: [], blindSpots: [] },
            },
          ],
        } as unknown as TaskVariantReport,
      ];
      const path = join(dir, "b.json");
      saveBaseline(fat, "sha1", path);
      const raw = readFileSync(path, "utf8");
      expect(existsSync(path)).toBe(true);
      expect(raw).not.toContain("SECRET-MODEL-PROSE");
      expect(raw).not.toContain("traceId");
      expect(raw).not.toContain("diagnosis");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps per-run accuracy + counts (a future power-aware drift needs them)", () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-"));
    try {
      const path = join(dir, "b.json");
      const src = [
        {
          ...cell("rw-4", "ra-full", 0.8),
          runs: [
            { runIndex: 0, status: "pass", tokensUsed: 5, durationMs: 1, dimensions: [{ dimension: "accuracy", score: 0.8 }], output: "x" },
          ],
        } as unknown as TaskVariantReport,
      ];
      saveBaseline(src, "sha1", path);
      const back = loadBaseline(path);
      expect(back?.gitSha).toBe("sha1");
      expect(back?.reports[0]?.runs).toHaveLength(1);
      expect(back?.reports[0]?.runs[0]?.dimensions[0]?.score).toBe(0.8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the COMMITTED baseline is loadable and non-empty", () => {
  it("real-world-full.json parses, names a git sha, and has cells", () => {
    // Guards against committing a corrupt or empty baseline, which would make
    // every future drift check vacuously pass.
    const b = loadBaseline(join(import.meta.dir, "..", "benchmark-baselines", "real-world-full.json"));
    expect(b).not.toBeNull();
    expect(b!.gitSha.length).toBeGreaterThan(6);
    expect(b!.reports.length).toBeGreaterThan(0);
  });

  it("drifting the committed baseline against itself is clean", () => {
    const b = loadBaseline(join(import.meta.dir, "..", "benchmark-baselines", "real-world-full.json"))!;
    const drift = computeDrift(b.reports, b.reports, b.gitSha);
    expect(drift.droppedCells).toHaveLength(0);
    expect(exceedsThreshold(drift)).toBe(false);
  });

  it("dropping one committed cell fails the gate", () => {
    const b = loadBaseline(join(import.meta.dir, "..", "benchmark-baselines", "real-world-full.json"))!;
    const drift = computeDrift(b.reports, b.reports.slice(1), b.gitSha);
    expect(drift.droppedCells).toHaveLength(1);
    expect(exceedsThreshold(drift)).toBe(true);
  });
});

// ─── "No data" must never read as "no regression" ────────────────────────────

import { baselineCells, assertBaselineCells } from "../src/ci.js";

describe("baselineCells / assertBaselineCells — an empty baseline is vacuous", () => {
  it("prefers taskReports (always populated) over ablation (multi-variant only)", () => {
    const cells = baselineCells({
      taskReports: [cell("rw-4", "ra-full", 0.8)],
      ablation: [],
    });
    expect(cells).toHaveLength(1);
  });

  it("falls back to ablation variants when taskReports is empty", () => {
    const cells = baselineCells({
      taskReports: [],
      ablation: [{ variants: [cell("rw-4", "ra-full", 0.8), cell("rw-4", "manual-react", 0.1)] }],
    });
    expect(cells).toHaveLength(2);
  });

  it("a SINGLE-variant run has no ablation — the old code saved an empty baseline", () => {
    // report.ablation === [] for single-variant sessions; the old expression
    // `ablation.flatMap(a => a.variants)` produced [] and saveBaseline wrote it.
    expect(baselineCells({ taskReports: [], ablation: [] })).toHaveLength(0);
  });

  it("refuses to save an empty baseline (every later drift check would pass vacuously)", () => {
    expect(() => assertBaselineCells([])).toThrow(/empty baseline/i);
  });

  it("accepts a non-empty baseline", () => {
    expect(() => assertBaselineCells([cell("rw-4", "ra-full", 0.8)])).not.toThrow();
  });
});
