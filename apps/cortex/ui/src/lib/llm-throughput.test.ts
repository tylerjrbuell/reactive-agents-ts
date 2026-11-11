import { describe, expect, it } from "bun:test";
import { get, writable } from "svelte/store";
import { throughputOfCalls } from "@reactive-agents/ui-core";
import { liveRateText, throughputSampleOf, throughputView } from "./llm-throughput.js";
import { speedStats } from "./model-page.js";
import { createTraceStore, type CortexTraceFrame } from "./stores/trace-store.js";
import { updateVitals, type CortexLiveMsg, type RunState, type RunVitals } from "./stores/run-store.js";

const ev = (type: string, payload: Record<string, unknown>, ts = 1): CortexLiveMsg => ({ ts, agentId: "a", runId: "r", type, payload });

describe("throughputSampleOf", () => {
  it("reads the throughput fields of a stored LLMRequestCompleted payload", () => {
    expect(throughputSampleOf({ durationMs: 1500, tokensOut: 100, firstTokenMs: 500, model: "m" })).toEqual({
      durationMs: 1500,
      tokensOut: 100,
      firstTokenMs: 500,
    });
    expect(throughputSampleOf({ durationMs: 900 })).toEqual({ durationMs: 900 });
    expect(throughputSampleOf({ tokensOut: 5 })).toBeUndefined();
  });
});

describe("throughputView", () => {
  it("words an exact rate with TTFT", () => {
    const v = throughputView({ tokensPerSecond: 100, firstTokenMs: 320, lowerBound: false, calls: 1 });
    expect(v?.text).toBe("100 tok/s");
    expect(v?.ttft).toBe("TTFT 320ms");
    expect(v?.title).toBe("Output speed 100 tok/s over one model call · first token after 320ms");
  });

  it("marks a lower bound ~ and explains it", () => {
    const v = throughputView({ tokensPerSecond: 50, lowerBound: true, calls: 2 });
    expect(v?.text).toBe("~50 tok/s");
    expect(v?.ttft).toBeUndefined();
    expect(v?.title).toContain("At least this fast");
  });

  it("is undefined without a figure; the live text is always ~", () => {
    expect(throughputView(undefined)).toBeUndefined();
    expect(liveRateText(undefined)).toBeUndefined();
    expect(liveRateText(12.3)).toBe("~12 tok/s");
  });
});

describe("trace rows carry per-loop speed", () => {
  const framesOf = (events: CortexLiveMsg[]): CortexTraceFrame[] =>
    get(createTraceStore(writable({ events } as unknown as RunState)));

  it("each loop gets the speed of its own calls, and a folded duplicate iteration merges its calls", () => {
    const frames = framesOf([
      ev("LLMRequestCompleted", { tokensUsed: 300, tokensOut: 100, durationMs: 1500, firstTokenMs: 500 }),
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("LLMRequestCompleted", { tokensUsed: 300, tokensOut: 100, durationMs: 1200, firstTokenMs: 200 }),
      ev("ReasoningIterationProgress", { iteration: 2 }),
      ev("LLMRequestCompleted", { tokensUsed: 300, tokensOut: 300, durationMs: 1400, firstTokenMs: 400 }),
      ev("ReasoningIterationProgress", { iteration: 2 }),
    ]);
    expect(frames).toHaveLength(2);
    expect(frames[0]?.throughput).toEqual({ tokensPerSecond: 100, firstTokenMs: 500, lowerBound: false, calls: 1 });
    // loop 2 = two calls, 400 out over 2000 ms
    expect(frames[1]?.throughput).toEqual({ tokensPerSecond: 200, firstTokenMs: 300, lowerBound: false, calls: 2 });
  });

  it("a loop with no timed call has no speed", () => {
    const frames = framesOf([ev("LLMRequestCompleted", { tokensUsed: 10 }), ev("ReasoningIterationProgress", { iteration: 1 })]);
    expect(frames[0]?.throughput).toBeUndefined();
    expect(frames[0]?.llmCalls).toBeUndefined();
  });

  it("the final answer row gets the calls after the last loop", () => {
    const frames = framesOf([
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("LLMRequestCompleted", { tokensUsed: 50, tokensOut: 50, durationMs: 1000 }),
      ev("FinalAnswerProduced", { answer: "done" }),
    ]);
    expect(frames.at(-1)?.kind).toBe("final");
    expect(frames.at(-1)?.throughput).toEqual({ tokensPerSecond: 50, lowerBound: true, calls: 1 });
  });
});

describe("run vitals average speed", () => {
  const base: RunVitals = {
    entropy: 0,
    trajectory: "EXPLORING",
    tokensUsed: 0,
    cost: 0,
    durationMs: 0,
    loopIteration: 0,
    reasoningSteps: 0,
    maxIterations: 0,
  };
  it("collects every call so the run average is over all of them", () => {
    let v = updateVitals(base, ev("LLMRequestCompleted", { tokensUsed: 1, tokensOut: 100, durationMs: 1500, firstTokenMs: 500 }), 0);
    v = updateVitals(v, ev("LLMRequestCompleted", { tokensUsed: 1, tokensOut: 300, durationMs: 1400, firstTokenMs: 400 }), 0);
    expect(v.llmCalls).toHaveLength(2);
    expect(throughputOfCalls(v.llmCalls ?? [])?.tokensPerSecond).toBe(200);
  });
});

describe("speedStats (Model page)", () => {
  it("shows median speed and TTFT, ~ for a lower-bound median", () => {
    expect(speedStats({ runs: 3, tokensPerSecond: { median: 42.4, lowerBound: false, calls: 7 }, firstTokenMs: { median: 640, calls: 7 } }).map((i) => [i.label, i.value])).toEqual([
      ["Median speed", "42 tok/s"],
      ["Median first token", "640ms"],
    ]);
    const lb = speedStats({ runs: 1, tokensPerSecond: { median: 20, lowerBound: true, calls: 2 } });
    expect(lb[0]?.value).toBe("~20 tok/s");
    expect(lb[0]?.title).toContain("At least this fast");
    expect(speedStats(null)).toEqual([]);
    expect(speedStats({ runs: 0 })).toEqual([]);
  });
});
