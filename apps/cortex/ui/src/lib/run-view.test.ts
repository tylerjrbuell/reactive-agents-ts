import { describe, expect, it } from "bun:test";
import {
  answerWithheld,
  entropySeriesOf,
  inspectorTabsOf,
  loopsLabel,
  loopsVitalLabel,
  replayLoopCount,
  replaySlice,
  runHeaderStatus,
  runTaskOf,
  runTitleOf,
  taskHeadline,
  trajectoryView,
} from "./run-view.js";
import { beaconDeskRunLabel } from "./stores/agent-store.js";

const ev = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload });

describe("runTitleOf", () => {
  it("prefers the run's label", () => {
    expect(runTitleOf({ displayName: "  release-bot  ", task: "do x", runId: "01ABCDEFGH" })).toBe("release-bot");
  });
  it("falls back to the first line of the task, clipped", () => {
    expect(runTitleOf({ task: "Explain hash functions\nwith examples", runId: "01ABCDEFGH" })).toBe("Explain hash functions");
    const long = "x".repeat(120);
    const t = runTitleOf({ task: long, runId: "01ABCDEFGH" });
    expect(t.length).toBe(80);
    expect(t.endsWith("…")).toBe(true);
  });
  it("never uses a bare ULID label as the name (chat runs store the agent id)", () => {
    expect(runTitleOf({ displayName: "01M7464PWBHXNK7FFAK7C96681", chatSessionName: "Release notes", runId: "01ABCDEFGH" })).toBe("Release notes");
    expect(runTitleOf({ displayName: "01M7464PWBHXNK7FFAK7C96681", task: "Do it", runId: "01ABCDEFGH" })).toBe("Do it");
  });
  it("never uses a label equal to the agent id (same rule as runNameOf)", () => {
    expect(runTitleOf({ displayName: "agent-9", agentId: "agent-9", task: "Summarise the logs", runId: "01ABCDEFGH" })).toBe("Summarise the logs");
    expect(runTitleOf({ displayName: " agent-9 ", agentId: "agent-9", runId: "01ABCDEFGHJK" })).toBe("Run 01ABCDEFGHJK");
    expect(runTitleOf({ displayName: "release-bot", agentId: "agent-9", runId: "01ABCDEFGH" })).toBe("release-bot");
  });
  it("names the run by its id last", () => {
    expect(runTitleOf({ runId: "01ABCDEFGHJK" })).toBe("Run 01ABCDEFGHJK");
  });
  it("titles a chat turn by its current message, not the history block (2026-11-11 QA)", () => {
    const task =
      "--- Conversation history ---\nUser: What tools do you have?\nAssistant: Three.\n\n--- Current message ---\nPick a multipart deep dive\nand run it";
    expect(runTitleOf({ task, runId: "01ABCDEFGH" })).toBe("Pick a multipart deep dive");
    expect(beaconDeskRunLabel({ task, agentId: "a", runId: "01ABCDEFGH" })).toBe("Pick a multipart deep dive");
    expect(taskHeadline("  plain task  \nmore")).toBe("plain task");
  });
});

describe("runTaskOf", () => {
  it("reads the first AgentStarted task", () => {
    expect(runTaskOf([ev("TaskCreated"), ev("AgentStarted", { task: " Hello " }), ev("AgentStarted", { task: "child" })])).toBe("Hello");
  });
  it("is undefined when no emitter stamped it", () => {
    expect(runTaskOf([ev("AgentStarted", {})])).toBeUndefined();
  });
});

describe("replay", () => {
  const events = [ev("AgentStarted"), ev("ReasoningIterationProgress"), ev("ToolCallStarted"), ev("ReasoningIterationProgress"), ev("AgentCompleted")];
  it("counts loop boundaries", () => {
    expect(replayLoopCount(events)).toBe(2);
  });
  it("counts an iteration the kernel reported twice in a row as one loop (2026-11-11 QA)", () => {
    const twice = [
      ev("ReasoningIterationProgress", { iteration: 0 }),
      ev("ReasoningIterationProgress", { iteration: 1, toolsThisStep: ["todo"] }),
      ev("ToolCallCompleted"),
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("ReasoningIterationProgress", { iteration: 2 }),
    ];
    expect(replayLoopCount(twice)).toBe(3);
    expect(replaySlice(twice, 2)).toHaveLength(4);
  });
  it("slices through the nth boundary", () => {
    expect(replaySlice(events, 1).map((e) => e.type)).toEqual(["AgentStarted", "ReasoningIterationProgress"]);
    expect(replaySlice(events, 2)).toHaveLength(4);
  });
  it("shows everything past the last boundary", () => {
    expect(replaySlice(events, 5)).toHaveLength(5);
    expect(replaySlice(events, 0)).toHaveLength(5);
  });
  it("names reported and traced loops when they differ (header said 'Loops 2 of 3', trace 'Loops 1')", () => {
    expect(loopsVitalLabel(2, 3, 1)).toBe("Loops 2 of 3 · 1 traced");
    expect(loopsVitalLabel(1, 4, 1)).toBe("Loops 1 of 4");
    expect(loopsVitalLabel(8, 4, 4)).toBe("Loops 8 · 4 traced");
    expect(loopsVitalLabel(0, 0, 0)).toBe("Loops");
    expect(loopsVitalLabel(2, 3, 2, { loop: 1, max: 2 })).toBe("Replay 1 of 2");
  });
  it("pluralizes the loop count (spec: 'Replay (1 events)')", () => {
    expect(loopsLabel(1)).toBe("1 loop");
    expect(loopsLabel(3)).toBe("3 loops");
  });
});

describe("inspectorTabsOf", () => {
  it("lists the inspector tabs in spec order, with no Chat tab", () => {
    expect(inspectorTabsOf({ messages: 0, events: 0 }).map((t) => t.id)).toEqual([
      "summary",
      "safety",
      "decisions",
      "signal",
      "context",
      "memory",
      "messages",
      "events",
    ]);
  });
  it("counts messages and events when there are any", () => {
    const tabs = inspectorTabsOf({ messages: 3, events: 62 });
    expect(tabs.find((t) => t.id === "messages")?.count).toBe(3);
    expect(tabs.find((t) => t.id === "events")?.count).toBe(62);
    expect(inspectorTabsOf({ messages: 0, events: 0 }).find((t) => t.id === "events")?.count).toBeUndefined();
  });
  it("counts safety events that fired; none shows no count", () => {
    expect(inspectorTabsOf({ messages: 0, events: 9, safety: 2 }).find((t) => t.id === "safety")?.count).toBe(2);
    expect(inspectorTabsOf({ messages: 0, events: 9, safety: 0 }).find((t) => t.id === "safety")?.count).toBeUndefined();
  });
});

describe("entropySeriesOf (B7)", () => {
  it("a single EntropyScored sample is a series, not 'no entropy data'", () => {
    expect(entropySeriesOf([{ value: 0.25 }])).toEqual([0.25]);
  });
  it("drops non-finite values", () => {
    expect(entropySeriesOf([{ value: 0.5 }, { value: Number.NaN }, { value: 0.3 }])).toEqual([0.5, 0.3]);
  });
});

describe("runHeaderStatus", () => {
  it("uses the shared run vocabulary", () => {
    expect(runHeaderStatus("completed", undefined)).toEqual({ tone: "done", label: "Finished" });
    expect(runHeaderStatus("stopped", undefined)).toEqual({ tone: "stopped", label: "Stopped" });
    expect(runHeaderStatus("live", undefined).tone).toBe("running");
    expect(runHeaderStatus("loading", undefined)).toEqual({ tone: "idle", label: "Loading" });
  });
  it("says how a run ended without success", () => {
    expect(runHeaderStatus("failed", "abstained")).toEqual({ tone: "attention", label: "Abstained" });
    expect(runHeaderStatus("failed", "partial").tone).toBe("attention");
    expect(runHeaderStatus("failed", "failed").tone).toBe("failed");
  });
});

describe("trajectoryView", () => {
  it("is sentence case with a tone", () => {
    expect(trajectoryView("CONVERGING")).toEqual({ label: "settling", tone: "neutral" });
    expect(trajectoryView("STRESSED").tone).toBe("warn");
    expect(trajectoryView("EXPLORING").label).toBe("exploring");
  });
});

describe("answerWithheld", () => {
  const answer = { type: "FinalAnswerProduced", payload: { answer: "Call 555-123-4567" } };
  const block = { type: "GuardrailViolationDetected", payload: { violations: ["pii-detected: PII detected: Phone number"], blocked: true } };

  it("is true when a blocking guardrail fired after the final answer (the output screen withheld it)", () => {
    expect(answerWithheld([answer, block, { type: "AgentAborted", payload: {} }])).toBe(true);
  });

  it("is false for an input block (before any answer), a detection that did not block, and a clean run", () => {
    expect(answerWithheld([block, answer])).toBe(false);
    expect(answerWithheld([answer, { ...block, payload: { ...block.payload, blocked: false } }])).toBe(false);
    expect(answerWithheld([answer, { type: "AgentCompleted", payload: { success: true } }])).toBe(false);
    expect(answerWithheld([])).toBe(false);
  });
});
