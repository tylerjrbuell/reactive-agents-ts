import { describe, expect, test } from "bun:test";
import {
  foldJudgments,
  judgmentBadgeOf,
  JUDGMENT_EVENT_TAGS,
  LOW_JUDGMENT_CONFIDENCE,
  type JudgmentEventLike,
} from "../src/index.js";

const ev = (type: string, payload: Record<string, unknown>, ts = 1): JudgmentEventLike => ({ type, payload, ts });

const evaluated = (answers: Record<string, unknown>[], extra: Record<string, unknown> = {}): JudgmentEventLike =>
  ev("JudgmentEvaluated", { site: "agent.judge", backend: "jev", answers, latencyMs: 120, ...extra });

describe("foldJudgments", () => {
  test("reads the tags the framework publishes", () => {
    expect(JUDGMENT_EVENT_TAGS).toEqual(["JudgmentEvaluated", "JudgmentFailed", "JudgmentShadow"]);
  });

  test("an empty or unrelated run has an empty ledger", () => {
    const l = foldJudgments([ev("AgentStarted", {}), ev("LLMRequestCompleted", {})]);
    expect(l).toEqual({ rows: [], judgments: 0, failed: 0, degraded: 0, shadow: 0, shadowDisagreements: 0 });
    expect(judgmentBadgeOf(l)).toBeNull();
  });

  test("one row per answer: Noul probability, Score value, Choice, confidence and calibrated flag", () => {
    const l = foldJudgments([
      evaluated([
        { id: "relevant", kind: "noul", value: 0.91 },
        { id: "quality", kind: "score", value: 7.5, confidence: 0.88, calibrated: true },
        { id: "tone", kind: "choice", value: "formal", confidence: 0.72, calibrated: true },
      ]),
    ]);
    expect(l.judgments).toBe(1);
    expect(l.rows.map((r) => [r.questionId, r.questionKind, r.answer, r.probability, r.score, r.confidence, r.calibrated])).toEqual([
      ["relevant", "noul", 0.91, 0.91, undefined, undefined, undefined],
      ["quality", "score", 7.5, undefined, 7.5, 0.88, true],
      ["tone", "choice", "formal", undefined, undefined, 0.72, true],
    ]);
    expect(l.rows.every((r) => r.site === "agent.judge" && r.backend === "jev" && r.latencyMs === 120)).toBe(true);
    expect(l.rows.some((r) => r.lowConfidence || r.uncalibrated)).toBe(false);
    expect(l.degraded).toBe(0);
  });

  test("flags a low-confidence answer at the threshold and counts the ask as degraded once", () => {
    const l = foldJudgments([
      evaluated([
        { id: "a", kind: "choice", value: "x", confidence: LOW_JUDGMENT_CONFIDENCE - 0.01, calibrated: true },
        { id: "b", kind: "choice", value: "y", confidence: LOW_JUDGMENT_CONFIDENCE, calibrated: true },
        { id: "c", kind: "score", value: 1, confidence: 0.1, calibrated: true },
      ]),
    ]);
    expect(l.rows.map((r) => r.lowConfidence)).toEqual([true, false, true]);
    expect(l.degraded).toBe(1);
  });

  test("an uncalibrated answer (LLM emulation) is flagged and degrades the ask", () => {
    const l = foldJudgments([evaluated([{ id: "a", kind: "choice", value: "x", confidence: 0.99, calibrated: false }], { backend: "llm" })]);
    expect(l.rows[0]).toMatchObject({ uncalibrated: true, lowConfidence: false, backend: "llm" });
    expect(l.degraded).toBe(1);
  });

  test("a failure is a row with its tag and message, and counts as a judgment", () => {
    const l = foldJudgments([
      ev("JudgmentFailed", { site: "agent.judge", backend: "jev", errorTag: "JudgmentTimeout", message: "timed out after 3000ms", latencyMs: 3001 }),
    ]);
    expect(l.rows).toEqual([
      {
        id: "0:0",
        kind: "failure",
        ts: 1,
        site: "agent.judge",
        backend: "jev",
        errorTag: "JudgmentTimeout",
        message: "timed out after 3000ms",
        latencyMs: 3001,
        lowConfidence: false,
        uncalibrated: false,
      },
    ]);
    expect(l).toMatchObject({ judgments: 1, failed: 1, degraded: 0 });
  });

  test("shadow rows carry the judged answer and agreement and are not counted as judgments", () => {
    const l = foldJudgments([
      ev("JudgmentShadow", { site: "strategy-selection", judged: "reactive", current: "plan-execute", agreement: false, confidence: 0.4 }),
      ev("JudgmentShadow", { site: "strategy-selection", judged: null, current: "reactive", agreement: null, confidence: null }),
      ev("JudgmentShadow", { site: "complexity-router", judged: "simple", current: "simple", agreement: true, confidence: 0.95 }),
    ]);
    expect(l.judgments).toBe(0);
    expect(l.shadow).toBe(3);
    expect(l.shadowDisagreements).toBe(1);
    expect(l.rows[0]).toMatchObject({ kind: "shadow", judged: "reactive", current: "plan-execute", agreement: false, lowConfidence: true });
    expect(l.rows[1]).toMatchObject({ judged: null, agreement: null, lowConfidence: false });
    expect(judgmentBadgeOf(l)).toBeNull();
  });

  test("keeps event order and a stable id per event and answer", () => {
    const l = foldJudgments([
      ev("AgentStarted", {}),
      evaluated([{ id: "a", kind: "noul", value: 0.2 }, { id: "b", kind: "noul", value: 0.3 }]),
      ev("JudgmentFailed", { site: "s", backend: "ollama", errorTag: "JudgmentConnectionError", message: "refused", latencyMs: 4 }),
    ]);
    expect(l.rows.map((r) => r.id)).toEqual(["1:0", "1:1", "2:0"]);
  });

  test("malformed payloads do not throw and add no phantom answers", () => {
    const l = foldJudgments([
      ev("JudgmentEvaluated", { site: "agent.judge", backend: "jev" }),
      ev("JudgmentEvaluated", { answers: [null, 3, { id: "ok", kind: "score", value: 2 }] }),
    ]);
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0]).toMatchObject({ site: "unknown", questionId: "ok" });
    expect(l.judgments).toBe(2);
  });
});

describe("judgmentBadgeOf", () => {
  test("plain count when nothing is flagged", () => {
    const one = foldJudgments([evaluated([{ id: "a", kind: "noul", value: 0.5 }])]);
    expect(judgmentBadgeOf(one)).toEqual({ text: "1 judgment", tone: "neutral" });
    const two = foldJudgments([evaluated([{ id: "a", kind: "noul", value: 0.5 }]), evaluated([{ id: "a", kind: "noul", value: 0.6 }])]);
    expect(judgmentBadgeOf(two)).toEqual({ text: "2 judgments", tone: "neutral" });
  });

  test("failed or degraded asks show a count and a tone", () => {
    const degraded = foldJudgments([evaluated([{ id: "a", kind: "score", value: 1, confidence: 0.2, calibrated: true }]), evaluated([{ id: "a", kind: "noul", value: 0.5 }])]);
    expect(judgmentBadgeOf(degraded)).toEqual({ text: "2 judgments, 1 failed or degraded", tone: "warn" });
    const failed = foldJudgments([
      evaluated([{ id: "a", kind: "score", value: 1, confidence: 0.2, calibrated: true }]),
      ev("JudgmentFailed", { site: "agent.judge", backend: "jev", errorTag: "JudgmentUnauthorized", message: "401", latencyMs: 9 }),
    ]);
    expect(judgmentBadgeOf(failed)).toEqual({ text: "2 judgments, 2 failed or degraded", tone: "bad" });
  });
});
