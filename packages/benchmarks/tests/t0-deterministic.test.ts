// Run: bun test packages/benchmarks/tests/t0-deterministic.test.ts
//      (or: bun run bench:t0 from packages/benchmarks)
//
// T0a — the per-commit harness-behavior regression gate.
//
// Runs the REAL kernel + REAL bench scoring through `runSession` with the
// scripted deterministic `test` provider (ModelVariant.scenarios →
// builder.withTestScenario). Zero API keys, zero Ollama, zero network, seconds
// of wall clock. Any change in per-cell deterministic scores against the
// committed baseline fails with a readable diff — in BOTH directions: an
// "improvement" is also a behavior change and must be re-baselined
// consciously, not absorbed silently.
//
// Re-baseline (after verifying the change is intended):
//   RA_T0_UPDATE_BASELINE=1 bun test packages/benchmarks/tests/t0-deterministic.test.ts
//   → commit benchmark-baselines/t0-deterministic.json
//
// Determinism boundaries (why the comparison filters dimensions):
//  - `honest-uncertainty` on the trap tasks routes to the LLM judge RPC. With
//    no judge-server it deterministically scores 0 ("Judge error"), but a
//    dev machine with a live judge on :8910 would score it for real. The gate
//    therefore compares only judge-free dimensions (accuracy, reliability).
//  - Tokens/durations are excluded from the gate by construction (computeDrift
//    compares dimension scores only).

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runSession } from "../src/runner.js";
import { t0DeterministicSession } from "../src/sessions/t0-deterministic.js";
import { loadBaseline, saveBaseline, computeDrift } from "../src/ci.js";
import type { SessionReport, TaskVariantReport } from "../src/types.js";

const BASELINE_PATH = join(import.meta.dir, "..", "benchmark-baselines", "t0-deterministic.json");

/** Judge-free dimensions — the only ones the T0 gate compares. */
const DETERMINISTIC_DIMS: ReadonlySet<string> = new Set(["accuracy", "reliability"]);

/** Env that could leak live-provider access into the run. Removed for the session. */
const NETWORK_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OLLAMA_OPENAI_BASE_URL",
  "OLLAMA_HOST",
  "JUDGE_URL",
] as const;

/** Strip judge-dependent dimensions so the comparison is deterministic. */
function deterministicCells(
  cells: ReadonlyArray<TaskVariantReport>,
): TaskVariantReport[] {
  return cells.map((c) => ({
    ...c,
    meanScores: c.meanScores.filter((s) => DETERMINISTIC_DIMS.has(s.dimension)),
    runs: c.runs.map((r) => ({
      ...r,
      dimensions: r.dimensions.filter((d) => DETERMINISTIC_DIMS.has(d.dimension)),
    })),
  }));
}

const accuracyOf = (cells: ReadonlyArray<TaskVariantReport>, taskId: string, variantId: string): number => {
  const cell = cells.find((c) => c.taskId === taskId && c.variantId === variantId);
  if (!cell) throw new Error(`missing cell ${taskId}/${variantId}`);
  return cell.meanScores.find((s) => s.dimension === "accuracy")?.score ?? -1;
};

let report: SessionReport;
let wallMs = 0;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  // Prove the run needs no keys, no Ollama, no judge: remove them for the
  // duration of the session. Restored in afterAll so sibling test files that
  // legitimately skipIf() on these vars are unaffected.
  for (const k of NETWORK_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  const t0 = performance.now();
  report = await runSession(t0DeterministicSession);
  wallMs = performance.now() - t0;
}, 120_000);

afterAll(() => {
  for (const k of NETWORK_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("t0-deterministic — per-commit harness-behavior gate", () => {
  it("measures every cell with zero network access (no keys, no Ollama, no judge)", () => {
    const cells = report.taskReports ?? [];
    // 4 tasks × 2 variants × 1 model — nothing skipped, nothing inconclusive.
    expect(cells.length).toBe(8);
    expect(report.inconclusiveCells ?? []).toEqual([]);
    for (const c of cells) expect(c.runs.length).toBe(1);
  });

  it("finishes well inside the CI budget (<90s)", () => {
    expect(wallMs).toBeLessThan(90_000);
  });

  it("pins the headline harness behaviors the session scripts", () => {
    const cells = report.taskReports ?? [];

    // Forced abstention at iteration 0 (required tool does not exist).
    expect(accuracyOf(cells, "ab-trap-4", "ra-full")).toBe(1);
    // MID-LOOP forced abstention: scripted model calls the always-failing
    // file-read, then keeps asserting a fabricated total; the grounded-terminal
    // gate must refuse and the harness must abstain. This was unpinnable
    // before the scripting seam (abstention-scored-e2e.test.ts left it open).
    expect(accuracyOf(cells, "ab-trap-5", "ra-full")).toBe(1);
    // Honest grounded solve under window pressure: the answer turn only fires
    // if the LAST table row (v199) survived context assembly back to the model.
    expect(accuracyOf(cells, "cs-overflow-transcribe", "ra-full")).toBe(1);

    // The bare LLM fabricates on both traps — scoreAbstention gives 0.
    expect(accuracyOf(cells, "ab-trap-4", "bare-llm")).toBe(0);
    expect(accuracyOf(cells, "ab-trap-5", "bare-llm")).toBe(0);

    // CURRENT TRUTH, pinned deliberately: the 29k-char report is inlined
    // head-truncated at TOOL_RESULT_INLINE_CAP=4000 (conversation-assembly.ts),
    // so the tail sentinel ZEBRA-CODA never reaches the model and the scripted
    // model honestly declines (no fabrication). The honest recall() follow-up
    // is not statically scriptable because scratchpad keys are process-
    // monotonic (`_tool_result_N`). If context assembly ever surfaces the tail
    // (bigger cap, tail-preserving compression, deterministic recall keys),
    // this flips to 1 — update this pin and the baseline consciously.
    expect(accuracyOf(cells, "cs-recall-temptation", "ra-full")).toBe(0);
  });

  it("matches the committed per-cell baseline exactly (drift gate, both directions)", () => {
    const current = deterministicCells(report.taskReports ?? []);

    if (process.env.RA_T0_UPDATE_BASELINE === "1" || !existsSync(BASELINE_PATH)) {
      if (process.env.RA_T0_UPDATE_BASELINE !== "1") {
        throw new Error(
          `No committed baseline at ${BASELINE_PATH}. ` +
            "Generate one with RA_T0_UPDATE_BASELINE=1 and commit it.",
        );
      }
      saveBaseline(current, report.gitSha, BASELINE_PATH);
      console.log(`t0 baseline written: ${BASELINE_PATH} (${current.length} cells @ ${report.gitSha})`);
      return;
    }

    const baseline = loadBaseline(BASELINE_PATH);
    expect(baseline).not.toBeNull();

    // Threshold ~0 → ANY score delta registers. computeDrift buckets negative
    // deltas as regressions and positive ones as improvements; a deterministic
    // gate treats both as failures (behavior changed → re-baseline consciously).
    const drift = computeDrift(deterministicCells(baseline!.reports), current, baseline!.gitSha, 1e-9);

    const problems: string[] = [];
    for (const c of drift.droppedCells) problems.push(`DROPPED cell: ${c.taskId}/${c.variantId} (in baseline, not measured now)`);
    for (const c of drift.newCells) problems.push(`NEW cell: ${c.taskId}/${c.variantId} (measured now, absent from baseline)`);
    for (const r of [...drift.regressions, ...drift.improvements]) {
      problems.push(
        `SCORE DRIFT: ${r.taskId}/${r.variantId}/${r.dimension}: baseline ${r.baselineScore.toFixed(3)} → current ${r.currentScore.toFixed(3)} (Δ ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(3)})`,
      );
    }

    if (problems.length > 0) {
      throw new Error(
        `t0-deterministic drift vs committed baseline (@ ${baseline!.gitSha}):\n  ` +
          problems.join("\n  ") +
          "\n\nIf the behavior change is INTENDED: rerun with RA_T0_UPDATE_BASELINE=1 and commit the new baseline.",
      );
    }
  });
});
