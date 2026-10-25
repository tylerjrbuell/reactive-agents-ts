// Run: bun test packages/runtime/tests/chat-engine-stream-record.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../src/chat/engine.js";
import type { RunHandle } from "../src/run-controller.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import type { ChatTurnEvent } from "@reactive-agents/core";

/**
 * Metadata payload matching the canned stub stream. Typed via the runtime
 * package's own types (no `any` / `as any`); pins the values the engine
 * reads (`metadata.tokensUsed`) with harmless zero-cost defaults.
 */
const STUB_METADATA = {
  duration: 0,
  cost: 0,
  tokensUsed: 18,
  stepsCount: 1,
} as const;

/**
 * Stub runStreamTask return mirroring the `RunHandle` contract: an async
 * generator yielding `events` in order, with no-op verbs (the engine's
 * wrapper verbs delegate to whatever handle `runStreamTask` returned).
 */
function makeStubHandle(events: readonly AgentStreamEvent[]): RunHandle {
  async function* streamStubEvents(): AsyncGenerator<AgentStreamEvent> {
    for (const event of events) {
      yield event;
    }
  }
  return Object.assign(streamStubEvents(), {
    pause: () => {},
    resume: () => {},
    stop: (_opts?: { reason?: string }) => {},
    terminate: (_opts?: { reason?: string }) => {},
    status: () => "running",
    inspect: () => undefined,
  });
}

/** TextDelta ×2 then StreamCompleted — the happy-path canned sequence. */
function completedEvents(output: string): readonly AgentStreamEvent[] {
  return [
    { _tag: "TextDelta", text: "hel" },
    { _tag: "TextDelta", text: "lo" },
    { _tag: "StreamCompleted", output, taskId: "t9", metadata: STUB_METADATA },
  ];
}

interface TestHarness {
  /** The engine's streamTurn wrapper handle (the system under test). */
  readonly handle: RunHandle;
  readonly saves: { sessionId: string; messages: readonly { role: string; content: string }[] }[];
  readonly published: ChatTurnEvent[];
  readonly history: () => { role: string; content: string }[];
}

/** Engine wired with recording-observable sinks and the given stream events. */
function makeHarness(events: readonly AgentStreamEvent[], output: string): TestHarness {
  const saves: { sessionId: string; messages: readonly { role: string; content: string }[] }[] = [];
  const published: ChatTurnEvent[] = [];
  const engine = new ChatEngine(
    {
      complete: async () => ({ message: "unused" }),
      runStreamTask: (_input, _opts) => makeStubHandle(events),
      publishTurn: async (turn) => {
        published.push(turn);
      },
      saveHistory: async (sessionId, messages) => {
        saves.push({ sessionId, messages });
      },
    },
    { sessionId: "sess_session_stream" },
  );
  return {
    handle: engine.streamTurn("say hi"),
    saves,
    published,
    history: () => engine.history().map((m) => ({ role: m.role, content: m.content })),
  };
}

describe("ChatEngine streamTurn records at terminal-event observation (cortex chat overhaul Task 2)", () => {
  it("consumer that breaks ON StreamCompleted still records + persists the turn", async () => {
    const t = makeHarness(completedEvents("hello"), "hello");
    let text = "";
    let sawCompleted = false;
    for await (const ev of t.handle) {
      if (ev._tag === "StreamCompleted") {
        sawCompleted = true;
        break; // the cortex SSE pattern: close right after the terminal event
      }
      if (ev._tag === "TextDelta") text += ev.text;
    }
    expect(sawCompleted).toBe(true);
    expect(text).toBe("hello");
    // THE FAIL: history must already contain the symmetric turns — the
    // recording must have happened when the terminal event was OBSERVED,
    // inside the tee loop, not after `yield event` returned control.
    expect(t.history()).toEqual([
      { role: "user", content: "say hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(t.saves).toHaveLength(1);
    expect(t.published).toHaveLength(2);
  });

  it("consumer that iterates fully records EXACTLY once (recorded guard)", async () => {
    const t = makeHarness(completedEvents("hello"), "hello");
    let text = "";
    for await (const ev of t.handle) {
      if (ev._tag === "TextDelta") text += ev.text;
    }
    expect(text).toBe("hello");
    expect(t.history()).toHaveLength(2);
    expect(t.saves).toHaveLength(1);
    expect(t.published).toHaveLength(2);
  });

  it("breaks early (after first delta, before any terminal): records NOTHING", async () => {
    const t = makeHarness(completedEvents("hello"), "hello");
    for await (const ev of t.handle) {
      void ev;
      break; // vanish after the first event — mid-stream early close
    }
    expect(t.history()).toHaveLength(0);
    expect(t.saves).toHaveLength(0);
    expect(t.published).toHaveLength(0);
  });

  it("StreamError terminal: records nothing (failed stream leaves no trace)", async () => {
    const errorEvents: readonly AgentStreamEvent[] = [
      { _tag: "TextDelta", text: "par" },
      { _tag: "StreamError", cause: "boom" },
    ];
    const t = makeHarness(errorEvents, "unused");
    for await (const ev of t.handle) {
      void ev; // consume fully
    }
    expect(t.history()).toHaveLength(0);
    expect(t.saves).toHaveLength(0);
    expect(t.published).toHaveLength(0);
  });
});
