import { describe, it, expect } from "bun:test";
import { get } from "svelte/store";
import {
  createAgentStore,
  entropyToState,
  type RunSummaryDto,
} from "./agent-store.js";

describe("entropyToState", () => {
  it("returns idle when not running", () => {
    expect(entropyToState(0.9, false)).toBe("idle");
  });

  it("maps entropy bands when running", () => {
    expect(entropyToState(0.2, true)).toBe("running");
    expect(entropyToState(0.6, true)).toBe("exploring");
    expect(entropyToState(0.9, true)).toBe("stressed");
  });
});

describe("createAgentStore", () => {
  it("loads runs from /api/runs and seeds agents", async () => {
    const rows: RunSummaryDto[] = [
      {
        runId: "r1",
        agentId: "agent-a",
        status: "live",
        iterationCount: 2,
        tokensUsed: 100,
        cost: 0.01,
      },
    ];
    const fetchImpl = async () =>
      new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });

    const store = createAgentStore({
      loadOnInit: false,
      fetchImpl,
      now: () => 1_700_000_000_000,
    });
    await store.refresh();

    const list = get({ subscribe: store.subscribe });
    expect(list.length).toBe(1);
    expect(list[0]?.agentId).toBe("agent-a");
    expect(list[0]?.state).toBe("running");
    expect(list[0]?.tokensUsed).toBe(100);
    expect(list[0]?.cost).toBe(0.01);
  });

  it("refresh uses no-store and timestamp query for run polling", async () => {
    const rows: RunSummaryDto[] = [];
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;

    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const store = createAgentStore({
      loadOnInit: false,
      fetchImpl,
      now: () => 1234,
    });

    await store.refresh();

    expect(requestedUrl).toContain("/api/runs?ts=1234");
    expect(requestedInit?.cache).toBe("no-store");
  });

  it("refresh trusts terminal REST status over stale live cognitive state", async () => {
    const liveRows: RunSummaryDto[] = [
      {
        runId: "r1",
        agentId: "agent-a",
        status: "live",
        iterationCount: 2,
        tokensUsed: 100,
        cost: 0.01,
      },
    ];
    const completedRows: RunSummaryDto[] = [
      {
        runId: "r1",
        agentId: "agent-a",
        status: "completed",
        iterationCount: 3,
        tokensUsed: 150,
        cost: 0.02,
      },
    ];

    let callCount = 0;
    const fetchImpl = async () => {
      callCount += 1;
      const payload = callCount === 1 ? liveRows : completedRows;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const store = createAgentStore({
      loadOnInit: false,
      fetchImpl,
      now: () => 1_700_000_000_000,
    });

    await store.refresh();

    // Simulate richer live cognitive state from WS before terminal REST snapshot arrives.
    store.handleLiveMessage({
      agentId: "agent-a",
      runId: "r1",
      type: "EntropyScored",
      payload: { composite: 0.8 },
    });
    expect(get({ subscribe: store.subscribe })[0]?.state).toBe("stressed");

    await store.refresh();

    const list = get({ subscribe: store.subscribe });
    expect(list[0]?.state).toBe("completed");
  });

  it("handleLiveMessage merges EntropyScored into cognitive state", () => {
    const store = createAgentStore({ loadOnInit: false, now: () => 5 });
    store.handleLiveMessage({
      agentId: "x",
      runId: "r",
      type: "EntropyScored",
      payload: { composite: 0.8 },
    });
    const list = get({ subscribe: store.subscribe });
    expect(list[0]?.entropy).toBe(0.8);
    expect(list[0]?.state).toBe("stressed");
  });

  it("handleLiveMessage accumulates LLMRequestCompleted tokens and cost", () => {
    const store = createAgentStore({ loadOnInit: false, now: () => 9 });
    store.handleLiveMessage({
      agentId: "x",
      runId: "r",
      type: "LLMRequestCompleted",
      payload: { tokensUsed: 10, estimatedCost: 0.001 },
    });
    store.handleLiveMessage({
      agentId: "x",
      runId: "r",
      type: "LLMRequestCompleted",
      payload: { tokensUsed: 5, estimatedCost: 0.002 },
    });
    const list = get({ subscribe: store.subscribe });
    expect(list[0]?.tokensUsed).toBe(15);
    expect(list[0]?.cost).toBeCloseTo(0.003);
  });

  it("handleLiveMessage sets completed on AgentCompleted success", () => {
    const store = createAgentStore({ loadOnInit: false, now: () => 42 });
    store.handleLiveMessage({
      agentId: "x",
      runId: "r",
      type: "AgentCompleted",
      payload: { success: true },
    });
    const list = get({ subscribe: store.subscribe });
    expect(list[0]?.state).toBe("completed");
    expect(list[0]?.completedAt).toBe(42);
  });
});
