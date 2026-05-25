// File: tests/kernel/loop/run-pass.test.ts
/**
 * Invariant + drift-prevention tests for the shared runPass primitive.
 *
 * Phase 0 template, applied to primitive #3:
 *   1. Pure-decision tests (resolvePassOutput, stepsHadToolCalls)
 *   2. Drift contract — recipe-specific signature: any strategy that imports
 *      `runPass` MUST NOT also import `runKernel` directly (a half-migration
 *      means two competing paths to the kernel, exactly the drift class we
 *      want to prevent).
 *
 * Integration testing of runPass (it calling runKernel) is covered by the
 * live LLM probe — kernel invocation has too many services to mock cleanly,
 * and reflexion/reactive test suites already exercise the full path.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  resolvePassOutput,
  stepsHadToolCalls,
} from "../../../src/kernel/loop/run-pass.js";
import type { KernelState } from "../../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../src/types/index.js";

// ── 1. resolvePassOutput — canonical fallback chain ──────────────────────────

const baseState = (overrides: Partial<KernelState>): KernelState =>
  ({
    output: null,
    steps: [],
    messages: [],
    tokens: 0,
    cost: 0,
    status: "done",
    llmCalls: 0,
    meta: {},
    ...overrides,
  }) as KernelState;

describe("resolvePassOutput", () => {
  it("returns state.output when non-null and non-empty", () => {
    expect(resolvePassOutput(baseState({ output: "the answer" }))).toBe("the answer");
  });

  it("falls back to last thought step when output is null", () => {
    const steps: ReasoningStep[] = [
      { type: "thought", content: "first thought" } as ReasoningStep,
      { type: "action", content: "tool call" } as ReasoningStep,
      { type: "thought", content: "final thought" } as ReasoningStep,
    ];
    expect(resolvePassOutput(baseState({ output: null, steps }))).toBe("final thought");
  });

  it("falls back to last thought when output is empty string", () => {
    const steps: ReasoningStep[] = [
      { type: "thought", content: "only thought" } as ReasoningStep,
    ];
    expect(resolvePassOutput(baseState({ output: "", steps }))).toBe("only thought");
  });

  it("returns null when no output and no thought steps", () => {
    const steps: ReasoningStep[] = [
      { type: "action", content: "tool call" } as ReasoningStep,
      { type: "observation", content: "tool result" } as ReasoningStep,
    ];
    expect(resolvePassOutput(baseState({ output: null, steps }))).toBeNull();
  });

  it("returns null when steps array is empty", () => {
    expect(resolvePassOutput(baseState({ output: null, steps: [] }))).toBeNull();
  });

  it("skips empty-content thought steps in fallback search", () => {
    const steps: ReasoningStep[] = [
      { type: "thought", content: "real thought" } as ReasoningStep,
      { type: "thought", content: "" } as ReasoningStep,
    ];
    // Last thought has empty content — falls back to the prior non-empty one.
    expect(resolvePassOutput(baseState({ output: null, steps }))).toBe("real thought");
  });
});

// ── 2. stepsHadToolCalls — action-step detection ─────────────────────────────

describe("stepsHadToolCalls", () => {
  it("returns false for empty steps", () => {
    expect(stepsHadToolCalls([])).toBe(false);
  });

  it("returns false when no action steps present", () => {
    const steps: ReasoningStep[] = [
      { type: "thought", content: "x" } as ReasoningStep,
      { type: "observation", content: "y" } as ReasoningStep,
    ];
    expect(stepsHadToolCalls(steps)).toBe(false);
  });

  it("returns true when at least one action step present", () => {
    const steps: ReasoningStep[] = [
      { type: "thought", content: "x" } as ReasoningStep,
      { type: "action", content: "call" } as ReasoningStep,
    ];
    expect(stepsHadToolCalls(steps)).toBe(true);
  });
});

// ── 3. DRIFT CONTRACT — half-migration prevention ────────────────────────────

describe("drift contract — runPass primitive", () => {
  it("no strategies/*.ts file may import both runPass and runKernel", () => {
    // Half-migration = two competing kernel-invocation paths inside one
    // strategy. Once a strategy adopts runPass, it must adopt runPass
    // everywhere — otherwise the output-fallback / hadToolCalls / cost
    // normalization will drift between sites within the same file.
    //
    // Opt-out via `// run-pass-mixed-exempt` comment if a strategy
    // genuinely needs both surfaces transiently.
    const stratDir = join(__dirname, "../../../src/strategies");
    const files = readdirSync(stratDir).filter((f) => f.endsWith(".ts"));
    const violations: string[] = [];

    for (const file of files) {
      const src = readFileSync(join(stratDir, file), "utf8");
      const importsRunPass =
        /import\s*\{[^}]*\brunPass\b[^}]*\}\s*from\s*["'][^"']*run-pass\.js["']/.test(src);
      const importsRunKernel =
        /import\s*\{[^}]*\brunKernel\b[^}]*\}\s*from\s*["'][^"']*runner\.js["']/.test(src);
      const exempt = /run-pass-mixed-exempt/.test(src);
      if (importsRunPass && importsRunKernel && !exempt) {
        violations.push(file);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Drift contract violated — strategies must use runPass exclusively after migration: ${violations.join(", ")}`,
      );
    }
    expect(violations.length).toBe(0);
  });
});
