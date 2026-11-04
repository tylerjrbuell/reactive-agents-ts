import { describe, expect, test } from "bun:test";
import { buildSteps, buildTimeline, previewArgs } from "./chat-timeline.js";

describe("buildSteps", () => {
  test("one step per model turn: thought + its calls, tool counts, summed time, failure count", () => {
    const steps = buildSteps({
      reasoningSteps: [
        { iteration: 1, maxIterations: 5, thought: "I need prices for four coins. Search each one." },
        { iteration: 2, maxIterations: 5, thought: "All four found.\nBuild the table." },
      ],
      toolCalls: [
        { id: "a", name: "web-search", status: "done", iteration: 1, durationMs: 1400 },
        { id: "b", name: "web-search", status: "failed", iteration: 1, durationMs: 1500, error: "x" },
        { id: "c", name: "http-get", status: "done", iteration: 1, durationMs: 100 },
      ],
    });
    expect(steps.map((s) => [s.n, s.key, s.summary, s.status, s.durationMs, s.failedCount])).toEqual([
      [1, "i1", "I need prices for four coins.", "failed", 3000, 1],
      [2, "i2", "All four found.", "done", undefined, 0],
    ]);
    expect(steps[0]!.tools).toEqual([{ name: "web-search", count: 2 }, { name: "http-get", count: 1 }]);
  });

  test("calls with no thought summarize what was called; a running call marks the step running", () => {
    const steps = buildSteps({
      toolCalls: [
        { id: "a", name: "web-search", status: "done", iteration: 1 },
        { id: "b", name: "web-search", status: "running", iteration: 1 },
      ],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]!.summary).toBe("Called web-search ×2");
    expect(steps[0]!.status).toBe("running");
  });
});

describe("buildTimeline", () => {
  test("orders thought before the tools of the same iteration, iterations ascending", () => {
    const items = buildTimeline({
      reasoningSteps: [
        { iteration: 2, maxIterations: 5, thought: "now summarise" },
        { iteration: 1, maxIterations: 5, thought: "search first" },
      ],
      toolCalls: [
        { id: "b", name: "http-get", status: "done", iteration: 2 },
        { id: "a", name: "web-search", status: "done", iteration: 1 },
      ],
    });
    expect(items.map((i) => (i.kind === "thought" ? `t${i.iteration}` : i.call.id))).toEqual(["t1", "a", "t2", "b"]);
  });

  test("tool call without a thought still appears; blank thoughts are dropped; unknown iteration trails", () => {
    const items = buildTimeline({
      reasoningSteps: [{ iteration: 1, maxIterations: 3, thought: "   " }],
      toolCalls: [
        { id: "late", name: "x", status: "running" },
        { id: "a", name: "web-search", status: "failed", iteration: 1, error: "boom" },
      ],
    });
    expect(items.map((i) => (i.kind === "tool" ? i.call.id : "thought"))).toEqual(["a", "late"]);
  });

  test("previewArgs stringifies and truncates", () => {
    expect(previewArgs({ q: "hi" })).toBe('{"q":"hi"}');
    expect(previewArgs("x".repeat(100), 10)).toBe("xxxxxxxxxx…");
    expect(previewArgs(undefined)).toBe("");
  });
});

describe("hydrateTurn", () => {
  test("restores persisted thinking + tool calls so a reloaded turn renders a timeline", async () => {
    const { hydrateTurn } = await import("./chat-store.js");
    const turn = hydrateTurn({
      id: 1,
      role: "assistant",
      content: "done",
      tokensUsed: 5,
      ts: 0,
      trace: {
        reasoningSteps: [{ iteration: 1, thought: "search first" }],
        toolCalls: [{ id: "c1", name: "web-search", status: "done", iteration: 1, args: { q: "x" }, result: "r" }],
      },
    });
    const items = buildTimeline(turn);
    expect(items.map((i) => i.kind)).toEqual(["thought", "tool"]);
    expect((items[1] as { call: { args: unknown } }).call.args).toEqual({ q: "x" });
    expect("trace" in turn).toBe(false);
  });
});

describe("capFrameText", () => {
  test("caps runaway text with an explicit marker; leaves normal text alone", async () => {
    const { capFrameText } = await import("./trace-store.js");
    expect(capFrameText("abc", 10)).toBe("abc");
    expect(capFrameText("x".repeat(15), 10)).toBe("xxxxxxxxxx\n…[truncated 5 chars]");
  });
});
