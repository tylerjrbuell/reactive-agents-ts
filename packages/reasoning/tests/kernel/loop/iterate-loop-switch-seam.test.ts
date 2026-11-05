// #281 — direct-import behavioral pins for iterate-loop-switch-seam.ts
// (extracted verbatim from iterate-pass.ts, #222). Pins the two ZERO-LLM
// branches: the configured fallback fast path, and the deterministic ladder
// that is the DEFAULT (an LLM round-trip only fires for a custom multi-candidate
// set). Run with an empty scripted LLM: any accidental LLM call would diverge
// from the asserted verdicts.

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { resolveLoopSwitchEvaluation } from "../../../src/kernel/loop/iterate-loop-switch-seam.js";
import { initialKernelState, type KernelInput, type KernelRunOptions } from "../../../src/kernel/state/kernel-state.js";

const state = initialKernelState({ maxIterations: 5, strategy: "reactive", kernelType: "react" });
const input: KernelInput = { task: "do the thing" };
type SwitchCfg = NonNullable<KernelRunOptions["strategySwitching"]>;

const run = (switchCfg: SwitchCfg, triedStrategies: readonly string[]) =>
  Effect.runPromise(
    resolveLoopSwitchEvaluation({ state, switchCfg, currentInput: input, triedStrategies }).pipe(
      Effect.provide(TestLLMServiceLayer([])),
    ),
  );

describe("resolveLoopSwitchEvaluation — zero-LLM branches", () => {
  it("a configured fallbackStrategy wins outright, regardless of what was tried", async () => {
    const v = await run({ enabled: true, fallbackStrategy: "reflexion" }, ["reactive", "reflexion"]);
    expect(v).toEqual({
      shouldSwitch: true,
      recommendedStrategy: "reflexion",
      reasoning: "fallback strategy configured",
    });
  });

  it("default config walks the deterministic ladder: reactive -> plan-execute-reflect", async () => {
    const v = await run({ enabled: true }, ["reactive"]);
    expect(v).toEqual({
      shouldSwitch: true,
      recommendedStrategy: "plan-execute-reflect",
      reasoning: "deterministic ladder → plan-execute-reflect",
    });
  });

  it("second switch goes to reflexion", async () => {
    const v = await run({ enabled: true }, ["reactive", "plan-execute-reflect"]);
    expect(v.recommendedStrategy).toBe("reflexion");
    expect(v.shouldSwitch).toBe(true);
  });

  it("an explicit canonical candidate set is still the deterministic ladder (not the LLM path)", async () => {
    const v = await run(
      { enabled: true, availableStrategies: ["tree-of-thought", "reflexion", "plan-execute-reflect", "reactive"] },
      ["reactive"],
    );
    expect(v.reasoning).toBe("deterministic ladder → plan-execute-reflect");
  });

  it("stands down when no untried ladder strategy remains", async () => {
    const v = await run(
      { enabled: true },
      ["reactive", "plan-execute-reflect", "reflexion", "tree-of-thought"],
    );
    expect(v).toEqual({
      shouldSwitch: false,
      recommendedStrategy: "",
      reasoning: "no untried ladder strategy remains",
    });
  });
});
