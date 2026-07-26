import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { makeStatusRenderer, type EbLike } from "../src/logging/status-renderer";
import { makeObservableLogger } from "../src/logging/observable-logger";
import { PassThrough } from "node:stream";

function makeMockStream(): NodeJS.WriteStream {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream;
  stream.isTTY = true;
  return stream;
}

type StartedEvent = Extract<AgentEvent, { readonly _tag: "AgentStarted" }>;
type CompletedEvent = Extract<AgentEvent, { readonly _tag: "AgentCompleted" }>;
/** `never` in parameter position accepts any handler contravariantly — no cast on write. */
type CapturedHandler = (event: never) => Effect.Effect<void, never>;

/**
 * Minimal object satisfying the renderer's real `EbLike` (the same interface the
 * live `EventBus` satisfies) that records the handlers `start()` registers, so a
 * test can invoke them exactly as the bus would.
 */
function makeFakeEb(): {
  readonly eb: EbLike;
  readonly handlers: Map<string, CapturedHandler>;
  readonly unsubCount: () => number;
} {
  const handlers = new Map<string, CapturedHandler>();
  let unsubs = 0;
  const eb: EbLike = {
    on: (tag, handler) =>
      Effect.sync(() => {
        handlers.set(tag, handler);
        return () => {
          unsubs++;
        };
      }),
  };
  return { eb, handlers, unsubCount: () => unsubs };
}

describe("StatusRenderer sub-agent collapse", () => {
  test("renders a collapsed one-line summary for a running sub-agent, freezes on completion", async () => {
    const out = makeMockStream();
    let written = "";
    out.on("data", (chunk) => { written += chunk.toString(); });

    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeObservableLogger({ live: false });
        const renderer = makeStatusRenderer(logger, out);
        yield* renderer.start();
        renderer.onAgentStarted({ taskId: "sub-1", agentId: "a2", parentAgentId: "a1", agentDisplayName: "bitcoin-price-finder" });
        renderer.onAgentCompleted({ taskId: "sub-1", agentId: "a2", success: true, totalTokens: 6467, durationMs: 8900 });
        renderer.stop();
      }),
    );

    expect(written).toContain("bitcoin-price-finder");
    expect(written).toContain("✓");
  });

  test("auto-expands and marks failure status on unsuccessful completion", async () => {
    const out = makeMockStream();
    let written = "";
    out.on("data", (chunk) => { written += chunk.toString(); });

    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeObservableLogger({ live: false });
        const renderer = makeStatusRenderer(logger, out);
        yield* renderer.start();
        renderer.onAgentStarted({ taskId: "sub-2", agentId: "a3", parentAgentId: "a1", agentDisplayName: "flaky-agent" });
        renderer.onAgentCompleted({ taskId: "sub-2", agentId: "a3", success: false, totalTokens: 42, durationMs: 100 });
        renderer.stop();
      }),
    );

    expect(written).toContain("flaky-agent");
    expect(written).toContain("✗");
  });

  // Regression for the one real defect the manual TTY check surfaced: `AgentStarted`
  // fires for EVERY agent execution on the shared bus — including the ROOT's own,
  // which has no `parentAgentId`. Without the guard in `onAgentStarted` the root
  // rendered a bogus "spawn-agent → <root>" line for itself.
  // Red-on-cut: delete the `if (event.parentAgentId === undefined) return;` guard.
  test("does NOT render a sub-agent line for the root's own AgentStarted (no parentAgentId)", async () => {
    const out = makeMockStream();
    let written = "";
    out.on("data", (chunk) => { written += chunk.toString(); });

    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeObservableLogger({ live: false });
        const renderer = makeStatusRenderer(logger, out);
        yield* renderer.start();
        renderer.onAgentStarted({ taskId: "root", agentId: "a1" });
        renderer.stop();
      }),
    );

    expect(written).not.toContain("spawn-agent");
  });

  // Pins the WIRING, not just the method: `start()` must subscribe to the shared
  // EventBus and route real AgentStarted/AgentCompleted events into sub-agent
  // lines. The two tests above call `onAgentStarted` directly and would still pass
  // if the `eb.on(...)` subscription block in `start()` were deleted entirely.
  // Red-on-cut: remove the `if (eb) { ... }` block in `start()`.
  test("subscribes to the EventBus and renders sub-agent lines from real events", async () => {
    const out = makeMockStream();
    let written = "";
    out.on("data", (chunk) => { written += chunk.toString(); });

    const { eb, handlers, unsubCount } = makeFakeEb();

    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeObservableLogger({ live: false });
        const renderer = makeStatusRenderer(logger, out, eb);
        yield* renderer.start();

        expect(handlers.has("AgentStarted")).toBe(true);
        expect(handlers.has("AgentCompleted")).toBe(true);

        // Re-widening the `never` parameter back to the concrete event type is a
        // plain (comparable) assertion — no `as unknown as` double cast needed.
        const started = handlers.get("AgentStarted")! as (
          event: StartedEvent,
        ) => Effect.Effect<void, never>;
        const completed = handlers.get("AgentCompleted")! as (
          event: CompletedEvent,
        ) => Effect.Effect<void, never>;

        yield* started({
          _tag: "AgentStarted",
          taskId: "wired-1",
          agentId: "sub-researcher-1753469999999",
          provider: "test",
          model: "test-model",
          timestamp: Date.now(),
          parentAgentId: "root-agent",
          agentDisplayName: "researcher",
        });
        yield* completed({
          _tag: "AgentCompleted",
          taskId: "wired-1",
          agentId: "sub-researcher-1753469999999",
          success: true,
          totalIterations: 2,
          totalTokens: 1234,
          durationMs: 4200,
        });

        renderer.stop();
      }),
    );

    expect(written).toContain("spawn-agent → researcher");
    expect(written).toContain("✓");
    expect(written).toContain("1,234 tok");
    // stop() must release both bus subscriptions.
    expect(unsubCount()).toBe(2);
  });
});
