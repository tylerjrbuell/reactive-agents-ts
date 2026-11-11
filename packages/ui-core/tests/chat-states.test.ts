/**
 * Pins for the chat states the Cortex UI audit (2026-11-10) found missing:
 * an interrupted turn (B2), the wait between a request and the model's first
 * token (B11), one status vocabulary (G2), shared formatters (G1) and a cause
 * line without the error class tag (B1).
 */
import { describe, expect, test } from "bun:test";
import {
  causeLineOf,
  foldModelWait,
  formatClockTime,
  formatCost,
  formatRelativeTime,
  formatTokens,
  initialModelWait,
  initialRunState,
  interruptionCause,
  modelWaitLabel,
  reduceRunState,
  statusOfRun,
  statusOfSubAgent,
  statusOfTurn,
  turnOutcomeOf,
  type ModelWaitState,
  type SeqStamped,
  type UiStreamEvent,
} from "../src/index.js";

describe("turnOutcomeOf: interrupted turns (B2)", () => {
  test("a turn stopped by the user reads as interrupted with a cause", () => {
    const o = turnOutcomeOf({ interrupted: "user" });
    expect(o.ending).toBe("interrupted");
    expect(o.interruptedBy).toBe("user");
    expect(o.error).toBe(interruptionCause("user"));
  });

  test("a dropped connection reads as interrupted with its own cause", () => {
    const o = turnOutcomeOf({ interrupted: "disconnect" });
    expect(o.ending).toBe("interrupted");
    expect(o.interruptedBy).toBe("disconnect");
    expect(o.error).toContain("connection");
  });

  test("an unknown interruption still classifies, without inventing who stopped it", () => {
    const o = turnOutcomeOf({ interrupted: true });
    expect(o.ending).toBe("interrupted");
    expect(o.interruptedBy).toBeUndefined();
    expect(o.error).toBe(interruptionCause(undefined));
  });

  test("an explicit cause wins over the default line", () => {
    expect(turnOutcomeOf({ interrupted: "user", error: "Stopped from the run view" }).error).toBe("Stopped from the run view");
  });

  test("no interrupted field keeps the old classification", () => {
    expect(turnOutcomeOf({ success: false, error: "boom" }).ending).toBe("failed");
    expect(turnOutcomeOf({ interrupted: false }).ending).toBe("succeeded");
  });
});

describe("causeLineOf (B1)", () => {
  test("drops the error class tag a thrown tagged error carries", () => {
    expect(causeLineOf('LLMError: Model "x:1b" not found locally. Run: ollama pull x:1b')).toBe(
      'Model "x:1b" not found locally. Run: ollama pull x:1b',
    );
    expect(causeLineOf("Error: FiberFailure: LLMError: boom")).toBe("boom");
  });

  test("keeps the first non-blank line and leaves untagged text alone", () => {
    expect(causeLineOf("\n  400 credit balance too low\nstack")).toBe("400 credit balance too low");
    expect(causeLineOf("Timeout: the model took too long")).toBe("Timeout: the model took too long");
  });

  test("reads an Error's message", () => {
    expect(causeLineOf(new Error("LLMError: nope"))).toBe("nope");
    expect(causeLineOf(undefined)).toBeUndefined();
    expect(causeLineOf("   ")).toBeUndefined();
  });
});

describe("model wait (B11)", () => {
  const run = (events: UiStreamEvent[], start = 1_000): ModelWaitState =>
    events.reduce((s, e, i) => foldModelWait(s, e, start + (i + 1) * 100), initialModelWait(start));

  test("a sent request waits on the model until its first token", () => {
    const s = run([{ _tag: "PhaseStarted", phase: "think", timestamp: 1 }]);
    expect(s.waiting).toBe(true);
    expect(s.since).toBe(1_000);
  });

  test("the first text, thinking or usage ends the wait", () => {
    expect(run([{ _tag: "TextDelta", text: "4" }]).waiting).toBe(false);
    expect(run([{ _tag: "ThinkingEmitted", content: "hmm", iteration: 0 }]).waiting).toBe(false);
  });

  test("tools running is not a model wait; the call after the last tool is", () => {
    const s = run([
      { _tag: "TextDelta", text: "let me look" },
      { _tag: "ToolCallStarted", toolName: "a", callId: "1" },
      { _tag: "ToolCallStarted", toolName: "b", callId: "2" },
      { _tag: "ToolCallCompleted", toolName: "a", callId: "1", durationMs: 1, success: true },
    ]);
    expect(s.waiting).toBe(false);
    const after = foldModelWait(s, { _tag: "ToolCallCompleted", toolName: "b", callId: "2", durationMs: 1, success: true }, 9_000);
    expect(after.waiting).toBe(true);
    expect(after.since).toBe(9_000);
  });

  test("a terminal event ends the wait", () => {
    expect(run([{ _tag: "StreamCancelled", reason: "user", iterationsCompleted: 0 }]).waiting).toBe(false);
    expect(run([{ _tag: "StreamError", cause: "x" }]).waiting).toBe(false);
  });

  test("reduceRunState carries the wait with the injected clock", () => {
    const ev = (e: UiStreamEvent, seq: number): SeqStamped<UiStreamEvent> => ({ ...e, seq });
    const s1 = reduceRunState(initialRunState(), ev({ _tag: "PhaseStarted", phase: "think", timestamp: 1 }, 1), { now: 500 });
    expect(s1.modelWait?.waiting).toBe(true);
    expect(s1.modelWait?.since).toBe(500);
    const s2 = reduceRunState(s1, ev({ _tag: "TextDelta", text: "hi" }, 2), { now: 900 });
    expect(s2.modelWait?.waiting).toBe(false);
  });

  test("the label names Ollama, where a busy server queues the request", () => {
    expect(modelWaitLabel("ollama")).toContain("Ollama");
    expect(modelWaitLabel("anthropic")).toBe("Waiting for the model");
    expect(modelWaitLabel(undefined)).toBe("Waiting for the model");
  });
});

describe("status vocabulary (G2)", () => {
  test("turn endings map onto the shared tones", () => {
    expect(statusOfTurn(undefined, { streaming: true }).tone).toBe("running");
    expect(statusOfTurn("succeeded").tone).toBe("done");
    expect(statusOfTurn("failed").tone).toBe("failed");
    expect(statusOfTurn("errored").tone).toBe("failed");
    expect(statusOfTurn("partial").tone).toBe("attention");
    expect(statusOfTurn("abstained").tone).toBe("attention");
    expect(statusOfTurn("paused").tone).toBe("attention");
    expect(statusOfTurn("cancelled")).toEqual({ tone: "stopped", label: "Stopped" });
    expect(statusOfTurn("interrupted")).toEqual({ tone: "stopped", label: "Interrupted" });
    expect(statusOfTurn(undefined).tone).toBe("idle");
  });

  test("run list statuses map onto the same tones", () => {
    expect(statusOfRun("live").tone).toBe("running");
    expect(statusOfRun("completed").tone).toBe("done");
    expect(statusOfRun("failed").tone).toBe("failed");
    expect(statusOfRun("stopped")).toEqual({ tone: "stopped", label: "Stopped" });
    expect(statusOfRun("paused").tone).toBe("attention");
    expect(statusOfRun("awaiting-approval").tone).toBe("attention");
    expect(statusOfRun("whatever").tone).toBe("idle");
  });

  test("run list labels are the chat turn labels (one vocabulary: Running, Finished, Waiting on you)", () => {
    expect(statusOfRun("live")).toEqual({ tone: "running", label: statusOfTurn(undefined, { streaming: true }).label });
    expect(statusOfRun("completed")).toEqual(statusOfTurn("succeeded"));
    expect(statusOfRun("paused")).toEqual(statusOfTurn("paused"));
    expect(statusOfRun("failed").label).toBe("Failed");
  });

  test("sub-agent card states map onto the same tones", () => {
    expect(statusOfSubAgent("running").tone).toBe("running");
    expect(statusOfSubAgent("done").tone).toBe("done");
    expect(statusOfSubAgent("failed").tone).toBe("failed");
    expect(statusOfSubAgent("abstained").tone).toBe("attention");
  });
});

describe("formatters (G1)", () => {
  test("formatCost never shows a positive spend as zero", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.00004)).toBe("<$0.0001");
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(0.042)).toBe("$0.042");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(Number.NaN)).toBe("—");
  });

  test("formatTokens is compact", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1k");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(-3)).toBe("0");
  });

  test("formatRelativeTime reads like a chat timestamp", () => {
    const now = Date.UTC(2026, 10, 10, 12, 0, 0);
    expect(formatRelativeTime(now - 10_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe("3 minutes ago");
    expect(formatRelativeTime(now - 60_000, now)).toBe("1 minute ago");
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(formatRelativeTime(now - 30 * 3_600_000, now)).toBe("yesterday");
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe("3 days ago");
    expect(formatRelativeTime(now - 10 * 86_400_000, now, { locale: "en-US", timeZone: "UTC" })).toBe("Oct 31");
  });

  test("formatClockTime shows the hour and minute", () => {
    expect(formatClockTime(Date.UTC(2026, 10, 10, 19, 21), { locale: "en-US", timeZone: "UTC" })).toBe("7:21 PM");
  });
});
