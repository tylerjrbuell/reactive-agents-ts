// Run: bun test packages/runtime/tests/chat-engine-serialization.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../src/chat/engine.js";
import type { RunHandle } from "../src/run-controller.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

/** Manually-resolved gate so a test controls when a model call returns. */
function deferred(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

function rows(engine: ChatEngine): string[] {
  return engine.history().map((m) => `${m.role}:${m.content}`);
}

describe("ChatEngine serializes turns per engine (audit F18)", () => {
  it("concurrent turn() calls record turn1-pair then turn2-pair, never interleaved", async () => {
    const gate = deferred();
    const seenHistoryLengths: number[] = [];
    const engine = new ChatEngine(
      {
        complete: async ({ messages }) => {
          seenHistoryLengths.push(messages.length);
          const last = messages[messages.length - 1]!.content;
          if (last === "one") await gate.promise; // turn 1 is slow, turn 2 would race past it
          return { message: `re:${last}` };
        },
      },
      { sessionId: "sess_serial" },
    );
    const p1 = engine.turn("one");
    const p2 = engine.turn("two");
    await tick();
    expect(seenHistoryLengths).toEqual([1]); // turn 2 has not started its model call
    gate.open();
    await Promise.all([p1, p2]);
    expect(rows(engine)).toEqual(["user:one", "assistant:re:one", "user:two", "assistant:re:two"]);
    expect(seenHistoryLengths).toEqual([1, 3]); // turn 2 saw turn 1's pair
  });

  it("a failed first turn releases the gate so the second proceeds", async () => {
    const engine = new ChatEngine(
      {
        complete: async ({ messages }) => {
          const last = messages[messages.length - 1]!.content;
          if (last === "boom") throw new Error("model down");
          return { message: `re:${last}` };
        },
      },
      { sessionId: "sess_release" },
    );
    const p1 = engine.turn("boom");
    const p2 = engine.turn("two");
    await expect(p1).rejects.toThrow("model down");
    await p2;
    expect(rows(engine)).toEqual(["user:two", "assistant:re:two"]);
  });

  it("streamTurn holds the gate to stream end; a concurrent turn() queues behind it", async () => {
    const gate = deferred();
    const handle = (): RunHandle => {
      async function* events(): AsyncGenerator<AgentStreamEvent> {
        await gate.promise;
        yield { _tag: "StreamCompleted", output: "streamed", taskId: "t1", metadata: { duration: 0, cost: 0, tokensUsed: 1, stepsCount: 1 } };
      }
      return Object.assign(events(), {
        pause: () => {},
        resume: () => {},
        stop: (_o?: { reason?: string }) => {},
        terminate: (_o?: { reason?: string }) => {},
        status: () => "running" as const,
        inspect: () => undefined,
      });
    };
    const engine = new ChatEngine(
      { complete: async ({ messages }) => ({ message: `re:${messages[messages.length - 1]!.content}` }), runStreamTask: () => handle() },
      { sessionId: "sess_stream" },
    );
    const drain = (async () => {
      for await (const _ of engine.streamTurn("s1")) void _;
    })();
    await tick();
    const direct = engine.turn("d2");
    await tick();
    expect(rows(engine)).toEqual([]); // direct turn is queued, stream not yet recorded
    gate.open();
    await Promise.all([drain, direct]);
    expect(rows(engine)).toEqual(["user:s1", "assistant:streamed", "user:d2", "assistant:re:d2"]);
  });

  it("an abandoned stream (consumer returns early) releases the gate", async () => {
    const engine = new ChatEngine(
      {
        complete: async ({ messages }) => ({ message: `re:${messages[messages.length - 1]!.content}` }),
        runStreamTask: () => {
          async function* events(): AsyncGenerator<AgentStreamEvent> {
            yield { _tag: "TextDelta", text: "x" };
            yield { _tag: "TextDelta", text: "y" };
          }
          return Object.assign(events(), {
            pause: () => {},
            resume: () => {},
            stop: (_o?: { reason?: string }) => {},
            terminate: (_o?: { reason?: string }) => {},
            status: () => "running" as const,
            inspect: () => undefined,
          });
        },
      },
      { sessionId: "sess_abandon" },
    );
    for await (const _ of engine.streamTurn("s")) {
      void _;
      break;
    }
    await engine.turn("after");
    expect(rows(engine)).toEqual(["user:after", "assistant:re:after"]);
  });
});
