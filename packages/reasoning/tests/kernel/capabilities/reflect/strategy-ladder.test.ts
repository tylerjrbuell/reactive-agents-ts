// Run: bun test packages/reasoning/tests/kernel/capabilities/reflect/strategy-ladder.test.ts --timeout 15000
//
// W4.5 — deterministic strategy escalation. The default switch path walks a
// fixed ladder (reactive → plan-execute-reflect → reflexion) with ZERO extra LLM
// call; the LLM strategy-evaluator runs ONLY for multi-candidate configs. The
// handoff reason carries the ACTUAL loop-pattern id.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../../src/kernel/loop/runner.js";
import { transitionState, type KernelState, type ThoughtKernel } from "../../../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import {
  DEFAULT_STRATEGY_LADDER,
  KERNEL_STRATEGY_CANDIDATES,
  isDefaultCandidateSet,
  selectLadderStrategy,
} from "../../../../src/kernel/capabilities/reflect/strategy-ladder.js";
import { entriesOfKind } from "../../../../src/kernel/ledger/run-ledger.js";

const testLayer = TestLLMServiceLayer();

const REPEATED = JSON.stringify({ tool: "web-search", input: '{"query":"loop"}' });

/** Repeats the SAME action every iteration → trips pattern (a) at threshold 3. */
function makeRepeatingActionKernel(): ThoughtKernel {
  return (state: KernelState) =>
    Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: state.iteration + 1,
        steps: [...state.steps, makeStep("action", REPEATED)],
      }),
    );
}

const runSwitch = (switchCfg: {
  enabled: boolean;
  maxSwitches?: number;
  availableStrategies?: readonly string[];
}, llmLayer = testLayer) =>
  Effect.runPromise(
    runKernel(makeRepeatingActionKernel(), { task: "switch test" }, {
      maxIterations: 20,
      strategy: "reactive",
      kernelType: "react",
      loopDetection: { maxSameToolCalls: 3 },
      strategySwitching: switchCfg,
    }).pipe(Effect.provide(llmLayer)),
  );

describe("W4.5 — strategy ladder (unit)", () => {
  it("candidates are the real registered kernel strategies and non-empty", () => {
    expect(KERNEL_STRATEGY_CANDIDATES.length).toBeGreaterThan(0);
    for (const s of DEFAULT_STRATEGY_LADDER) expect(KERNEL_STRATEGY_CANDIDATES).toContain(s);
  });

  it("selectLadderStrategy walks reactive → plan-execute-reflect → reflexion", () => {
    expect(selectLadderStrategy(["reactive"], KERNEL_STRATEGY_CANDIDATES)).toBe("plan-execute-reflect");
    expect(selectLadderStrategy(["reactive", "plan-execute-reflect"], KERNEL_STRATEGY_CANDIDATES)).toBe("reflexion");
    expect(selectLadderStrategy(["reactive", "plan-execute-reflect", "reflexion"], KERNEL_STRATEGY_CANDIDATES)).toBe("tree-of-thought");
  });

  it("isDefaultCandidateSet distinguishes the canonical set from a custom one", () => {
    expect(isDefaultCandidateSet(KERNEL_STRATEGY_CANDIDATES)).toBe(true);
    expect(isDefaultCandidateSet(["reflexion", "tree-of-thought"])).toBe(false);
  });
});

describe("W4.5 — default switch is the ladder (ZERO extra LLM call)", () => {
  // A scripted evaluator that WOULD recommend `reflexion` if it ran. The default
  // ladder must ignore it (→ plan-execute-reflect); the multi-candidate path must
  // honor it (→ reflexion). The OUTCOME distinguishes the two paths.
  const evaluatorScript = TestLLMServiceLayer([
    { match: "Should we switch reasoning strategy", text: '{"shouldSwitch":true,"recommendedStrategy":"reflexion","reasoning":"custom pick"}' },
  ]);

  it("switches to plan-execute-reflect (the ladder), NOT the evaluator's pick (zero LLM)", async () => {
    const result = await runSwitch(
      { enabled: true, maxSwitches: 1, availableStrategies: KERNEL_STRATEGY_CANDIDATES },
      evaluatorScript,
    );
    // The ladder ran → plan-execute-reflect. Had the evaluator run, the scripted
    // recommendation (`reflexion`) would have won.
    expect(result.strategy).toBe("plan-execute-reflect");
    expect(result.llmCalls).toBe(0);
  }, 15000);

  it("handoff reason carries the ACTUAL pattern id (pattern=a)", async () => {
    const result = await runSwitch({ enabled: true, maxSwitches: 1, availableStrategies: KERNEL_STRATEGY_CANDIDATES });
    const handoffs = entriesOfKind(result.ledger ?? [], "handoff");
    expect(handoffs.length).toBeGreaterThan(0);
    expect(handoffs[0]!.summary).toContain("pattern=a");
    expect(handoffs[0]!.summary).toContain("repeated-tool-call");
  }, 15000);

  it("multi-candidate config STILL evaluates with the LLM (honors its pick)", async () => {
    const result = await runSwitch(
      { enabled: true, maxSwitches: 1, availableStrategies: ["reflexion", "tree-of-thought"] },
      evaluatorScript,
    );
    // The evaluator ran and its scripted pick won.
    expect(result.strategy).toBe("reflexion");
  }, 15000);
});
