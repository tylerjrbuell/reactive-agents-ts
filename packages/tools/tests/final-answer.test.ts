import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  type FinalAnswerVisibility,
} from "../src/skills/final-answer.js";

describe("finalAnswerTool", () => {
  it("has correct tool shape", () => {
    expect(finalAnswerTool.name).toBe("final-answer");
    expect(finalAnswerTool.parameters.map((p) => p.name)).toContain("output");
    expect(finalAnswerTool.parameters.map((p) => p.name)).toContain("format");
    expect(finalAnswerTool.parameters.map((p) => p.name)).toContain("summary");
  });

  it("accepts valid json format", async () => {
    const handler = makeFinalAnswerHandler({ canComplete: true });
    const result = await Effect.runPromise(
      handler({ output: '{"key":"value"}', format: "json", summary: "done" })
    );
    expect((result as any).accepted).toBe(true);
    expect((result as any).format).toBe("json");
  });

  it("rejects invalid json when format is json", async () => {
    const handler = makeFinalAnswerHandler({ canComplete: true });
    const result = await Effect.runPromise(
      handler({ output: "not valid json{", format: "json", summary: "done" })
    );
    expect((result as any).accepted).toBe(false);
    expect((result as any).error).toContain("invalid JSON");
  });

  it("accepts text format without validation", async () => {
    const handler = makeFinalAnswerHandler({ canComplete: true });
    const result = await Effect.runPromise(
      handler({ output: "anything goes here", format: "text", summary: "done" })
    );
    expect((result as any).accepted).toBe(true);
  });

  it("rejects when canComplete is false", async () => {
    const handler = makeFinalAnswerHandler({
      canComplete: false,
      pendingTools: ["github/list_commits"],
    });
    const result = await Effect.runPromise(
      handler({ output: "early", format: "text", summary: "not done" })
    );
    expect((result as any).accepted).toBe(false);
    expect((result as any).error).toContain("github/list_commits");
  });

  it("stores _capture with output/format/summary/confidence", async () => {
    const handler = makeFinalAnswerHandler({ canComplete: true });
    const result = await Effect.runPromise(
      handler({ output: "result text", format: "text", summary: "did the thing", confidence: "high" })
    ) as any;
    expect(result.accepted).toBe(true);
    expect(result._capture.output).toBe("result text");
    expect(result._capture.format).toBe("text");
    expect(result._capture.summary).toBe("did the thing");
    expect(result._capture.confidence).toBe("high");
  });

  describe("shouldShowFinalAnswer", () => {
    const base: FinalAnswerVisibility = {
      requiredToolsCalled: new Set(["github/list_commits"]),
      requiredTools: ["github/list_commits"],
      iteration: 3,
      hasErrors: false,
      hasNonMetaToolCalled: true,
    };

    it("shows when all conditions met", () => {
      expect(shouldShowFinalAnswer(base)).toBe(true);
    });

    it("hides before iteration 2", () => {
      expect(shouldShowFinalAnswer({ ...base, iteration: 1 })).toBe(false);
    });

    it("hides when required tool not called", () => {
      expect(shouldShowFinalAnswer({ ...base, requiredToolsCalled: new Set() })).toBe(false);
    });

    it("hides when errors pending", () => {
      expect(shouldShowFinalAnswer({ ...base, hasErrors: true })).toBe(false);
    });

    it("hides when no non-meta tool called yet", () => {
      expect(shouldShowFinalAnswer({ ...base, hasNonMetaToolCalled: false })).toBe(false);
    });

    it("shows when no required tools configured (empty array)", () => {
      expect(shouldShowFinalAnswer({ ...base, requiredTools: [], requiredToolsCalled: new Set() })).toBe(true);
    });
  });
});
