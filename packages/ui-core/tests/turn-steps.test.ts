import { describe, expect, test } from "bun:test";
import {
  buildTurnSteps,
  failureReason,
  finishTurnTrace,
  foldTurnTrace,
  initialTurnTrace,
  persistedTurnStepsOf,
  summarizeTurn,
  turnStepsOf,
  type UiStreamEvent,
} from "../src/index.js";

const run = (events: UiStreamEvent[]) => events.reduce(foldTurnTrace, initialTurnTrace());
const meta = { duration: 1, cost: 0, tokensUsed: 1, stepsCount: 1 };

const progress = (iteration: number): UiStreamEvent => ({ _tag: "IterationProgress", iteration, maxIterations: 10, status: "r" });
// The runtime projects ThoughtEmitted.iteration from the kernel STEP index, not the iteration.
const thought = (step: number, content: string): UiStreamEvent => ({ _tag: "ThoughtEmitted", iteration: step, content });
const thinking = (iteration: number, content: string): UiStreamEvent => ({ _tag: "ThinkingEmitted", iteration, content });
const call = (id: string, toolName: string, ok: boolean, error?: string): UiStreamEvent[] => [
  { _tag: "ToolCallStarted", toolName, callId: id },
  { _tag: "ToolCallCompleted", toolName, callId: id, durationMs: 10, success: ok, ...(error ? { error } : {}) },
];

const T2_THINK = 'Found the docs site: "Reactive Agents Documentation". Let me get the daterange first.';
const T2_SAY = "Found your docs site: **Reactive Agents Documentation**. Let me pull its analytics.";
const T3 = "The site only has data from 2026-03-08 onward. Let me pull the full picture.";
const T5 = 'The get_website_metrics tool has different semantics. Let me call it with type="path".';
const T6 = "I've been getting a traffic snapshot and path breakdown. Let me pull sessions and events for the period.";
const MISSING_TYPE =
  '[Tool error: Missing required parameter "type" → Check argument format.]\n\n[Recovery guidance: umami/get_website_metrics rejected its arguments (parameter "type").]';
const BAD_OPTION = '[Tool error: MCP tool get_website_metrics failed: Input validation error: type: Invalid option: expected one of "path"|"entry"]';

/**
 * Trace 01M73GNDMGG0TMZD9JS78NASAC (Cortex chat, mimo-v2.6 on Ollama, 2026-11-10),
 * in the order the bus delivered it: ThoughtEmitted carries step indexes 2, 6, 10,
 * 16, 29, 33; the run ended llm_error with the last narration as its output.
 */
const umamiTurn: UiStreamEvent[] = [
  thought(2, "I'll start by finding your umami docs site in the workspace."),
  progress(0),
  ...call("c1", "umami/list_websites", true),
  progress(1),
  thinking(1, "Let me try listing all websites without search."),
  thought(6, "Let me try listing all websites without search."),
  progress(1),
  ...call("c2", "umami/list_websites", true),
  progress(2),
  thinking(2, T2_THINK),
  thought(10, T2_SAY),
  progress(2),
  ...call("c3", "umami/get_website_daterange", true),
  ...call("c4", "umami/get_website_stats", true),
  progress(3),
  thinking(3, T3),
  thought(16, T3),
  progress(3),
  ...call("c5", "umami/get_website_traffic", true),
  ...call("c6", "umami/get_website_metrics", false, MISSING_TYPE),
  progress(4),
  progress(4),
  ...call("c7", "umami/get_website_metrics", false, BAD_OPTION),
  ...call("c8", "umami/get_website_metrics", false, BAD_OPTION),
  progress(5),
  thinking(5, T5),
  thought(29, T5),
  progress(5),
  ...call("c9", "umami/get_website_metrics", true),
  progress(6),
  thinking(6, T6),
  thought(33, T6),
  progress(6),
  ...call("c10", "umami/get_sessions", true),
  ...call("c11", "umami/get_events", true),
  progress(7),
  thinking(7, "I need to continue the analysis."),
  progress(7),
  { _tag: "ContextPressure", tokensUsed: 7496, tokensAvailable: 696, utilizationPct: 91, level: "critical" },
  { _tag: "StreamCompleted", output: T6, metadata: meta, success: false } as UiStreamEvent,
];

describe("turn steps: the 01M73GND umami turn", () => {
  const s = run(umamiTurn);
  const steps = turnStepsOf(s);

  test("no phantom steps: step-index thoughts are filed under the fold's iteration", () => {
    expect(steps.flatMap((x) => x.iterations)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Object.keys(s.thoughts).map(Number).every((i) => i <= 7)).toBe(true);
    // The pre-progress thought lands on iteration 0, not the provisional cursor 1.
    expect(steps[0]!.narration).toBe("I'll start by finding your umami docs site in the workspace.");
  });

  test("retries group into one step with failure reasons linked to the fix", () => {
    const metrics = steps.find((x) => x.iterations.includes(4))!;
    expect(metrics.iterations).toEqual([3, 4, 5]);
    expect(metrics.label).toBe("get_website_traffic, get_website_metrics ×4 · 3 failed → ok");
    expect(metrics.failures.map((f) => f.fixedBy)).toEqual([
      { callId: "c9", step: metrics.n },
      { callId: "c9", step: metrics.n },
      { callId: "c9", step: metrics.n },
    ]);
    expect(metrics.failures[0]!.reason).toBe('Missing required parameter "type" → Check argument format.');
    expect(metrics.status).toBe("done");
    expect(steps).toHaveLength(6);
  });

  test("labels are actions, never thinking; narration equal to thinking is dropped", () => {
    for (const step of steps) {
      expect(step.label).not.toBe(step.thinking);
      if (step.narration !== undefined) expect(step.narration).not.toBe(step.thinking);
    }
    expect(steps[1]!.label).toBe("list_websites");
    expect(steps[1]!.narration).toBeUndefined();
    expect(steps[1]!.thinking).toBe("Let me try listing all websites without search.");
    expect(steps[2]!.narration).toBe(T2_SAY);
    expect(steps[5]!.label).toBe("No tool call");
  });

  test("summary counts steps, calls, failures, outcome and context in use", () => {
    const sum = summarizeTurn(steps, { ...(s.ended ? { ended: s.ended } : {}), ...(s.context ? { context: s.context } : {}) });
    expect(sum).toMatchObject({ steps: 6, toolCalls: 11, tools: 7, failures: 3, recovered: 3, outcome: "failed" });
    expect(sum.line).toBe("6 steps · 11 calls (7 tools) · 3 failed, 3 fixed · failed · context 7.5k / 8.2k");
  });

  test("the persisted trace rebuilds the same steps after a reload", () => {
    const persisted = finishTurnTrace(s)!;
    expect(persisted.context).toEqual({ tokensUsed: 7496, peakTokens: 7496, windowTokens: 8192 });
    const reloaded = persistedTurnStepsOf(persisted, s.answer);
    expect(reloaded.map((x) => [x.label, x.narration, x.thinking])).toEqual(steps.map((x) => [x.label, x.narration, x.thinking]));
  });
});

describe("buildTurnSteps rules", () => {
  test("narration repeating an earlier step collapses to a reference", () => {
    const steps = buildTurnSteps({
      iterations: [
        { iteration: 1, narration: "Let me check the sessions." },
        { iteration: 2, narration: "Let me  check the sessions." },
      ],
      calls: [
        { id: "a", name: "get_sessions", status: "done", iteration: 1 },
        { id: "b", name: "get_events", status: "done", iteration: 2 },
      ],
    });
    expect(steps[1]).toMatchObject({ sameAsStep: 1, label: "get_events" });
    expect(steps[1]!.narration).toBeUndefined();
  });

  test("an unfixed failure marks the step failed with no fix link; narration equal to the answer is dropped", () => {
    const steps = buildTurnSteps({
      iterations: [{ iteration: 1, narration: "Done." }],
      calls: [{ id: "a", name: "srv/fetch", status: "failed", iteration: 1, error: "timeout" }],
      answer: "Done.",
    });
    expect(steps[0]).toMatchObject({ status: "failed", label: "fetch · 1 failed" });
    expect(steps[0]!.failures).toEqual([{ callId: "a", tool: "srv/fetch", reason: "timeout" }]);
    expect(steps[0]!.narration).toBeUndefined();
  });

  test("legacy persisted steps (thought only) read as narration", () => {
    const steps = persistedTurnStepsOf({ reasoningSteps: [{ iteration: 1, thought: "old text" }], toolCalls: [] });
    expect(steps[0]).toMatchObject({ narration: "old text", label: "No tool call" });
  });

  test("failureReason strips wrapping and guidance", () => {
    expect(failureReason(MISSING_TYPE)).toBe('Missing required parameter "type" → Check argument format.');
    expect(failureReason(undefined)).toBe("failed (no error reported)");
  });
});
