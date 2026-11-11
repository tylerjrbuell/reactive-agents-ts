/**
 * What Beacon's Board and Field read from the desk store (Bench step 5): the
 * run's summary status (a stopped run is not "settled"), its start, task,
 * source hints, entropy per step, the tool being called, and a name that is
 * never a bare ULID.
 */
import { describe, expect, it } from "bun:test";
import { get } from "svelte/store";
import { beaconDeskRunLabel, createAgentStore, liveFieldsFromEvents, type RunSummaryDto } from "./agent-store.js";

const ULID = "01M740Q1WYW1YWP4AKDYYXYMQ1";

function storeWith(rows: readonly RunSummaryDto[], now = 1_800_000_000_000) {
  const fetchImpl = async () =>
    new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
  return createAgentStore({ loadOnInit: false, fetchImpl, now: () => now });
}

const list = (store: ReturnType<typeof createAgentStore>) => get({ subscribe: store.subscribe });

describe("agent store: Beacon fields from REST", () => {
  it("keeps the summary status, start, error, chat name, task and launch hint", async () => {
    const store = storeWith([
      {
        runId: "r1",
        agentId: ULID,
        displayName: ULID,
        status: "stopped",
        startedAt: 1_700_000_000_000,
        completedAt: 1_700_000_005_000,
        iterationCount: 1,
        tokensUsed: 10,
        cost: 0,
        errorMessage: "Stopped by the user",
        chatSessionId: "s1",
        chatSessionName: "Crypto market report",
      },
      {
        runId: "r2",
        agentId: "desk",
        status: "completed",
        startedAt: 1_700_000_000_000,
        iterationCount: 1,
        tokensUsed: 10,
        cost: 0,
        launchParams: { prompt: "Summarise bitcoin mining\nin two lines" },
      },
    ]);
    await store.refresh();
    const [a, b] = list(store);
    expect(a).toMatchObject({
      runStatus: "stopped",
      state: "idle",
      startedAt: 1_700_000_000_000,
      errorMessage: "Stopped by the user",
      chatSessionId: "s1",
      chatSessionName: "Crypto market report",
      name: "Crypto market report",
    });
    expect(b).toMatchObject({ runStatus: "completed", launched: true, task: "Summarise bitcoin mining\nin two lines", name: "Summarise bitcoin mining" });
  });

  it("a REST refresh keeps a live run's entropy history, tool and task", async () => {
    const store = storeWith([{ runId: "r", agentId: "a", status: "live", iterationCount: 0, tokensUsed: 0, cost: 0 }]);
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "AgentStarted", payload: { task: "Find the price" } });
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "EntropyScored", payload: { composite: 0.3 } });
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "ToolCallStarted", payload: { toolName: "web-search" } });
    await store.refresh();
    expect(list(store)[0]).toMatchObject({ entropyHistory: [0.3], currentTool: "web-search", toolCalls: 1, task: "Find the price", runStatus: "live" });
  });

  it("a REST refresh that still says live does not revive a run the socket ended", async () => {
    const store = storeWith([{ runId: "r", agentId: "a", status: "live", iterationCount: 0, tokensUsed: 0, cost: 0 }]);
    await store.refresh();
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "AgentStopped", payload: {} });
    await store.refresh();
    expect(list(store)[0]).toMatchObject({ runStatus: "stopped", state: "idle" });
  });
});

describe("agent store: Beacon fields from the live socket", () => {
  it("records the task, entropy per step and the tool being called", () => {
    const store = createAgentStore({ loadOnInit: false, now: () => 5 });
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "AgentStarted", payload: { task: "Draft release notes" } });
    for (const composite of [0.7, 0.55, 0.38]) {
      store.handleLiveMessage({ agentId: "a", runId: "r", type: "EntropyScored", payload: { composite } });
    }
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "ToolCallStarted", payload: { toolName: "http-get" } });
    expect(list(store)[0]).toMatchObject({ task: "Draft release notes", entropyHistory: [0.7, 0.55, 0.38], currentTool: "http-get", toolCalls: 1, runStatus: "live", startedAt: 5 });
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "ToolCallCompleted", payload: { toolName: "http-get" } });
    expect(list(store)[0]?.currentTool).toBeUndefined();
  });

  it("caps the entropy history", () => {
    const store = createAgentStore({ loadOnInit: false, now: () => 5 });
    for (let i = 0; i < 100; i++) {
      store.handleLiveMessage({ agentId: "a", runId: "r", type: "EntropyScored", payload: { composite: i / 100 } });
    }
    const h = list(store)[0]?.entropyHistory ?? [];
    expect(h.length).toBe(48);
    expect(h[h.length - 1]).toBe(0.99);
  });

  it("desk Stop reads stopped, and a failure after it stays stopped", () => {
    const store = createAgentStore({ loadOnInit: false, now: () => 5 });
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "AgentStarted", payload: {} });
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "AgentStopped", payload: {} });
    expect(list(store)[0]).toMatchObject({ runStatus: "stopped", state: "idle" });
    store.handleLiveMessage({ agentId: "a", runId: "r", type: "AgentCompleted", payload: { success: false } });
    expect(list(store)[0]).toMatchObject({ runStatus: "stopped", state: "idle" });
  });

  it("AgentCompleted sets the summary status from success", () => {
    const store = createAgentStore({ loadOnInit: false, now: () => 5 });
    store.handleLiveMessage({ agentId: "a", runId: "ok", type: "AgentCompleted", payload: { success: true } });
    store.handleLiveMessage({ agentId: "a", runId: "bad", type: "AgentCompleted", payload: { success: false } });
    const byId = new Map(list(store).map((n) => [n.runId, n]));
    expect(byId.get("ok")).toMatchObject({ runStatus: "completed", state: "completed" });
    expect(byId.get("bad")).toMatchObject({ runStatus: "failed", state: "error" });
  });
});

describe("hydrating a run that was live before the page loaded", () => {
  const stored = [
    { type: "AgentStarted", payload: JSON.stringify({ task: "Read the files" }) },
    { type: "ReasoningIterationProgress", payload: JSON.stringify({ iteration: 1, maxIterations: 8 }) },
    { type: "EntropyScored", payload: JSON.stringify({ composite: 0.6 }) },
    { type: "ToolCallStarted", payload: { toolName: "file-list" } },
    { type: "ToolCallCompleted", payload: { toolName: "file-list" } },
    { type: "ReasoningIterationProgress", payload: JSON.stringify({ iteration: 2, maxIterations: 8 }) },
    { type: "EntropyScored", payload: JSON.stringify({ composite: 0.3 }) },
    { type: "ToolCallStarted", payload: { toolName: "file-read" } },
    { type: "LLMRequestCompleted", payload: { tokensUsed: 500 } },
    { type: "bogus", payload: "{not json" },
  ];

  it("folds stored events (JSON text or objects) into the live fields", () => {
    expect(liveFieldsFromEvents(stored)).toEqual({
      entropyHistory: [0.6, 0.3],
      loopIteration: 2,
      maxIterations: 8,
      toolCalls: 2,
      currentTool: "file-read",
      task: "Read the files",
    });
  });

  it("merges once, idempotently: no double count, never shrinks a longer live history", async () => {
    let eventCalls = 0;
    const fetchImpl = async (input: RequestInfo | URL) => {
      if (String(input).includes("/events")) {
        eventCalls++;
        return new Response(JSON.stringify(stored), { status: 200 });
      }
      return new Response(JSON.stringify([{ runId: "r", agentId: "a", status: "live", iterationCount: 2, tokensUsed: 500, cost: 0 }]), { status: 200 });
    };
    const store = createAgentStore({ loadOnInit: false, fetchImpl, now: () => 9 });
    await store.refresh();
    await store.hydrateLive("r");
    await store.hydrateLive("r");
    expect(eventCalls).toBe(1);
    expect(list(store)[0]).toMatchObject({
      entropyHistory: [0.6, 0.3],
      entropy: 0.3,
      loopIteration: 2,
      maxIterations: 8,
      toolCalls: 2,
      currentTool: "file-read",
      task: "Read the files",
      tokensUsed: 500,
    });

    const longer = createAgentStore({ loadOnInit: false, fetchImpl, now: () => 9 });
    for (const composite of [0.1, 0.2, 0.3]) longer.handleLiveMessage({ agentId: "a", runId: "r", type: "EntropyScored", payload: { composite } });
    await longer.hydrateLive("r");
    expect(list(longer)[0]?.entropyHistory).toEqual([0.1, 0.2, 0.3]);
  });
});

describe("beaconDeskRunLabel", () => {
  it("never names a run by a bare ULID", () => {
    expect(beaconDeskRunLabel({ displayName: ULID, agentId: ULID, runId: ULID, chatSessionName: "Hash explainer" })).toBe("Hash explainer");
    expect(beaconDeskRunLabel({ displayName: ULID, agentId: ULID, runId: ULID, provider: "ollama", model: "qwen3:4b" })).toBe("ollama · qwen3:4b");
  });

  it("prefers a real label, then the saved agent, the chat, the task, the model", () => {
    expect(beaconDeskRunLabel({ displayName: "release-bot", agentId: "a", runId: "r" })).toBe("release-bot");
    expect(beaconDeskRunLabel({ savedAgentName: "docs-watcher", chatSessionName: "x", agentId: "a", runId: "r" })).toBe("docs-watcher");
    expect(beaconDeskRunLabel({ task: "Explain hash functions\nwith examples", provider: "ollama", agentId: "a", runId: "r" })).toBe("Explain hash functions");
  });
});
