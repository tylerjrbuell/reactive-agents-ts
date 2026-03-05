import { describe, it, expect } from "bun:test";
import type { AgentStreamEvent, StreamDensity } from "../src/stream-types.js";

describe("AgentStreamEvent types", () => {
  it("TextDelta has _tag and text", () => {
    const e: AgentStreamEvent = { _tag: "TextDelta", text: "hello" };
    expect(e._tag).toBe("TextDelta");
  });

  it("StreamCompleted carries output and metadata", () => {
    const e: AgentStreamEvent = {
      _tag: "StreamCompleted",
      output: "result",
      metadata: { duration: 100, cost: 0, tokensUsed: 50, stepsCount: 1 },
    };
    expect(e._tag).toBe("StreamCompleted");
  });

  it("StreamError carries cause", () => {
    const e: AgentStreamEvent = { _tag: "StreamError", cause: "timeout" };
    expect(e.cause).toBe("timeout");
  });

  it("StreamDensity is tokens or full", () => {
    const d1: StreamDensity = "tokens";
    const d2: StreamDensity = "full";
    expect(d1).toBe("tokens");
    expect(d2).toBe("full");
  });
});
