import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../../src/chat/engine.js";
import { ChatEngineCapabilityError } from "../../src/chat/engine-errors.js";
import type { RunHandle } from "../../src/run-controller.js";
import type { AgentStreamEvent } from "../../src/stream-types.js";

/**
 * Metadata payload matching the canned stub stream. `AgentResultMetadata`'s
 * required fields are always present on a real `StreamCompleted`; the stub
 * pins the values the engine reads (`metadata.tokensUsed`) with harmless
 * zero-cost defaults. Typed via the runtime package's own types (no
 * `any` / `as any`).
 */
const STUB_METADATA = {
  duration: 0,
  cost: 0,
  tokensUsed: 18,
  stepsCount: 1,
} as const;

/** Canned event sequence the stub handle streams, terminal event last. */
const STUB_EVENTS: readonly AgentStreamEvent[] = [
  { _tag: "TextDelta", text: "hel" },
  { _tag: "TextDelta", text: "lo" },
  { _tag: "StreamCompleted", output: "hello", taskId: "t9", metadata: STUB_METADATA },
];

/**
 * Stub runStreamTask return mirroring the `RunHandle` contract:
 * an async generator yielding the canned events, with
 * `pause/resume/stop/terminate/status/inspect` no-oping (the engine's
 * wrapper verbs delegate to whatever handle `runStreamTask` returned).
 */
function makeStubHandle(): RunHandle {
  async function* streamStubEvents(): AsyncGenerator<AgentStreamEvent> {
    for (const event of STUB_EVENTS) {
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

describe("ChatEngine streamTurn (engine plan Task 4)", () => {
  it("streams unaltered and records the assistant turn from StreamCompleted", async () => {
    const saves: { sessionId: string; messages: readonly { role: string; content: string }[] }[] = [];
    const engine = new ChatEngine(
      {
        complete: async () => ({ message: "unused" }),
        runStreamTask: (_input, _opts) => makeStubHandle(),
        saveHistory: async (sessionId, messages) => {
          saves.push({ sessionId, messages });
        },
      },
      { sessionId: "sess_session_s1" },
    );
    let text = "";
    for await (const ev of engine.streamTurn("say hi", { useTools: true })) {
      if (ev._tag === "TextDelta") text += ev.text;
    }
    // Event tee: the yielded stream accumulates the same text the terminal
    // event carries (events passed through unaltered).
    expect(text).toBe("hello");
    // Assistant turn recorded from StreamCompleted and persisted via saveHistory.
    expect(saves).toHaveLength(1);
    expect(saves[0]!.sessionId).toBe("sess_session_s1");
    expect(
      saves[0]!.messages.some((m) => m.content === "hello" && m.role === "assistant"),
    ).toBe(true);
    // Symmetric recording: the user turn rides next to the assistant turn.
    expect(saves[0]!.messages.some((m) => m.content === "say hi" && m.role === "user")).toBe(true);
  });

  it("streamTurn without runStreamTask is a typed rejection naming the capability", () => {
    const engine = new ChatEngine(
      { complete: async () => ({ message: "x" }) },
      { sessionId: "sess_session_s1" },
    );
    expect(() => engine.streamTurn("hi")).toThrow(/runStreamTask/);
    // Typed rejection — never a raw untagged Error (package error pool stays flat).
    let caught: unknown;
    try {
      engine.streamTurn("hi");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChatEngineCapabilityError);
  });
});
