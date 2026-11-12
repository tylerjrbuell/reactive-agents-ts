import { describe, expect, it } from "bun:test";
import { foldJudgments, judgmentBadgeOf } from "@reactive-agents/ui-core";
import {
  answerText,
  calibratedText,
  confidenceText,
  judgmentBadgeTone,
  latencyText,
  questionText,
  rowFlags,
  rowKindLabel,
} from "./run-judgments.js";

const ev = (type: string, payload: Record<string, unknown>) => ({ type, payload, ts: 1 });

/** A scripted run: three answers (noul, score, choice), one failure, two shadow comparisons. */
const scripted = foldJudgments([
  ev("AgentStarted", {}),
  ev("JudgmentEvaluated", {
    site: "agent.judge",
    backend: "jev",
    latencyMs: 340,
    answers: [
      { id: "relevant", kind: "noul", value: 0.91 },
      { id: "quality", kind: "score", value: 7.5, confidence: 0.88, calibrated: true },
      { id: "tone", kind: "choice", value: "formal", confidence: 0.41, calibrated: false },
    ],
  }),
  ev("JudgmentFailed", { site: "agent.judge", backend: "jev", errorTag: "JudgmentTimeout", message: "timed out", latencyMs: 3001 }),
  ev("JudgmentShadow", { site: "strategy-selection", judged: "reactive", current: "plan-execute", agreement: false, confidence: 0.9 }),
  ev("JudgmentShadow", { site: "complexity-router", judged: null, current: "simple", agreement: null, confidence: null }),
]);

describe("Judgments tab rows from a scripted run", () => {
  it("renders every asked answer with its question, answer, confidence, calibration and latency", () => {
    const [noul, score, choice] = scripted.rows;
    expect([questionText(noul!), answerText(noul!), confidenceText(noul!), calibratedText(noul!), latencyText(noul!)]).toEqual([
      "relevant · noul",
      "91% probability",
      "-",
      "-",
      "340 ms",
    ]);
    expect([questionText(score!), answerText(score!), confidenceText(score!), calibratedText(score!)]).toEqual(["quality · score", "score 7.5", "88%", "calibrated"]);
    expect([answerText(choice!), confidenceText(choice!), calibratedText(choice!)]).toEqual(["formal", "41%", "uncalibrated"]);
  });

  it("flags low-confidence and uncalibrated answers, and not the healthy ones", () => {
    const [noul, score, choice] = scripted.rows;
    expect(rowFlags(noul!)).toEqual([]);
    expect(rowFlags(score!)).toEqual([]);
    expect(rowFlags(choice!).map((f) => f.label)).toEqual(["low confidence", "uncalibrated"]);
  });

  it("shows the failure's tag and a failed flag", () => {
    const f = scripted.rows[3]!;
    expect([rowKindLabel(f), answerText(f), latencyText(f)]).toEqual(["Failed", "JudgmentTimeout", "3.0 s"]);
    expect(rowFlags(f)).toEqual([{ label: "failed", tone: "bad" }]);
  });

  it("shows shadow comparisons with agreement, and a missing answer as such", () => {
    const [disagree, none] = scripted.rows.slice(4);
    expect(answerText(disagree!)).toBe("reactive vs plan-execute");
    expect(rowFlags(disagree!).map((f) => f.label)).toEqual(["disagrees"]);
    expect(answerText(none!)).toBe("no answer vs simple");
    expect(rowFlags(none!).map((f) => f.label)).toEqual(["no answer"]);
  });

  it("the header badge counts the run's judgments and its failed or degraded ones", () => {
    const badge = judgmentBadgeOf(scripted)!;
    expect(badge.text).toBe("2 judgments, 2 failed or degraded");
    expect(judgmentBadgeTone(badge)).toBe("bad");
    expect(judgmentBadgeTone({ text: "x", tone: "neutral" })).toBe("accent");
  });
});
