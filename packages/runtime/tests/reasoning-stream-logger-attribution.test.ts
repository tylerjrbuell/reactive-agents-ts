import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { subscribeReasoningStreamLogger } from "../src/engine/phases/agent-loop/reasoning-stream-logger";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("reasoning-stream-logger attribution", () => {
  // Regression for the concurrent-sub-agent case found via live E2E
  // (observability unified run-tree fast-follow, 2026-07-25): the root's
  // single shared-bus subscription (see reasoning-stream-logger-dedup.test.ts)
  // renders EVERY descendant's ReasoningStepCompleted through the root's own
  // `obs`, which carries no per-child prefix — so three parallel sub-agents'
  // thought/action/obs DEBUG lines interleaved with zero attribution, even
  // though their structured INFO lines (via `obs.info` wrapped in
  // execution-engine.ts) were already correctly prefixed. Fixed by building a
  // taskId → prefix map from AgentStarted (already flowing on the same bus).
  test("attributes two concurrent sub-agents' reasoning steps by taskId, using AgentStarted to learn the prefix", async () => {
    const calls: string[] = [];
    const obs = {
      debug: (msg: string) => Effect.sync(() => { calls.push(msg); }),
    } as never;

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* subscribeReasoningStreamLogger({
          eb, obs, logModelIO: false, isVerbose: true, isDebug: false,
        });

        yield* eb.publish({
          _tag: "AgentStarted", taskId: "child-a", agentId: "sub-a",
          provider: "test", model: "test-model", timestamp: 0,
          agentDisplayName: "researcher", depth: 1,
        } as never);
        yield* eb.publish({
          _tag: "AgentStarted", taskId: "child-b", agentId: "sub-b",
          provider: "test", model: "test-model", timestamp: 0,
          agentDisplayName: "writer", depth: 1,
        } as never);

        // Interleaved as they would be under real parallel dispatch.
        yield* eb.publish({
          _tag: "ReasoningStepCompleted", taskId: "child-a", strategy: "reactive",
          step: 1, totalSteps: 1, action: "web-search",
        } as never);
        yield* eb.publish({
          _tag: "ReasoningStepCompleted", taskId: "child-b", strategy: "reactive",
          step: 1, totalSteps: 1, action: "file-write",
        } as never);
        // The root's own step (no AgentStarted registered for its taskId) must
        // stay unprefixed rather than picking up a stale/wrong entry.
        yield* eb.publish({
          _tag: "ReasoningStepCompleted", taskId: "root-task", strategy: "reactive",
          step: 1, totalSteps: 1, action: "spawn-agent",
        } as never);
      }).pipe(Effect.provide(EventBusLive)),
    );

    const searchLine = calls.find((c) => c.includes("web-search"));
    const writeLine = calls.find((c) => c.includes("file-write"));
    const rootLine = calls.find((c) => c.includes("spawn-agent"));

    expect(searchLine).toContain("researcher");
    expect(writeLine).toContain("writer");
    // Distinct children never share a prefix.
    expect(searchLine).not.toContain("writer");
    expect(writeLine).not.toContain("researcher");
    // Root has no AgentStarted entry, so no child name leaks onto its line.
    expect(rootLine).not.toContain("researcher");
    expect(rootLine).not.toContain("writer");
  });
});
