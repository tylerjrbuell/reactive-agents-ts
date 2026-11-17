import { describe, expect, it } from "bun:test";
import type { AgentNode } from "./stores/agent-store.js";
import {
  BEACON_VIEW_KEY,
  beaconSourceLabel,
  beaconStatusOf,
  beaconViewSearch,
  boardOf,
  fieldIconOf,
  fieldLinkActive,
  fieldStatusLabel,
  liveActivityOf,
  liveFootOf,
  needsYouByRun,
  readStoredBeaconView,
  resolveBeaconView,
  runningCount,
  storeBeaconView,
} from "./beacon-board.js";

const NOW = 1_700_000_100_000;

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

describe("Beacon view", () => {
  it("opens Board by default; the URL wins over the stored choice", () => {
    expect(resolveBeaconView(null, null)).toBe("board");
    expect(resolveBeaconView(null, "field")).toBe("field");
    expect(resolveBeaconView("board", "field")).toBe("board");
    expect(resolveBeaconView("field", "board")).toBe("field");
    expect(resolveBeaconView("grid", "nonsense")).toBe("board");
  });

  it("reads and writes the stored view, ignoring a storage that throws", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    storeBeaconView(storage, "field");
    expect(mem.get(BEACON_VIEW_KEY)).toBe("field");
    expect(readStoredBeaconView(storage)).toBe("field");
    const blocked = {
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readStoredBeaconView(blocked)).toBeUndefined();
    expect(() => storeBeaconView(blocked, "board")).not.toThrow();
    expect(readStoredBeaconView(null)).toBeUndefined();
  });

  it("sets ?view=field for Field and drops it for Board, keeping other params", () => {
    expect(beaconViewSearch("", "field")).toBe("?view=field");
    expect(beaconViewSearch("?view=field", "board")).toBe("");
    expect(beaconViewSearch("?x=1&view=field", "board")).toBe("?x=1");
  });
});

describe("beaconStatusOf", () => {
  it("maps a run's state onto the shared vocabulary", () => {
    expect(beaconStatusOf(node({ runId: "a", state: "running" }), false)).toEqual({ tone: "running", label: "Running" });
    expect(beaconStatusOf(node({ runId: "a", state: "stressed" }), false).tone).toBe("running");
    expect(beaconStatusOf(node({ runId: "a", state: "completed", runStatus: "completed" }), false)).toEqual({ tone: "done", label: "Finished" });
    expect(beaconStatusOf(node({ runId: "a", state: "error", runStatus: "failed" }), false)).toEqual({ tone: "failed", label: "Failed" });
    expect(beaconStatusOf(node({ runId: "a", state: "idle", runStatus: "stopped" }), false)).toEqual({ tone: "stopped", label: "Stopped" });
    expect(beaconStatusOf(node({ runId: "a", state: "idle" }), false)).toEqual({ tone: "idle", label: "Idle" });
  });

  it("a stopped run reads Stopped, not Finished (the old Beacon said SETTLED)", () => {
    expect(beaconStatusOf(node({ runId: "a", state: "completed", runStatus: "stopped" }), false).tone).toBe("stopped");
  });

  it("an abstained or partial run reads so (attention), not a red Failed", () => {
    expect(beaconStatusOf(node({ runId: "a", state: "error", runStatus: "failed", runEnding: "abstained" }), false)).toEqual({ tone: "attention", label: "Abstained" });
    expect(beaconStatusOf(node({ runId: "a", state: "error", runStatus: "failed", runEnding: "partial" }), false).label).toBe("Partial");
    expect(beaconStatusOf(node({ runId: "a", state: "error", runStatus: "failed", runEnding: "failed" }), false).label).toBe("Failed");
  });

  it("a run a guardrail ended reads Blocked by guardrail (an at-rest stop, not a red Failed)", () => {
    expect(beaconStatusOf(node({ runId: "a", state: "idle", runStatus: "blocked" }), false)).toEqual({ tone: "stopped", label: "Blocked by guardrail" });
  });

  it("an agent waiting on you needs you, even while its run is live", () => {
    expect(beaconStatusOf(node({ runId: "a", state: "running" }), true)).toEqual({ tone: "attention", label: "Waiting on you" });
  });

  it("names the source like the Runs table", () => {
    expect(beaconSourceLabel(node({ runId: "a", chatSessionId: "s1" }))).toBe("chat");
    expect(beaconSourceLabel(node({ runId: "a", savedAgentName: "release-bot" }))).toBe("gateway");
    expect(beaconSourceLabel(node({ runId: "a", launched: true }))).toBe("desk run");
    expect(beaconSourceLabel(node({ runId: "a" }))).toBe("app");
  });
});

describe("needsYouByRun", () => {
  it("matches a question by run id and an approval by run, chat session or agent", () => {
    const nodes = [
      node({ runId: "q1" }),
      node({ runId: "chat-old", chatSessionId: "s1", startedAt: 1 }),
      node({ runId: "chat-new", chatSessionId: "s1", startedAt: 2 }),
      node({ runId: "desk", agentId: "desk-agent", startedAt: 5 }),
    ];
    const map = needsYouByRun(
      nodes,
      [
        { runId: "durable-1", agentId: "desk-agent", gateId: "g", toolName: "shell-execute", args: { command: "rm -rf build/" } },
        { runId: "chat-durable", agentId: "x", gateId: "g", toolName: "file-write", args: {}, chatSessionId: "s1" },
      ],
      [{ runId: "q1", interactionId: "i1", kind: "choice", prompt: "Which branch?\nmore", schema: {} }],
    );
    expect(map.get("q1")).toBe("Asked: Which branch?");
    expect(map.get("desk")).toBe("Approve shell-execute: rm -rf build/");
    expect(map.get("chat-new")).toBe("Approve file-write: {}");
    expect(map.has("chat-old")).toBe(false);
  });

  it("names the sub-agent that asks and how many more requests wait on the same run", () => {
    const ask = (gateId: string, subAgent: string) => ({ runId: "root", agentId: "a", gateId, toolName: "risky", args: {}, subAgent });
    const map = needsYouByRun([node({ runId: "root", agentId: "a" })], [ask("g1", "alpha"), ask("g2", "beta")], []);
    expect(map.get("root")).toBe("alpha: Approve risky: {} (+1 more waiting)");
  });
});

describe("boardOf", () => {
  const nodes = [
    node({ runId: "live-1", name: "Crypto market report", state: "running", startedAt: NOW - 42_000, task: "Retry SOL\nthen update", chatSessionId: "s", entropyHistory: [0.2, 0.62], loopIteration: 3, maxIterations: 6, tokensUsed: 2100, currentTool: "http-get" }),
    node({ runId: "done-1", name: "Hash explainer", runStatus: "completed", completedAt: NOW - 7_200_000, model: "mimo", tokensUsed: 2500, task: "Explain hashes" }),
    node({ runId: "fail-1", name: "Save market.md", state: "error", runStatus: "failed", completedAt: NOW - 3_000_000, errorMessage: "file-write refused: no workspace is set\nstack" }),
    node({ runId: "stop-1", name: "Long multiplication", state: "idle", runStatus: "stopped", completedAt: NOW - 3_600_000 }),
    node({ runId: "wait-1", name: "Release notes", state: "running", startedAt: NOW - 600_000 }),
  ];
  const waiting = new Map([["wait-1", "Asked: which branch?"]]);

  it("puts live agents on cards and everything else in the grid, waiting first", () => {
    const b = boardOf(nodes, waiting, "all", NOW);
    expect(b.live.map((c) => c.runId)).toEqual(["live-1"]);
    const card = b.live[0]!;
    expect(card).toMatchObject({ name: "Crypto market report", source: "chat", elapsedMs: 42_000, goal: "Retry SOL", entropy: [0.2, 0.62] });
    expect(card.activity).toEqual({ verb: "Calling", tool: "http-get" });
    expect(card.foot).toBe("step 3 of 6 · 2.1k tok");
    expect(b.agents.map((a) => a.runId)).toEqual(["wait-1", "fail-1", "stop-1", "done-1"]);
    expect(b.agents[0]).toMatchObject({ status: { tone: "attention", label: "Waiting on you" }, last: "Asked: which branch?" });
    expect(b.agents[1]!.last).toBe("file-write refused: no workspace is set");
    expect(b.agents[2]!.last).toBe("Stopped before it finished");
    expect(b.agents[3]).toMatchObject({ last: "Explain hashes", model: "mimo", tokens: "2.5k tok" });
    expect(b.counts).toEqual({ all: 4, running: 0, "needs-you": 1, failed: 1, idle: 2 });
  });

  it("an error line goes through the shared run-error rule (first line, no credentials)", () => {
    const leaky = node({ runId: "x", state: "error", runStatus: "failed", errorMessage: "Auth failed: key sk-ant-abcdefghijklmnopqrstuvwxyz0123 rejected\nmore" });
    const last = boardOf([leaky], new Map(), "all", NOW).agents[0]!.last;
    expect(last).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz0123");
    expect(last.startsWith("Auth failed")).toBe(true);
  });

  it("filters the grid: Needs you, Failed, Idle (finished, stopped, idle)", () => {
    expect(boardOf(nodes, waiting, "needs-you", NOW).agents.map((a) => a.runId)).toEqual(["wait-1"]);
    expect(boardOf(nodes, waiting, "failed", NOW).agents.map((a) => a.runId)).toEqual(["fail-1"]);
    expect(boardOf(nodes, waiting, "idle", NOW).agents.map((a) => a.runId)).toEqual(["stop-1", "done-1"]);
    const filtered = boardOf(nodes, waiting, "failed", NOW);
    expect(filtered.live).toHaveLength(1);
    expect(filtered.total).toBe(4);
  });

  it("orders live cards oldest first so a card keeps its place", () => {
    const b = boardOf(
      [node({ runId: "new", state: "running", startedAt: NOW - 1_000 }), node({ runId: "old", state: "running", startedAt: NOW - 9_000 })],
      new Map(),
      "all",
      NOW,
    );
    expect(b.live.map((c) => c.runId)).toEqual(["old", "new"]);
  });

  it("a single entropy reading is one sample; none is empty", () => {
    expect(boardOf([node({ runId: "a", state: "running", entropy: 0.4 })], new Map(), "all", NOW).live[0]!.entropy).toEqual([0.4]);
    expect(boardOf([node({ runId: "a", state: "running" })], new Map(), "all", NOW).live[0]!.entropy).toEqual([]);
  });
});

describe("live card text", () => {
  it("says what the agent is doing", () => {
    expect(liveActivityOf(node({ runId: "a", currentTool: "web-search" }))).toEqual({ verb: "Calling", tool: "web-search" });
    expect(liveActivityOf(node({ runId: "a", loopIteration: 7, toolCalls: 14 }))).toEqual({ verb: "Thinking", detail: "after 14 tool calls" });
    expect(liveActivityOf(node({ runId: "a", loopIteration: 1 }))).toEqual({ verb: "Thinking" });
    expect(liveActivityOf(node({ runId: "a" }))).toEqual({ verb: "Starting" });
  });

  it("drops foot parts with no data", () => {
    expect(liveFootOf(node({ runId: "a", loopIteration: 7, maxIterations: 20, tokensUsed: 48_900, cost: 0.31 }))).toBe("step 7 of 20 · 48.9k tok · $0.310");
    expect(liveFootOf(node({ runId: "a", loopIteration: 2 }))).toBe("step 2");
    expect(liveFootOf(node({ runId: "a" }))).toBe("");
  });
});

describe("Field", () => {
  it("labels nodes in sentence case, never STATUS: SETTLED", () => {
    const running = node({ runId: "a", state: "running", loopIteration: 3 });
    expect(fieldStatusLabel(running, beaconStatusOf(running, false))).toBe("Running · step 3");
    const calling = node({ runId: "a", state: "running", currentTool: "http-get" });
    expect(fieldStatusLabel(calling, beaconStatusOf(calling, false))).toBe("Calling http-get");
    const done = node({ runId: "a", runStatus: "completed" });
    expect(fieldStatusLabel(done, beaconStatusOf(done, false))).toBe("Finished");
  });

  it("picks a tile icon per status", () => {
    expect(fieldIconOf(node({ runId: "a", currentTool: "x" }), "running")).toBe("tool");
    expect(fieldIconOf(node({ runId: "a" }), "running")).toBe("think");
    expect(fieldIconOf(node({ runId: "a" }), "done")).toBe("check");
    expect(fieldIconOf(node({ runId: "a" }), "failed")).toBe("alert");
    expect(fieldIconOf(node({ runId: "a" }), "stopped")).toBe("stop");
    expect(fieldIconOf(node({ runId: "a" }), "idle")).toBe("steps");
  });

  it("a link flows only while parent and child both run", () => {
    expect(fieldLinkActive({ state: "running" }, { state: "exploring" })).toBe(true);
    expect(fieldLinkActive({ state: "completed" }, { state: "running" })).toBe(false);
    expect(fieldLinkActive({ state: "running" }, { state: "completed" })).toBe(false);
    expect(fieldLinkActive(undefined, { state: "running" })).toBe(false);
  });
});

describe("runningCount", () => {
  it("counts agents working now, not ones waiting on you", () => {
    const nodes = [
      { runId: "a", state: "running" as const },
      { runId: "b", state: "stressed" as const },
      { runId: "c", state: "completed" as const },
      { runId: "d", state: "idle" as const },
    ];
    expect(runningCount(nodes)).toBe(2);
    expect(runningCount(nodes, new Map([["b", "Asked: ok?"]]))).toBe(1);
  });
});
