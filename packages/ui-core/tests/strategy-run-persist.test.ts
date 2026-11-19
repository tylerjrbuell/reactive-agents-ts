import { describe, expect, it } from "bun:test";
import {
  foldStrategyRun,
  initialStrategyRun,
  strategyRunForStorage,
  strategyRunFromStorage,
  strategyStepOf,
  type StrategyRunState,
} from "../src/index.js";

const fold = (steps: ReadonlyArray<readonly [string, Parameters<typeof strategyStepOf>[1]?]>): StrategyRunState =>
  steps.reduce((s, [p, d]) => foldStrategyRun(s, strategyStepOf(p, d)!), initialStrategyRun);

describe("strategy run storage", () => {
  it("a run that reported nothing stores nothing", () => {
    expect(strategyRunForStorage(initialStrategyRun)).toBeUndefined();
  });

  it("round-trips a reflexion run: settled, critique and acceptance kept", () => {
    const run = fold([["reflexion:generate"], ["reflexion:critique-1", { critique: "too long", accepted: true }]]);
    const stored = strategyRunForStorage(run)!;
    expect(stored.ended).toBe(true);
    expect(stored.rows.every((r) => r.status === "done")).toBe(true);
    const back = strategyRunFromStorage(JSON.parse(JSON.stringify(stored)))!;
    expect(back.label).toBe("Reflexion");
    expect(back.rows.map((r) => r.key)).toEqual(["generate", "critique-1"]);
    expect(back.rows[1]!.critique).toBe("too long");
    expect(back.rows[1]!.accepted).toBe(true);
    expect(back.current?.pass).toBe("reflexion:critique-1");
    expect(back.ended).toBe(true);
  });

  it("round-trips tree-of-thought nodes and the selected path", () => {
    const run = fold([
      ["tree-of-thought:explore", { node: { id: "a", depth: 1, score: 0.8, content: "idea" } }],
      ["tree-of-thought:explore", { node: { id: "b", parentId: "a", depth: 2, score: 0.5 } }],
      ["tree-of-thought:select", { path: ["a", "b"] }],
    ]);
    const back = strategyRunFromStorage(JSON.parse(JSON.stringify(strategyRunForStorage(run))))!;
    expect(back.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(back.nodes[1]!.parentId).toBe("a");
    expect(back.path).toEqual(["a", "b"]);
  });

  it("clips long code, stdout and critique, and bounds rows and nodes", () => {
    const big = "x".repeat(10_000);
    const run = fold([["code-action:execute:1", { code: big, stdout: big }]]);
    const stored = strategyRunForStorage(run, { textChars: 50, noteChars: 20, nodeChars: 10, maxRows: 2, maxNodes: 1 })!;
    expect(stored.rows[0]!.code!.length).toBe(51);
    expect(stored.rows[0]!.stdout!.endsWith("…")).toBe(true);
    const many = fold([1, 2, 3, 4].map((i) => [`reflexion:improve-${i}`] as const));
    expect(strategyRunForStorage(many, { textChars: 50, noteChars: 20, nodeChars: 10, maxRows: 2, maxNodes: 1 })!.rows.map((r) => r.key)).toEqual(["improve-3", "improve-4"]);
  });

  it("cuts the stored current step to its label", () => {
    const run = fold([["code-action:execute:1", { code: "print(1)" }]]);
    const cur = strategyRunForStorage(run)!.current as Record<string, unknown>;
    expect(cur.code).toBeUndefined();
    expect(cur.pass).toBe("code-action:execute:1");
  });

  it("malformed or absent storage reads as nothing, and a running row reads as done", () => {
    expect(strategyRunFromStorage(undefined)).toBeUndefined();
    expect(strategyRunFromStorage({ rows: "no" })).toBeUndefined();
    expect(strategyRunFromStorage({ rows: [{ key: 1 }], current: { pass: "reflexion:generate" } })).toBeUndefined();
    const back = strategyRunFromStorage({
      strategy: "reflexion",
      current: { pass: "reflexion:generate" },
      rows: [{ key: "generate", phase: "generate", label: "Drafting", status: "running" }],
    })!;
    expect(back.rows[0]!.status).toBe("done");
    expect(back.ended).toBe(true);
  });
});
