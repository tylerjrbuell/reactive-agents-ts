// Run: bun test packages/benchmarks/tests/billed-tokens-on-gate-path.test.ts --timeout 60000
//
// C3 regression pin — the GATE/ABLATION path must receive billed tokens.
//
// There are two measurement paths in `runner.ts`:
//   • `runTask`     → TaskResult      → runBenchmarks   (bench CLI only)
//   • `runInternal` → TaskRunResult   → RunScore → aggregateRuns → the LIFT GATE
//
// Only the first ever subscribed to `LLMRequestCompleted`. The second read
// `AgentResult.metadata.billedTokens`, which NOTHING populates, so every real
// gate/ablation measurement silently reported `billedTokens === tokensUsed`
// and `cacheReadTokens === 0` — the ratified billed-token rule was inert on
// the exact path it was ratified for.
//
// This runs a REAL session through `runSession` on the scripted deterministic
// `test` provider (no keys, no network) and asserts the billed fields arrive
// on the RunScore, and that they came from the LIVE per-call event rather than
// a hardcoded 0 or the (still-absent) metadata field.

import { describe, expect, it } from "bun:test";
import { runSession } from "../src/runner.js";
import { getVariant } from "../src/session.js";
import type { BenchmarkSession, ModelVariant } from "../src/types.js";

const scriptedModel: ModelVariant = {
  id: "scripted-test",
  provider: "test",
  // Must be exactly "test": capability resolves from the test/test static entry.
  model: "test",
  contextTier: "local",
  scenarios: {
    "cs-recall-temptation": [
      { text: "The final section title is: ZEBRA-CODA" },
    ],
  },
};

const session: BenchmarkSession = {
  id: "billed-tokens-on-gate-path",
  name: "C3 — billed tokens reach the gate/ablation path",
  version: "1.0.0",
  taskIds: ["cs-recall-temptation"],
  models: [scriptedModel],
  harnessVariants: [getVariant("bare-llm")],
  runs: 1,
  concurrency: 1,
  timeoutMs: 60_000,
  logLevel: "silent",
};

describe("billed tokens on the gate/ablation measurement path", () => {
  it("populates billedTokens/cacheReadTokens from the live LLMRequestCompleted subscription", async () => {
    const report = await runSession(session);
    const cells = report.taskReports ?? [];
    expect(cells.length).toBeGreaterThan(0);

    const cell = cells[0]!;
    const run = cell.runs[0]!;

    // The event fired, so the fields are PRESENT (they are omitted entirely
    // when it never fires — see `billedTokenFields`).
    expect(run.billedTokens).toBeDefined();
    expect(run.cacheReadTokens).toBeDefined();

    // Live, not a hardcoded 0: the scripted provider reports real usage, so a
    // subscription that actually ran must have accumulated a positive figure.
    // `AgentResult.metadata` carries neither field today, so this number can
    // ONLY have come from the event stream.
    expect(run.billedTokens!).toBeGreaterThan(0);
    // No cache on the test provider — the split is reported, not invented.
    expect(run.cacheReadTokens!).toBe(0);

    // And it rolls up to the figure the gate's billed leg scores.
    expect(cell.meanBilledTokens).toBeGreaterThan(0);
    expect(Number.isFinite(cell.meanCacheReadTokens ?? 0)).toBe(true);
  }, 60_000);
});
