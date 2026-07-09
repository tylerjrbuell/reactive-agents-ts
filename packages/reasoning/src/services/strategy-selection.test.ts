// File: src/services/strategy-selection.test.ts
//
// Phase 7 (Strategy→Policy) — the dispatch-time strategy selection is a PURE
// compile from (model tier, task classification incl. horizon) → plan.strategy,
// mapped to the registry's ReasoningStrategy id. These tests pin the four
// acceptance criteria: default-off byte-identical, adaptive-harness plan-drive,
// explicit-wins, and config.adaptive.enabled unchanged.

import { describe, expect, it } from "bun:test";
import { compileHarnessPlan, type PlanStrategy } from "../kernel/policy/harness-plan.js";
import { classifyTask } from "../kernel/capabilities/comprehend/task-classification.js";
import {
  PLAN_TO_REGISTRY,
  selectStrategyName,
  type StrategySelectionParams,
} from "./strategy-selection.js";
import type { ReasoningStrategy } from "../types/index.js";

const LONG_RESEARCH_TASK =
  "This is a long-horizon research task: investigate the market landscape, synthesize findings, and produce a comprehensive report with citations.";
const TRIVIAL_TASK = "What is 2 + 2?";

// The exact CURRENT selection expression, replicated verbatim as the oracle for
// the byte-identical pin.
function currentExpression(
  params: StrategySelectionParams,
  config: { adaptive: { enabled: boolean }; defaultStrategy: ReasoningStrategy },
): ReasoningStrategy {
  return config.adaptive.enabled ? "adaptive" : (params.strategy ?? config.defaultStrategy);
}

describe("PLAN_TO_REGISTRY mapping", () => {
  it("maps plan-execute to the registry id plan-execute-reflect", () => {
    expect(PLAN_TO_REGISTRY["plan-execute"]).toBe("plan-execute-reflect");
  });

  it("is identity for every other plan strategy", () => {
    const identity: PlanStrategy[] = [
      "direct",
      "reactive",
      "reflexion",
      "blueprint",
      "tree-of-thought",
      "code-action",
      "adaptive",
    ];
    for (const s of identity) {
      expect(PLAN_TO_REGISTRY[s]).toBe(s as ReasoningStrategy);
    }
  });

  it("every mapped value is a valid registered strategy id", () => {
    const valid: ReadonlySet<ReasoningStrategy> = new Set<ReasoningStrategy>([
      "reactive",
      "plan-execute-reflect",
      "tree-of-thought",
      "reflexion",
      "adaptive",
      "direct",
      "code-action",
      "blueprint",
    ]);
    for (const value of Object.values(PLAN_TO_REGISTRY)) {
      expect(valid.has(value)).toBe(true);
    }
  });
});

describe("selectStrategyName — default path (adaptiveHarness OFF) is byte-identical", () => {
  const config = { adaptive: { enabled: false }, defaultStrategy: "reactive" as const };

  it("no explicit strategy → config.defaultStrategy (== current expression)", () => {
    const params = { taskDescription: LONG_RESEARCH_TASK };
    expect(selectStrategyName(params, config)).toBe(currentExpression(params, config));
    expect(selectStrategyName(params, config)).toBe("reactive");
  });

  it("explicit strategy → params.strategy (== current expression)", () => {
    const params = { taskDescription: TRIVIAL_TASK, strategy: "code-action" as const };
    expect(selectStrategyName(params, config)).toBe(currentExpression(params, config));
    expect(selectStrategyName(params, config)).toBe("code-action");
  });

  it("adaptiveHarness undefined behaves exactly like OFF", () => {
    const params = { taskDescription: LONG_RESEARCH_TASK, adaptiveHarness: undefined };
    expect(selectStrategyName(params, config)).toBe(currentExpression(params, config));
  });
});

describe("selectStrategyName — config.adaptive.enabled is unchanged (pin)", () => {
  const config = { adaptive: { enabled: true }, defaultStrategy: "reactive" as const };

  it("routes to adaptive regardless of adaptiveHarness", () => {
    expect(
      selectStrategyName({ taskDescription: LONG_RESEARCH_TASK, adaptiveHarness: true }, config),
    ).toBe("adaptive");
  });

  it("adaptive.enabled wins over an explicit params.strategy (matches current)", () => {
    const params = { taskDescription: TRIVIAL_TASK, strategy: "direct" as const };
    expect(selectStrategyName(params, config)).toBe(currentExpression(params, config));
    expect(selectStrategyName(params, config)).toBe("adaptive");
  });
});

describe("selectStrategyName — adaptiveHarness ON drives strategy from the compiled plan", () => {
  const config = { adaptive: { enabled: false }, defaultStrategy: "reactive" as const };

  it("long-horizon research task → plan-execute → plan-execute-reflect", () => {
    const params = { taskDescription: LONG_RESEARCH_TASK, adaptiveHarness: true };
    const classification = classifyTask(LONG_RESEARCH_TASK);
    const planStrategy = compileHarnessPlan({
      capability: { tier: "mid" as const },
      horizon: classification.horizon.horizon,
      classification,
    }).strategy;
    expect(planStrategy).toBe("plan-execute");
    expect(selectStrategyName(params, config)).toBe("plan-execute-reflect");
  });

  it("trivial task → direct", () => {
    const params = { taskDescription: TRIVIAL_TASK, adaptiveHarness: true };
    const classification = classifyTask(TRIVIAL_TASK);
    const planStrategy = compileHarnessPlan({
      capability: { tier: "mid" as const },
      horizon: classification.horizon.horizon,
      classification,
    }).strategy;
    expect(planStrategy).toBe("direct");
    expect(selectStrategyName(params, config)).toBe("direct");
  });

  it("selected strategy == the mapped compiled plan.strategy", () => {
    const params = { taskDescription: LONG_RESEARCH_TASK, adaptiveHarness: true };
    const classification = classifyTask(params.taskDescription);
    const planStrategy = compileHarnessPlan({
      capability: { tier: "mid" as const },
      horizon: classification.horizon.horizon,
      classification,
    }).strategy;
    expect(selectStrategyName(params, config)).toBe(PLAN_TO_REGISTRY[planStrategy]);
  });

  it("explicit params.strategy STILL overrides the plan (wither wins)", () => {
    const params = {
      taskDescription: LONG_RESEARCH_TASK,
      adaptiveHarness: true,
      strategy: "tree-of-thought" as const,
    };
    expect(selectStrategyName(params, config)).toBe("tree-of-thought");
  });

  it("uses a provided taskClassification snapshot when present", () => {
    const classification = classifyTask(TRIVIAL_TASK);
    const params = {
      taskDescription: "unrelated string",
      adaptiveHarness: true,
      taskClassification: classification,
    };
    // Classification snapshot (trivial) drives the plan, not the taskDescription.
    expect(selectStrategyName(params, config)).toBe("direct");
  });
});
