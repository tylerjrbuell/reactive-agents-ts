import { describe, expect, it } from "bun:test";
import type { AgentNode } from "./stores/agent-store.js";
import { beaconStatusOf } from "./beacon-board.js";
import { AUTO_COLLAPSE_OVER, collapsedParents, descendantsOf, fieldNodeInfo, legendOf, visibleNodes } from "./beacon-field.js";

function node(over: Partial<AgentNode> & { runId: string }): AgentNode {
  return {
    agentId: `agent-${over.runId}`,
    name: `Agent ${over.runId}`,
    state: "completed",
    entropy: 0,
    loopIteration: 0,
    reasoningSteps: 0,
    maxIterations: 0,
    tokensUsed: 0,
    cost: 0,
    connectedAt: 0,
    lastEventAt: 0,
    ...over,
  };
}
const toneOf = (n: AgentNode) => beaconStatusOf(n, false).tone;

describe("Field collapse", () => {
  const parentOf = new Map([["c1", "p"], ["c2", "p"], ["g1", "c1"]]);
  const tree = [node({ runId: "p" }), node({ runId: "c1" }), node({ runId: "c2" }), node({ runId: "g1" }), node({ runId: "x" })];

  it("finds every descendant", () => {
    expect([...descendantsOf("p", parentOf)].sort()).toEqual(["c1", "c2", "g1"]);
  });

  it("does not auto-collapse a small desk; a viewer choice always wins", () => {
    expect(collapsedParents(tree, parentOf, toneOf, new Map()).size).toBe(0);
    expect([...collapsedParents(tree, parentOf, toneOf, new Map([["p", true]]))]).toEqual(["p"]);
  });

  it("past the threshold, folds finished trees but never one with a running sub-agent", () => {
    const filler = Array.from({ length: AUTO_COLLAPSE_OVER }, (_, i) => node({ runId: `f${i}` }));
    expect([...collapsedParents([...tree, ...filler], parentOf, toneOf, new Map())].sort()).toEqual(["c1", "p"]);
    const live = tree.map((n) => (n.runId === "g1" ? node({ runId: "g1", state: "running" }) : n));
    expect(collapsedParents([...live, ...filler], parentOf, toneOf, new Map()).has("p")).toBe(false);
    expect(collapsedParents([...tree, ...filler], parentOf, toneOf, new Map([["p", false]])).has("p")).toBe(false);
  });

  it("a collapsed parent hides all its descendants and counts them", () => {
    const { shown, hiddenUnder } = visibleNodes(tree, parentOf, new Set(["p"]));
    expect(shown.map((n) => n.runId)).toEqual(["p", "x"]);
    expect(hiddenUnder.get("p")).toBe(3);
  });
});

describe("legendOf", () => {
  it("counts agents per status in first-seen order", () => {
    const s = (tone: "running" | "done", label: string) => ({ tone, label });
    expect(legendOf([s("done", "Finished"), s("running", "Running"), s("done", "Finished")])).toEqual([
      { tone: "done", label: "Finished", count: 2 },
      { tone: "running", label: "Running", count: 1 },
    ]);
    expect(legendOf([])).toEqual([]);
  });
});

describe("fieldNodeInfo", () => {
  const done = beaconStatusOf(node({ runId: "d" }), false);
  it("says model, run time, tokens and cost; a sub-agent says so", () => {
    const n = node({ runId: "a", model: "mimo", startedAt: 1000, completedAt: 66_000, tokensUsed: 2100, cost: 0.31, parentRunId: "p" });
    const info = fieldNodeInfo(n, done, 0);
    expect(info.modelLine).toBe("sub · mimo");
    expect(info.metaLine).toContain("2.1k tok");
    expect(info.metaLine).toContain("$");
  });
  it("a running node's time ticks with now; nothing known gives empty lines", () => {
    const run = beaconStatusOf(node({ runId: "r", state: "running" }), false);
    const n = node({ runId: "r", state: "running", startedAt: 1000 });
    expect(fieldNodeInfo(n, run, 5000).metaLine).not.toBe(fieldNodeInfo(n, run, 9000).metaLine);
    expect(fieldNodeInfo(node({ runId: "z" }), done, 0)).toEqual({ modelLine: "", metaLine: "" });
  });
});
