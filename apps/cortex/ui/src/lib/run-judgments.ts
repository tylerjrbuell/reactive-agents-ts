/**
 * Run view Judgments tab: how Cortex words a ui-core judgment ledger row
 * (`foldJudgments`). The rows themselves (which events, what they carry) are ui-core's; this
 * file only turns them into cell text and flags. Nothing here invents data the events lack:
 * no question text (the events carry the question id and kind only), no noul confidence.
 */
import type { JudgmentBadge, JudgmentRow } from "@reactive-agents/ui-core";

/** Badge tone of a flag. */
export type JudgmentFlagTone = "warn" | "bad" | "ok";

/** One flag on a row. */
export interface JudgmentFlag {
  readonly label: string;
  readonly tone: JudgmentFlagTone;
}

/** What kind of row it is, in words. */
export function rowKindLabel(row: JudgmentRow): string {
  return row.kind === "answer" ? "Asked" : row.kind === "failure" ? "Failed" : "Shadow";
}

/** The question: its id and kind (the events carry no question text). */
export function questionText(row: JudgmentRow): string {
  if (row.kind === "failure") return "-";
  if (row.kind === "shadow") return `${row.site} decision`;
  return `${row.questionId ?? "question"}${row.questionKind ? ` · ${row.questionKind}` : ""}`;
}

/** The answer cell: a Noul probability, a Score value, a Choice, the failure tag, or the shadow comparison. */
export function answerText(row: JudgmentRow): string {
  if (row.kind === "failure") return row.errorTag ?? "failed";
  if (row.kind === "shadow") return `${row.judged ?? "no answer"} vs ${row.current ?? "?"}`;
  if (row.probability !== undefined) return `${Math.round(row.probability * 100)}% probability`;
  if (row.score !== undefined) return `score ${Number(row.score.toFixed(2))}`;
  return row.answer === undefined ? "-" : String(row.answer);
}

/** Confidence as a percent, or `-` when the answer carries none (Noul answers carry only a probability). */
export function confidenceText(row: JudgmentRow): string {
  return row.confidence === undefined ? "-" : `${Math.round(row.confidence * 100)}%`;
}

/** `calibrated`, `uncalibrated`, or `-` when the backend did not say. */
export function calibratedText(row: JudgmentRow): string {
  if (row.kind !== "answer") return "-";
  return row.calibrated === undefined ? "-" : row.calibrated ? "calibrated" : "uncalibrated";
}

/** Latency as `340 ms` or `1.2 s`; `-` when absent. */
export function latencyText(row: JudgmentRow): string {
  if (row.latencyMs === undefined) return "-";
  return row.latencyMs >= 1000 ? `${(row.latencyMs / 1000).toFixed(1)} s` : `${Math.round(row.latencyMs)} ms`;
}

/** The flags a row carries, worst first. */
export function rowFlags(row: JudgmentRow): readonly JudgmentFlag[] {
  const out: JudgmentFlag[] = [];
  if (row.kind === "failure") out.push({ label: "failed", tone: "bad" });
  if (row.kind === "shadow" && row.judged === null) out.push({ label: "no answer", tone: "bad" });
  if (row.kind === "shadow" && row.agreement === false) out.push({ label: "disagrees", tone: "warn" });
  if (row.kind === "shadow" && row.agreement === true) out.push({ label: "agrees", tone: "ok" });
  if (row.lowConfidence) out.push({ label: "low confidence", tone: "warn" });
  if (row.uncalibrated) out.push({ label: "uncalibrated", tone: "warn" });
  return out;
}

/** Kit tone of the run-header badge (`RunHeader` `judgments`). */
export function judgmentBadgeTone(b: JudgmentBadge): "accent" | "warn" | "bad" {
  return b.tone === "bad" ? "bad" : b.tone === "warn" ? "warn" : "accent";
}

/** Tab-empty copy: says what produces judgments, since a run that asked none is the common case. */
export const JUDGMENTS_EMPTY =
  "This run asked no judgments. They appear when the agent's code calls agent.judge(), when a judgment check runs (guardrail judgment battery, output screening), or when a shadow site samples one. Turn a backend on under Lab · Judgment.";
