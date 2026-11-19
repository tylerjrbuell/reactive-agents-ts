// Run: bun run repo test apps/cortex/server/tests/strategy-steps.test.ts
/**
 * A chat turn streams its strategy's live phases as ui-core `StepEvent`s, from the run's own
 * `ReasoningStepCompleted` kernelPass labels.
 */
import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { foldStrategyRun, initialStrategyRun, strategyStepFromWire, strategyStatusOf, totTreeOf } from "@reactive-agents/ui-core";
import { recordStrategySteps } from "../services/strategy-steps.js";

const step = (taskId: string, kernelPass: string | undefined, extra: Record<string, unknown> = {}): AgentEvent =>
  ({ _tag: "ReasoningStepCompleted", taskId, strategy: "x", step: 1, totalSteps: 1, ...(kernelPass ? { kernelPass } : {}), ...extra }) as AgentEvent;

async function harness() {
  let emit: (e: AgentEvent) => void = () => {};
  const { log, unsubscribe } = await recordStrategySteps({
    subscribe: async (h) => {
      emit = h;
      return () => {};
    },
  });
  return { log, emit: (e: AgentEvent) => emit(e), unsubscribe };
}

describe("recordStrategySteps", () => {
  it("queues one StepEvent when the pass changes, not for repeats of the same pass", async () => {
    const h = await harness();
    h.emit(step("t1", "reflexion:generate"));
    h.emit(step("t1", "reflexion:generate"));
    h.emit(step("t1", "reflexion:critique-1"));
    const events = h.log.drain();
    expect(events.map((e) => (e.step as { pass: string }).pass)).toEqual(["reflexion:generate", "reflexion:critique-1"]);
    expect(events.every((e) => e._tag === "StepEvent")).toBe(true);
    expect(h.log.drain()).toEqual([]);
    h.unsubscribe();
  });

  it("ignores steps with no label and other runs (sub-agents) once a run is followed", async () => {
    const h = await harness();
    h.emit(step("t1", undefined));
    h.emit(step("t1", "plan-execute:plan-1"));
    h.emit(step("child", "reflexion:generate"));
    expect(h.log.drain().map((e) => (e.step as { pass: string }).pass)).toEqual(["plan-execute:plan-1"]);
  });

  it("beginTurn drops stale steps and follows the next turn's run", async () => {
    const h = await harness();
    h.emit(step("t1", "reflexion:generate"));
    h.log.beginTurn();
    h.emit(step("t2", "code-action:plan"));
    expect(h.log.drain().map((e) => (e.step as { pass: string }).pass)).toEqual(["code-action:plan"]);
  });

  it("each tree-of-thought explore node is queued and folds into a levelled tree", async () => {
    const h = await harness();
    h.emit(step("t1", "tree-of-thought:explore", { thought: "[TOT d=1] score=0.40: a..." }));
    h.emit(step("t1", "tree-of-thought:explore", { thought: "[TOT d=1] score=0.90: b..." }));
    h.emit(step("t1", "tree-of-thought:explore", { thought: "[TOT d=2] score=0.70: c..." }));
    const events = h.log.drain();
    expect(events).toHaveLength(3);
    const run = events.reduce((s, e) => foldStrategyRun(s, strategyStepFromWire(e.step)!), initialStrategyRun);
    expect(totTreeOf(run).map((l) => [l.depth, l.nodes.length])).toEqual([[1, 2], [2, 1]]);
    expect(strategyStatusOf(run)).toBe("Exploring options, level 2");
  });

  it("reads the framework's `structured` payload (tot-node, code-action, reflexion) when it is there", async () => {
    const h = await harness();
    h.emit(step("t1", "tree-of-thought:explore", { structured: { kind: "tot-node", nodeId: "n1", parentId: "root", depth: 2, score: 0.7, pruned: true, selected: false, content: "go left" } }));
    h.emit(step("t1", "tree-of-thought:select", { structured: { kind: "tot-path", nodeIds: ["root", "n1"] } }));
    h.emit(step("t1", "code-action:execute:1", { structured: { kind: "code-action", code: "return 1", stdout: "1", stderr: "warn", verify: { verdict: "pass", summary: "ok" } } }));
    h.emit(step("t1", "reflexion:critique-1", { structured: { kind: "reflexion", critique: "too long", accepted: false } }));
    h.emit(step("t1", "reflexion:improve-1", { structured: { kind: "from-the-future", whatever: 1 } }));
    const [tot, path, code, refl, unknown] = h.log.drain();
    expect(tot!.step).toMatchObject({ node: { id: "n1", parentId: "root", depth: 2, score: 0.7, pruned: true, selected: false } });
    expect(path!.step).toMatchObject({ path: ["root", "n1"] });
    expect(code!.step).toMatchObject({ code: "return 1", stdout: "1", stderr: "warn", verify: { verdict: "pass", summary: "ok" } });
    expect(refl!.step).toMatchObject({ critique: "too long", accepted: false });
    // An unknown kind is ignored: the step still reports its phase.
    expect(unknown!.step).toEqual({ kind: "strategy-step", pass: "reflexion:improve-1" });
  });

  it("richer payload fields ride along when the framework reports them, and are absent otherwise", async () => {
    const h = await harness();
    h.emit(step("t1", "code-action:execute:1", { structured: { kind: "code-action", code: "return 1", stdout: "1" } }));
    h.emit(step("t1", "reflexion:critique-1"));
    const [withCode, plain] = h.log.drain();
    expect(withCode!.step).toMatchObject({ code: "return 1", stdout: "1" });
    expect(plain!.step).not.toHaveProperty("code");
  });
});
