// packages/llm-provider/src/calibration-static-consistency.test.ts
// Run: bun test packages/llm-provider/src/calibration-static-consistency.test.ts
//
// Invariant guard: 2026-07-29 systems audit, root cause #4. STATIC_CAPABILITIES
// entries are hand-authored guesses (`source: "static-table"`); calibration
// files under calibrations/*.json are empirically measured (probeVersion,
// runsAveraged). Found live: "ollama/qwen3:14b" claimed `toolCallDialect:
// "native-fc"` while its OWN calibration file (3 runs averaged) measured
// "none" — a silent contradiction between a guess and the model's own
// measured data, undetectable by model-support-consistency.test.ts (which
// explicitly excludes ollama as "probe-on-use").
//
// This does not require Ollama to be running — calibration files are
// pre-baked JSON, loaded synchronously from disk via `loadCalibration`.
import { describe, it, expect } from "bun:test";
import { STATIC_CAPABILITIES } from "./capability.js";
import { loadCalibration } from "./calibration.js";

describe("STATIC_CAPABILITIES vs calibration file consistency (ollama)", () => {
  it("no ollama static-table entry contradicts its own calibration file's toolCallDialect", () => {
    const contradictions: string[] = [];
    for (const [key, cap] of Object.entries(STATIC_CAPABILITIES)) {
      if (cap.provider !== "ollama") continue;
      const calibration = loadCalibration(cap.model);
      if (!calibration || calibration.toolCallDialect === undefined) continue;
      if (calibration.toolCallDialect !== cap.toolCallDialect) {
        contradictions.push(
          `${key}: static-table says "${cap.toolCallDialect}", calibration file (${calibration.runsAveraged} runs) measured "${calibration.toolCallDialect}"`,
        );
      }
    }
    expect(contradictions).toEqual([]);
  });
});
