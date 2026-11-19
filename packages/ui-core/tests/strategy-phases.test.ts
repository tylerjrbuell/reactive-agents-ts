import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STRATEGY_PHASES,
  attemptsOf,
  endStrategyRun,
  foldStrategyRun,
  initialStrategyRun,
  phaseIdOf,
  strategyApprovalConflictOf,
  strategyConflictLineOf,
  strategyPhasesOf,
  strategyStatusOf,
  strategyStepFromWire,
  strategyStepOf,
  totNodeOfThought,
  totTreeOf,
  totForestOf,
  totHasEdges,
  approvalGateOf,
  type StrategyRunState,
} from "../src/index.js";

const fold = (passes: readonly string[], details: Record<number, Parameters<typeof strategyStepOf>[1]> = {}): StrategyRunState =>
  passes.reduce((s, p, i) => foldStrategyRun(s, strategyStepOf(p, details[i])!), initialStrategyRun);

describe("phase table", () => {
  it("covers every strategy the registry registers (a new strategy fails until mapped)", () => {
    const src = readFileSync(join(import.meta.dir, "../../reasoning/src/services/strategy-registry.ts"), "utf8");
    const names = [...src.matchAll(/^\s*\["([a-z-]+)",\s*(?:asStrategyFn\()?execute\w+/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const name of names) expect(Object.keys(STRATEGY_PHASES)).toContain(name);
  });

  it("every phased strategy names its own label prefix", () => {
    for (const spec of Object.values(STRATEGY_PHASES)) expect(spec.pass.length).toBeGreaterThan(0);
    expect(strategyPhasesOf("plan-execute-reflect").map((p) => p.id)).toContain("synthesize");
    expect(strategyPhasesOf("nope")).toEqual([]);
  });
});

describe("label grammar", () => {
  it("parses phase, number and sub-label", () => {
    expect(strategyStepOf("reflexion:critique-2")).toMatchObject({ strategy: "reflexion", phase: "critique", n: 2 });
    expect(strategyStepOf("plan-execute:step-3:done")).toMatchObject({ strategy: "plan-execute", phase: "step", n: 3, sub: "done" });
    expect(strategyStepOf("plan-execute:step-3:retry-1")).toMatchObject({ phase: "step", n: 3, sub: "retry-1" });
    expect(strategyStepOf("code-action:execute:2")).toMatchObject({ phase: "execute", n: 2 });
    expect(strategyStepOf("tree-of-thought:explore")).toMatchObject({ phase: "explore" });
    expect(strategyStepOf("tree-of-thought:bfs-skipped")).toMatchObject({ phase: "bfs-skipped" });
    expect(strategyStepOf("")).toBeUndefined();
    expect(phaseIdOf("blueprint:step-4:start")).toBe("step");
  });

  it("reads wire steps defensively", () => {
    expect(strategyStepFromWire({ kind: "strategy-step", pass: "reflexion:critique-1", critique: "too long", code: 5 })).toMatchObject({ phase: "critique", critique: "too long" });
    expect(strategyStepFromWire({ kind: "strategy-step", pass: "reflexion:critique-1", code: 5 })?.code).toBeUndefined();
    expect(strategyStepFromWire({ pass: "x:y" })).toBeUndefined();
    expect(strategyStepFromWire(null)).toBeUndefined();
    const node = strategyStepFromWire({ kind: "strategy-step", pass: "tree-of-thought:explore", node: { id: "a", depth: 2, score: 0.5, parentId: "r" } });
    expect(node?.node).toEqual({ id: "a", depth: 2, score: 0.5, parentId: "r" });
  });
});

describe("fold", () => {
  it("a new phase settles the previous row; the current one runs", () => {
    const s = fold(["reflexion:generate", "reflexion:critique-1", "reflexion:improve-1"]);
    expect(s.rows.map((r) => [r.key, r.status])).toEqual([["generate", "done"], ["critique-1", "done"], ["improve-1", "running"]]);
    expect(s.label).toBe("Reflexion");
    expect(strategyStatusOf(s)).toBe("Improving 1");
    expect(attemptsOf(s).map((a) => a.n)).toEqual([0, 1]);
  });

  it("a plan step goes running, done or failed in place", () => {
    const s = fold(["plan-execute:plan-1", "plan-execute:step-1:start", "plan-execute:step-1:failed", "plan-execute:step-1:retry-1"]);
    expect(s.rows.find((r) => r.key === "step-1")).toMatchObject({ status: "running", sub: "retry-1" });
    expect(s.rows).toHaveLength(2);
    expect(strategyStatusOf(fold(["plan-execute:step-2:start"]))).toBe("Running a step 2");
  });

  it("ending settles every row and clears the status line", () => {
    const s = endStrategyRun(fold(["code-action:plan", "code-action:execute:1"]));
    expect(s.rows.every((r) => r.status === "done")).toBe(true);
    expect(strategyStatusOf(s)).toBeUndefined();
  });

  it("a phase-less strategy leaves the status line to the caller; an unknown one degrades to a generic stepper", () => {
    expect(strategyStatusOf(fold(["reactive:think"]))).toBeUndefined();
    const g = fold(["mystery:warm-up-2"]);
    expect(g.label).toBe("Mystery");
    expect(strategyStatusOf(g)).toBe("Warm up 2");
  });

  it("code and stdout ride on their row when reported, and are simply absent when not", () => {
    const s = fold(["code-action:execute:1"], { 0: { code: "return 1", stdout: "1" } });
    expect(s.rows[0]).toMatchObject({ code: "return 1", stdout: "1" });
    expect(fold(["code-action:execute:1"]).rows[0]!.code).toBeUndefined();
  });
});

describe("tree of thought", () => {
  it("groups nodes by level, marks the best, and names the level on the status line", () => {
    const nodes = [
      totNodeOfThought("[TOT d=1] score=0.40: a...", 0)!,
      totNodeOfThought("[TOT d=1] score=0.90: b...", 1)!,
      totNodeOfThought("[TOT d=2] score=0.60: c...", 2)!,
    ];
    const s = nodes.reduce((st, node) => foldStrategyRun(st, strategyStepOf("tree-of-thought:explore", { node })!), initialStrategyRun);
    const tree = totTreeOf(s);
    expect(tree.map((l) => l.depth)).toEqual([1, 2]);
    expect(tree[0]!.nodes.find((n) => n.best)?.content).toBe("b");
    expect(tree[0]!.best).toBe(0.9);
    expect(strategyStatusOf(s)).toBe("Exploring options, level 2");
  });

  it("explore steps without node data keep an empty tree, never throw", () => {
    const s = fold(["tree-of-thought:explore"]);
    expect(totTreeOf(s)).toEqual([]);
    expect(strategyStatusOf(s)).toBe("Exploring options");
    expect(totNodeOfThought("plain text", 0)).toBeUndefined();
  });
});

describe("tree of thought with structured nodes", () => {
  const node = (id: string, parentId: string | null, depth: number, score: number, extra: object = {}) =>
    strategyStepFromWire({ kind: "strategy-step", pass: "tree-of-thought:explore", node: { nodeId: id, parentId, depth, score, content: id, ...extra } })!;
  const run = (steps: ReturnType<typeof node>[], path?: string[]) => {
    const all = path ? [...steps, strategyStepFromWire({ kind: "strategy-step", pass: "tree-of-thought:select", path })!] : steps;
    return all.reduce(foldStrategyRun, initialStrategyRun);
  };

  it("nests children under parents, with the reported path marked", () => {
    const s = run([node("root", null, 0, 0.5), node("a", "root", 1, 0.9), node("b", "root", 1, 0.2, { pruned: true }), node("c", "a", 2, 0.8)], ["root", "a", "c"]);
    const forest = totForestOf(s);
    expect(forest).toHaveLength(1);
    expect(forest[0]!.children.map((c) => [c.node.id, c.onPath, c.node.pruned])).toEqual([["a", true, undefined], ["b", false, true]]);
    expect(forest[0]!.children[0]!.children[0]!.node.id).toBe("c");
    expect(totHasEdges(s)).toBe(true);
    expect(s.path).toEqual(["root", "a", "c"]);
  });

  it("a later report of the same node supersedes the earlier one (selected re-emit)", () => {
    const s = run([node("a", null, 0, 0.4), node("a", null, 0, 0.4, { selected: true })]);
    expect(s.nodes).toHaveLength(1);
    expect(totForestOf(s)[0]!.onPath).toBe(true);
  });

  it("flat nodes with no parents are all roots, and the select phase reads plainly", () => {
    const s = run([node("a", null, 1, 0.4)].map((n) => ({ ...n, node: { ...n.node!, parentId: undefined } })));
    expect(totHasEdges(s)).toBe(false);
    expect(strategyStatusOf(foldStrategyRun(s, strategyStepOf("tree-of-thought:select")!))).toBe("Choosing the best path");
  });

  it("code-action and reflexion payload fields fold onto their rows", () => {
    const s = fold(["code-action:execute:1", "reflexion:critique-1"], {
      0: { code: "x", stderr: "boom", verify: { verdict: "fail", summary: "no output" } },
      1: { critique: "ok", accepted: true },
    });
    expect(s.rows[0]).toMatchObject({ stderr: "boom", verify: { verdict: "fail" } });
    expect(s.rows[1]).toMatchObject({ critique: "ok", accepted: true });
  });
});

describe("approval conflict", () => {
  it("code-action with the default gate is caught, offering both ways out", () => {
    const c = strategyApprovalConflictOf({ strategy: "code-action", gate: "default" });
    expect(c?.message).toContain("approval gate");
    expect(c?.resolutions.map((r) => r.id)).toEqual(["switch-strategy", "turn-off-approvals"]);
  });

  it("an explicit policy is never dropped by a resolution: only the strategy switch is offered", () => {
    const c = strategyApprovalConflictOf({ strategy: "code-action", gate: "explicit" });
    expect(c?.resolutions.map((r) => r.id)).toEqual(["switch-strategy"]);
  });

  it("no conflict for other strategies or an ungated agent", () => {
    expect(strategyApprovalConflictOf({ strategy: "reactive", gate: "default" })).toBeUndefined();
    expect(strategyApprovalConflictOf({ strategy: "code-action", gate: "none" })).toBeUndefined();
    expect(strategyApprovalConflictOf({ gate: "default" })).toBeUndefined();
  });

  it("gate is read from the config fields", () => {
    expect(approvalGateOf({ hasExplicitPolicy: true })).toBe("explicit");
    expect(approvalGateOf({ hasExplicitPolicy: false, askBeforeRiskyTools: false })).toBe("none");
    expect(approvalGateOf({ hasExplicitPolicy: false })).toBe("default");
  });

  it("the framework's own refusal text maps to the same plain line", () => {
    const framework = 'code-action cannot honor .withApprovalPolicy({ mode: "detach" }): its tool calls run inside the sandbox worker';
    expect(strategyConflictLineOf(framework)).toContain("Code Action cannot run with an approval gate");
    expect(strategyConflictLineOf("something else")).toBeUndefined();
  });
});
