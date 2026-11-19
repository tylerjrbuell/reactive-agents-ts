import { describe, expect, it } from "bun:test";
import {
  adaptiveChoiceLine,
  adaptiveChoiceOf,
  endStrategyRun,
  foldStrategyRun,
  initialStrategyRun,
  planProgressOf,
  planStepBadgesOf,
  planStepEventLine,
  planStepsOf,
  planSummaryOf,
  strategyRunForStorage,
  strategyRunFromStorage,
  strategyStepFromWire,
  strategyStepOf,
  type StrategyRunState,
  type StrategyStepDetail,
} from "../src/index.js";

const fold = (passes: readonly (string | readonly [string, StrategyStepDetail])[]): StrategyRunState =>
  passes.reduce<StrategyRunState>((s, p) => {
    const [pass, d] = typeof p === "string" ? [p, {}] : p;
    return foldStrategyRun(s, strategyStepOf(pass, d)!);
  }, initialStrategyRun);

const roundTrip = (run: StrategyRunState): StrategyRunState | undefined => strategyRunFromStorage(JSON.parse(JSON.stringify(strategyRunForStorage(run))));

const RETRY_THEN_DONE = [
  "plan-execute:plan-1",
  "plan-execute:step-1:start",
  ["plan-execute:step-1:retry-1", { note: "Previous error: timeout" }],
  "plan-execute:step-1:done",
  "plan-execute:step-2:start",
] as const;

describe("plan step history from labels", () => {
  it("a step that retried then finished keeps its history after it settled", () => {
    const run = endStrategyRun(fold(RETRY_THEN_DONE));
    const step = planStepsOf(run).find((s) => s.key === "step-1")!;
    expect(step.status).toBe("done");
    expect(step.events.map((e) => e.kind)).toEqual(["started", "retry", "done"]);
    expect(step.events[1]).toEqual({ kind: "retry", attempt: 2, note: "Previous error: timeout" });
    expect(step.retries).toBe(1);
    expect(planStepBadgesOf(step)).toEqual(["retried once"]);
  });

  it("survives the storage round trip", () => {
    const stored = roundTrip(fold(RETRY_THEN_DONE))!;
    expect(planStepsOf(stored).find((s) => s.key === "step-1")!.events).toEqual(planStepsOf(endStrategyRun(fold(RETRY_THEN_DONE))).find((s) => s.key === "step-1")!.events);
  });

  it("a failure keeps its reason, and a patch after it leaves the step failed and patched", () => {
    const run = fold([
      "plan-execute:step-2:start",
      ["plan-execute:step-2:failed", { note: "[FAILED s2] tool timed out" }],
      ["plan-execute:step-2:patch", { note: "[PATCH] Replaced remaining steps: use web-search" }],
      "plan-execute:step-3:start",
    ]);
    const step = planStepsOf(run).find((s) => s.key === "step-2")!;
    expect(step.status).toBe("failed");
    expect(step.patched).toBe(true);
    expect(step.events.map((e) => planStepEventLine(e))).toEqual(["Started", "Failed: [FAILED s2] tool timed out", "Patched: [PATCH] Replaced remaining steps: use web-search"]);
    expect(planStepBadgesOf(step)).toEqual(["patched", "failed"]);
    const stored = roundTrip(run)!;
    expect(planStepsOf(stored).find((s) => s.key === "step-2")!.events).toHaveLength(3);
  });

  it("a plan-level reflect label is not attributed to a step", () => {
    const run = fold(["plan-execute:step-1:start", "plan-execute:reflect-1"]);
    expect(planStepsOf(run)[0]!.events.map((e) => e.kind)).toEqual(["started"]);
  });

  it("the chip counts per-step retries and patches", () => {
    const run = fold([
      "plan-execute:step-1:start",
      "plan-execute:step-1:retry-1",
      "plan-execute:step-1:retry-2",
      "plan-execute:step-1:done",
      "plan-execute:step-2:start",
      "plan-execute:step-2:failed",
      "plan-execute:step-2:patch",
    ]);
    expect(planProgressOf(run)).toMatchObject({ steps: 2, retries: 2, patched: 1, failed: 1 });
    expect(planSummaryOf(run)).toBe("2 steps, 1 failed, 2 retries, 1 patched");
  });

  it("caps history on storage, newest kept", () => {
    const passes = ["plan-execute:step-1:start", ...Array.from({ length: 30 }, (_, i) => `plan-execute:step-1:retry-${i + 1}`)];
    const stored = strategyRunForStorage(fold(passes))!;
    const events = stored.rows.find((r) => r.key === "step-1")!.history!;
    expect(events).toHaveLength(12);
    expect(events.at(-1)).toEqual({ kind: "retry", attempt: 31 });
  });

  it("drops malformed stored history events instead of throwing", () => {
    const stored = strategyRunForStorage(fold(RETRY_THEN_DONE))!;
    const raw = JSON.parse(JSON.stringify(stored));
    raw.rows.find((r: { key: string }) => r.key === "step-1").history.push({ kind: "bogus" }, 7);
    expect(planStepsOf(strategyRunFromStorage(raw)!).find((s) => s.key === "step-1")!.events).toHaveLength(3);
  });
});

describe("structured plan-step payload", () => {
  it("is read from the wire and wins over the label", () => {
    const step = strategyStepFromWire({ kind: "strategy-step", pass: "blueprint:step-1:start", planStep: { stepIndex: 0, status: "retry", attempt: 2, note: "bad args" } })!;
    expect(step.planStep).toEqual({ stepIndex: 0, status: "retry", attempt: 2, note: "bad args" });
    const run = foldStrategyRun(initialStrategyRun, step);
    expect(planStepsOf(run)[0]!.events).toEqual([{ kind: "retry", attempt: 2, note: "bad args" }]);
  });

  it("a payload on another phase lands on step stepIndex + 1 (reflected)", () => {
    const run = fold([
      "plan-execute:step-3:start",
      ["plan-execute:reflect-1", { planStep: { stepIndex: 2, status: "reflected", note: "step 3 needs a source" } }],
    ]);
    expect(planStepsOf(run).find((s) => s.key === "step-3")!.events.map((e) => e.kind)).toEqual(["started", "reflected"]);
  });

  it("a plan-level degrade payload (stepIndex 0, failed) is not step 1's failure", () => {
    const run = fold(["blueprint:step-1:start", ["blueprint:degrade", { planStep: { stepIndex: 0, status: "failed", note: "plan invalid" } }]]);
    expect(planStepsOf(run)[0]!.events.map((e) => e.kind)).toEqual(["started"]);
  });

  it("words a retry by the attempt about to run", () => {
    expect(planStepEventLine({ kind: "retry", attempt: 2, note: "bad args" })).toBe("Retry, attempt 2: bad args");
  });

  it("ignores a malformed payload (unknown status, missing index) and falls back to the label", () => {
    const bad = strategyStepFromWire({ kind: "strategy-step", pass: "plan-execute:step-1:done", planStep: { stepIndex: 0, status: "exploded" } })!;
    expect(bad.planStep).toBeUndefined();
    expect(planStepsOf(foldStrategyRun(initialStrategyRun, bad))[0]!.events.map((e) => e.kind)).toEqual(["done"]);
  });
});

describe("adaptive: structured choice first, narration regex second", () => {
  it("reads strategy-choice and words it with the known reason", () => {
    const step = strategyStepFromWire({ kind: "strategy-step", pass: "adaptive:select", choice: { selected: "reflexion", reason: "classifier" } })!;
    const choice = adaptiveChoiceOf(foldStrategyRun(initialStrategyRun, step))!;
    expect(choice).toEqual({ chosen: "reflexion", how: "classifier" });
    expect(adaptiveChoiceLine(choice)).toBe("chose Reflexion (by classifier)");
  });

  it("the structured pick beats a contradicting narration", () => {
    const run = fold([["adaptive:heuristic", { note: "[ADAPTIVE] Heuristic: blueprint", choice: { selected: "reactive", reason: "heuristic" } }]]);
    expect(adaptiveChoiceOf(run)).toEqual({ chosen: "reactive", how: "heuristic" });
  });

  it("a cost downgrade names the strategy it replaced", () => {
    const run = fold([
      ["adaptive:select", { choice: { selected: "tree-of-thought", reason: "classifier" } }],
      ["adaptive:cost-downgrade", { choice: { selected: "reactive", reason: "cost-downgrade" } }],
    ]);
    expect(adaptiveChoiceOf(run)).toEqual({ chosen: "reactive", how: "cheaper", from: "tree-of-thought" });
  });

  it("cost-downgrade selected is the new strategy; `from` comes from the note", () => {
    const run = fold([["adaptive:cost-downgrade", { choice: { selected: "reactive", reason: "cost-downgrade", note: "from tree-of-thought: over budget" } }]]);
    expect(adaptiveChoiceOf(run)).toEqual({ chosen: "reactive", how: "cheaper", from: "tree-of-thought" });
  });

  it("free-text reasons are shown as written; the regex still works when no payload exists", () => {
    const free = fold([["adaptive:select", { choice: { selected: "blueprint", reason: "the task lists three dependent steps" } }]]);
    expect(adaptiveChoiceLine(adaptiveChoiceOf(free)!)).toBe("chose Blueprint (the task lists three dependent steps)");
    expect(adaptiveChoiceOf(fold([["adaptive:select", { note: "[ADAPTIVE] Selected strategy: reflexion" }]]))).toEqual({ chosen: "reflexion", how: "classifier" });
  });

  it("the structured choice survives storage", () => {
    const run = fold([["adaptive:select", { choice: { selected: "reflexion", reason: "explicit" } }]]);
    expect(adaptiveChoiceOf(roundTrip(run)!)).toEqual({ chosen: "reflexion", how: "explicit" });
  });
});
