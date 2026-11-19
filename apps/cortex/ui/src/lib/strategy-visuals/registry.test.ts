import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  endStrategyRun,
  foldStrategyRun,
  initialStrategyRun,
  strategyStatusOf,
  strategyStepOf,
  strategyStepFromWire,
  type StrategyRunState,
  type StrategyStepDetail,
} from "@reactive-agents/ui-core";
import { renderComponent } from "../components/kit/test-render.js";
import { strategyCardModel, strategyVisualOf } from "./registry.js";

const fold = (passes: readonly string[], detail: Record<number, StrategyStepDetail> = {}): StrategyRunState =>
  passes.reduce((s, p, i) => foldStrategyRun(s, strategyStepOf(p, detail[i])!), initialStrategyRun);
const card = (run: StrategyRunState, hasPlan = false) => strategyCardModel(run, { statusLine: strategyStatusOf(run), hasPlan });

describe("strategy visual registry", () => {
  it("every phased strategy has a view; an unknown strategy falls back to the stepper", () => {
    expect(strategyVisualOf("tree-of-thought").kind).toBe("tree");
    expect(strategyVisualOf("reflexion")).toEqual({ kind: "attempts", noun: "Round" });
    expect(strategyVisualOf("code-action")).toEqual({ kind: "attempts", noun: "Attempt" });
    expect(strategyVisualOf("plan-execute-reflect").kind).toBe("plan");
    expect(strategyVisualOf("rewoo").kind).toBe("plan");
    expect(strategyVisualOf("brand-new").kind).toBe("stepper");
    expect(strategyVisualOf(undefined).kind).toBe("stepper");
  });
});

describe("strategy card model", () => {
  it("is open and shows the phase while running, then collapses to a summary", () => {
    const run = fold(["reflexion:generate", "reflexion:critique-1", "reflexion:improve-1"]);
    expect(card(run)).toMatchObject({ show: true, title: "Reflexion", chip: "Improving 1", openByDefault: true });
    expect(card(endStrategyRun(run))).toMatchObject({ chip: "1 round", openByDefault: false });
  });

  it("tree of thought summarises levels and the best score", () => {
    const nodes = [
      { id: "a", depth: 1, score: 0.4 },
      { id: "b", depth: 2, score: 0.9 },
    ];
    const run = endStrategyRun(nodes.reduce((s, node) => foldStrategyRun(s, strategyStepOf("tree-of-thought:explore", { node })!), initialStrategyRun));
    expect(card(run).chip).toBe("2 levels, best 0.90");
  });

  it("a plan strategy adds no card while the goal-checks card draws its plan", () => {
    const run = fold(["plan-execute:plan-1", "plan-execute:step-1:start"]);
    expect(card(run, true).show).toBe(false);
    expect(card(run, false).show).toBe(true);
  });

  it("a failed phase keeps the finished card open, and no steps draws nothing", () => {
    const run = endStrategyRun(fold(["plan-execute:step-1:start", "plan-execute:step-1:failed"]));
    expect(card(run).openByDefault).toBe(true);
    expect(card(initialStrategyRun).show).toBe(false);
  });
});

describe("StrategyCard render", () => {
  const file = join(import.meta.dir, "../components/strategy/StrategyCard.svelte");

  it("a running reflexion draws its rounds with the critique when reported", async () => {
    const run = fold(["reflexion:generate", "reflexion:critique-1"], { 1: { critique: "Too long" } });
    const html = await renderComponent(file, { run });
    expect(html).toContain('data-testid="strategy-card"');
    expect(html).toContain("Round 1");
    expect(html).toContain("Too long");
  });

  it("a tree of thought draws levels with its best node marked", async () => {
    const run = [
      { id: "a", depth: 1, score: 0.4, content: "left" },
      { id: "b", depth: 1, score: 0.9, content: "right" },
    ].reduce((s, node) => foldStrategyRun(s, strategyStepOf("tree-of-thought:explore", { node })!), initialStrategyRun);
    const html = await renderComponent(file, { run });
    expect(html).toContain("Level 1");
    expect(html).toContain("right");
    expect(html).toContain("best");
  });

  it("a tree with parent links draws nested nodes: pruned dimmed, the selected path marked", async () => {
    const wire = (n: object) => strategyStepFromWire({ kind: "strategy-step", pass: "tree-of-thought:explore", node: n })!;
    const steps = [
      wire({ nodeId: "r", parentId: null, depth: 0, score: 0.5, content: "root idea" }),
      wire({ nodeId: "a", parentId: "r", depth: 1, score: 0.9, content: "good", selected: true }),
      wire({ nodeId: "b", parentId: "r", depth: 1, score: 0.1, content: "weak", pruned: true }),
    ];
    const run = steps.reduce(foldStrategyRun, initialStrategyRun);
    const html = await renderComponent(file, { run });
    expect(html).toContain('data-testid="tot-tree"');
    expect(html).toContain('data-pruned="true"');
    expect(html).toContain("selected");
    expect(html).toContain("pruned");
  });

  it("code-action shows stderr and the verify verdict; reflexion shows whether the critique was satisfied", async () => {
    const code = await renderComponent(file, { run: fold(["code-action:execute:1"], { 0: { code: "x", stderr: "boom", verify: { verdict: "fail", summary: "no output" } } }) });
    expect(code).toContain('data-testid="strategy-stderr"');
    expect(code).toContain("no output");
    const refl = await renderComponent(file, { run: fold(["reflexion:critique-1"], { 0: { critique: "Looks right", accepted: true } }) });
    expect(refl).toContain("Satisfied");
  });

  it("code-action shows code and sandbox output when present, and degrades to phases when not", async () => {
    const withCode = await renderComponent(file, { run: fold(["code-action:execute:1"], { 0: { code: "return 42", stdout: "42" } }) });
    expect(withCode).toContain('data-testid="strategy-code"');
    expect(withCode).toContain("return 42");
    const bare = await renderComponent(file, { run: fold(["code-action:plan", "code-action:execute:1"]) });
    expect(bare).not.toContain('data-testid="strategy-code"');
    expect(bare).toContain("Running code");
  });

  it("an unknown strategy still draws a generic phase stepper", async () => {
    const html = await renderComponent(file, { run: fold(["mystery:warm-up"]) });
    expect(html).toContain("Mystery");
    expect(html).toContain("Warm up");
  });

  it("draws nothing with no steps, or when the plan card already shows the plan", async () => {
    expect(await renderComponent(file, { run: initialStrategyRun })).not.toContain("strategy-card");
    expect(await renderComponent(file, { run: fold(["blueprint:plan"]), hasPlan: true })).not.toContain("strategy-card");
  });
});

describe("StrategyConflictNote render", () => {
  const file = join(import.meta.dir, "../components/strategy/StrategyConflictNote.svelte");
  it("shows the message and one button per resolution, nothing when there is no conflict", async () => {
    const conflict = {
      strategy: "code-action",
      message: "Code Action cannot ask before risky tools.",
      gatedTools: ["file-write"],
      resolutions: [
        { id: "switch-strategy" as const, label: "Use the reactive strategy", patch: { strategy: "reactive" } },
        { id: "turn-off-approvals" as const, label: "Turn off approvals for risky tools", patch: { askBeforeRiskyTools: false as const } },
      ],
    };
    const html = await renderComponent(file, { conflict, onResolve: () => {} });
    expect(html).toContain("cannot ask before risky tools");
    expect(html).toContain("conflict-switch-strategy");
    expect(html).toContain("conflict-turn-off-approvals");
    expect(await renderComponent(file, { conflict: undefined, onResolve: () => {} })).not.toContain("strategy-conflict");
  });
});
