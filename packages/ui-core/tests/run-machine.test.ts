import { describe, expect, test } from "bun:test";
import { initialRunState, reduceRunState } from "../src/state/run-machine.js";
import type { SeqStamped, UiStreamEvent } from "../src/protocol/events.js";

const feed = (events: SeqStamped<UiStreamEvent>[], objectMode = false) =>
  events.reduce((s, e) => reduceRunState(s, e, { objectMode }), initialRunState());

describe("reduceRunState", () => {
  test("accumulates text and completes", () => {
    const s = feed([
      { _tag: "TextDelta", text: "he", seq: 1 },
      { _tag: "TextDelta", text: "llo", seq: 2 },
      { _tag: "StreamCompleted", output: "hello", metadata: { cost: 0.01, tokensUsed: 42 }, runId: "r1", seq: 3 },
    ]);
    expect(s.status).toBe("completed");
    expect(s.text).toBe("hello");
    expect(s.output).toBe("hello");
    expect(s.runId).toBe("r1");
    expect(s.lastSeq).toBe(3);
    expect(s.cost).toEqual({ tokens: 42, usd: 0.01 });
  });

  test("interaction pause", () => {
    const s = feed([
      { _tag: "TextDelta", text: "thinking", seq: 1 },
      {
        _tag: "InteractionRequested",
        runId: "r1",
        interactionId: "i1",
        kind: "choice",
        prompt: "pick",
        schema: { options: ["a", "b"] },
        seq: 2,
      },
      { _tag: "RunPaused", runId: "r1", reason: "awaiting-interaction", seq: 3 },
    ]);
    expect(s.status).toBe("awaiting-interaction");
    expect(s.pendingInteraction?.interactionId).toBe("i1");
  });

  test("approval pause via ApprovalRequested", () => {
    const s = feed([
      { _tag: "ApprovalRequested", runId: "r1", gateId: "g1", toolName: "shell", args: { cmd: "rm" }, seq: 1 },
      { _tag: "RunPaused", runId: "r1", reason: "awaiting-approval", seq: 2 },
    ]);
    expect(s.status).toBe("awaiting-approval");
    expect(s.pendingApproval?.gateId).toBe("g1");
  });

  test("objectMode derives partial object from text", () => {
    const s = feed(
      [
        { _tag: "TextDelta", text: '{"name":"Ada","sco', seq: 1 },
        { _tag: "TextDelta", text: 're":9}', seq: 2 },
      ],
      true,
    );
    expect(s.object).toEqual({ name: "Ada", score: 9 });
  });

  test("abstention and error terminal states", () => {
    const a = feed([
      { _tag: "Abstained", reason: "missing tool", missing: ["db"], seq: 1 },
      { _tag: "StreamCompleted", output: "", metadata: {}, seq: 2 },
    ]);
    expect(a.abstention?.reason).toBe("missing tool");
    expect(a.status).toBe("completed");

    const e = feed([{ _tag: "StreamError", cause: "boom", seq: 1 }]);
    expect(e.status).toBe("error");
    expect(e.error).toBe("boom");
  });

  test("RunAttached restores runId and cursor", () => {
    const s = feed([
      { _tag: "RunAttached", runId: "r7", status: "awaiting-interaction", resumeCursor: 12, protocolVersion: 1, seq: 12 },
    ]);
    expect(s.runId).toBe("r7");
    expect(s.lastSeq).toBe(12);
  });

  test("LimitExceeded is a terminal error state", () => {
    const s = feed([{ _tag: "LimitExceeded", kind: "budget", seq: 1 }]);
    expect(s.status).toBe("error");
    expect(s.error).toContain("budget");
  });
});
