import { describe, expect, it } from "bun:test";
import type { AgentNode } from "./stores/agent-store.js";
import { beaconStatusOf, boardOf } from "./beacon-board.js";
import {
  BEACON_FILTER_KEY,
  filterAgents,
  filterCountLabel,
  filterCounts,
  matchesFilter,
  matchesQuery,
  NO_FILTER,
  readStoredFilter,
  storeFilter,
} from "./beacon-filter.js";

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
const statusOf = (n: AgentNode) => beaconStatusOf(n, false);

const nodes = [
  node({ runId: "a", name: "Crypto report", state: "running", model: "claude-haiku" }),
  node({ runId: "b", name: "Hash explainer", state: "completed", model: "mimo", task: "Explain hashing" }),
  node({ runId: "c", name: "Broken", state: "error", runStatus: "failed" }),
  node({ runId: "d", name: "Quiet", state: "idle" }),
];

describe("beacon filter", () => {
  it("chips: running, failed and at rest", () => {
    expect(matchesFilter("running", "running")).toBe(true);
    expect(matchesFilter("done", "running")).toBe(false);
    expect(matchesFilter("stopped", "idle")).toBe(true);
    expect(matchesFilter("failed", "idle")).toBe(false);
  });

  it("search needs every word in name, model, task or id", () => {
    expect(matchesQuery(nodes[0]!, "crypto haiku")).toBe(true);
    expect(matchesQuery(nodes[1]!, "hashing")).toBe(true);
    expect(matchesQuery(nodes[1]!, "hashing haiku")).toBe(false);
    expect(matchesQuery(nodes[2]!, "")).toBe(true);
  });

  it("filterAgents applies chip and search together", () => {
    expect(filterAgents(nodes, statusOf, NO_FILTER)).toHaveLength(4);
    expect(filterAgents(nodes, statusOf, { status: "running", query: "" }).map((n) => n.runId)).toEqual(["a"]);
    expect(filterAgents(nodes, statusOf, { status: "idle", query: "hash" }).map((n) => n.runId)).toEqual(["b"]);
  });

  it("counts per chip respect the search", () => {
    const c = filterCounts(nodes, statusOf, "");
    expect(c).toMatchObject({ all: 4, running: 1, failed: 1 });
    expect(filterCounts(nodes, statusOf, "crypto").all).toBe(1);
  });

  it("count label reads '12 of 48' only while narrowed", () => {
    expect(filterCountLabel(48, 48)).toBe("48");
    expect(filterCountLabel(12, 48)).toBe("12 of 48");
  });

  it("Board and Field read one rule: the Board's grid matches filterAgents for the same chip", () => {
    for (const status of ["needs-you", "failed", "idle"] as const) {
      const board = boardOf(nodes, new Map(), status, 0).agents.map((r) => r.runId);
      const field = filterAgents(nodes, statusOf, { status, query: "" })
        .filter((n) => statusOf(n).tone !== "running")
        .map((n) => n.runId);
      expect([...board].sort()).toEqual([...field].sort());
    }
  });

  it("remembers the choice and shrugs off bad storage", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    storeFilter(store, { status: "failed", query: "sol" });
    expect(mem.has(BEACON_FILTER_KEY)).toBe(true);
    expect(readStoredFilter(store)).toEqual({ status: "failed", query: "sol" });
    mem.set(BEACON_FILTER_KEY, "{not json");
    expect(readStoredFilter(store)).toEqual(NO_FILTER);
    mem.set(BEACON_FILTER_KEY, JSON.stringify({ status: "bogus", query: 3 }));
    expect(readStoredFilter(store)).toEqual(NO_FILTER);
    expect(readStoredFilter(null)).toEqual(NO_FILTER);
  });
});
