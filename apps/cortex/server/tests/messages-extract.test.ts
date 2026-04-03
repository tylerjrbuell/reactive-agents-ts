import { describe, expect, it } from "bun:test";
import { extractReasoningStepDisplayMessages } from "../../messages-extract.js";

describe("extractReasoningStepDisplayMessages", () => {
  it("uses non-empty messages[] when present", () => {
    const msgs = [{ role: "user" as const, content: "hi" }];
    const out = extractReasoningStepDisplayMessages({
      messages: msgs,
      thought: "ignored when messages set",
    });
    expect(out).toEqual(msgs);
  });

  it("falls back from empty messages[] to thought/action/observation", () => {
    const out = extractReasoningStepDisplayMessages({
      messages: [],
      thought: "T",
      action: "A",
      observation: "O",
    });
    expect(out.map((m) => m.role)).toEqual(["assistant", "assistant", "tool"]);
  });

  it("includes prompt system and user before thought", () => {
    const out = extractReasoningStepDisplayMessages({
      prompt: { system: "SYS", user: "USR" },
      thought: "TH",
    });
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
  });
});
