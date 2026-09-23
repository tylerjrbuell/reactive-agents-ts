/**
 * judgment-comprehend-questions.ts — Task 10 (shadow-only): batched judgment
 * questions mirroring `classifyTask()`'s aggregate regex verdict
 * (task-complexity.ts + task-horizon.ts + task-shape.ts + task-intent.ts).
 * Backend-agnostic — works against whichever `JudgmentBackend` (jev, llm, or
 * a future third) the caller's `JudgmentService` was constructed with.
 *
 * One request reproduces the union of all four files' signals:
 *  - `complexity` — Score over trivial/moderate/complex (task-complexity.ts).
 *  - `long-horizon` — Noul (task-horizon.ts's short/long axis).
 *  - `multi-step` — Noul (task-shape.ts's needsMultiStep).
 *  - `output-format` — Choice over OutputFormat's 7 values (task-intent.ts's
 *    FORMAT_RULES).
 *  - `citation-needed` — Noul (task-shape.ts's needsCitation).
 *  - `requires::<toolName>` — one Noul per tool in the run's available-tool
 *    surface (task-intent.ts's `nominateRequiredTools`).
 *
 * SHADOW ONLY — nothing here consumes an answer to change `TaskClassification`
 * or `nominatedTools`. See `judgmentComprehendShadow` in
 * `judgment-classification.ts` and Task 10 Step 3 (not in scope for this
 * dispatch) for the (not-yet-written) inversion path. Pattern mirrors
 * `adaptive-judgment-questions.ts` (Task 9) / `judgment-complexity-questions.ts`
 * (Task 9b) — same Choice/Noul/Score shape, same "answer maps back to `null`
 * on anything unrecognized" discipline.
 */
import type {
  ChoiceSpec,
  JudgmentAnswer,
  JudgmentEntry,
  NoulSpec,
  QuestionSpecs,
  ScoreSpec,
} from "@reactive-agents/judgment";
import type { PreTaskComplexity } from "./task-complexity.js";
import type { OutputFormat } from "./task-intent.js";

/** Score rubric levels, indexed 0/1/2 — matches `PreTaskComplexity`'s three values. */
const COMPLEXITY_LEVELS: readonly PreTaskComplexity[] = ["trivial", "moderate", "complex"];

const COMPLEXITY_CRITERIA: readonly [JudgmentEntry, JudgmentEntry, JudgmentEntry] = [
  "Trivial: single-fact lookup or one-step arithmetic, or very short prose with no multi-step or exploratory language.",
  "Moderate: a multi-step task ('then', numbered steps, 'plan/design/implement') without deep analysis/critique/trade-off language.",
  "Complex: requires critique, evaluation, justification, weighing trade-offs, or comparing strategies/architectures — exploration of alternatives is warranted.",
];

/** What each `OutputFormat` looks like — the Choice criteria, drawn from FORMAT_RULES' own cue descriptions. */
const OUTPUT_FORMAT_CRITERIA: Record<OutputFormat, string> = {
  markdown: "A markdown table, or explicit request for markdown-formatted output.",
  json: "Explicit request for JSON output/format/response.",
  csv: "Explicit request for CSV, comma-separated, or a CSV file/export.",
  html: "Explicit request for an HTML page/output/code.",
  code: "A function/script/program/class/module/code snippet is the primary deliverable.",
  list: "A bullet or numbered list is requested.",
  prose: "No explicit structured format is requested — free-form prose/explanation is expected.",
};

export interface ComprehendJudgmentQuestionsInput {
  readonly task: string;
}

export const buildComprehendJudgmentState = (input: ComprehendJudgmentQuestionsInput): JudgmentEntry => ({
  task: input.task,
});

/** The five base (non-tool) comprehend questions — always present in chunk 0. */
export const buildComprehendJudgmentBaseQuestions = (): QuestionSpecs => ({
  complexity: {
    type: "score",
    instructions:
      "Rate the pre-execution complexity of `task` on this rubric — trivial (0), moderate (1), or complex (2).",
    criteria: COMPLEXITY_CRITERIA,
  } satisfies ScoreSpec,
  "long-horizon": {
    type: "noul",
    instructions:
      "Is `task` a long-running, multi-phase run (many enumerated questions/phases/steps, or explicitly described as long-running/multi-hour/multi-day), as opposed to a short few-iteration task?",
  } satisfies NoulSpec,
  "multi-step": {
    type: "noul",
    instructions:
      "Does completing `task` require sequential multi-step reasoning ('first X, then Y', numbered steps, planning/designing/implementing/refactoring/debugging)?",
  } satisfies NoulSpec,
  "output-format": {
    type: "choice",
    instructions: "Which output format does `task` request, if any explicit format is requested at all?",
    criteria: OUTPUT_FORMAT_CRITERIA,
  } satisfies ChoiceSpec,
  "citation-needed": {
    type: "noul",
    instructions:
      "Must the output for `task` cite external sources or be grounded in tool observations (e.g. 'cite', 'according to', 'with sources')?",
  } satisfies NoulSpec,
});

/** One Noul per available tool — dynamic, keyed `requires::<toolName>`. */
export const buildToolRequirementQuestions = (
  toolNames: readonly string[],
): QuestionSpecs => {
  const out: Record<string, NoulSpec> = {};
  for (const name of toolNames) {
    out[`requires::${name}`] = {
      type: "noul",
      instructions: `Does completing \`task\` plausibly require calling the "${name}" tool?`,
    };
  }
  return out;
};

/** Maps a Score answer back to the nearest `PreTaskComplexity` level — `null` if the answer isn't Score-shaped. */
export const answerToComplexity = (answer: JudgmentAnswer): PreTaskComplexity | null => {
  if (answer.kind !== "score") return null;
  const idx = Math.min(COMPLEXITY_LEVELS.length - 1, Math.max(0, Math.round(answer.value)));
  return COMPLEXITY_LEVELS[idx] ?? null;
};

/** Maps a Noul answer to a boolean verdict (probability ≥ 0.5) — `null` if the answer isn't Noul-shaped. */
export const answerToBoolean = (answer: JudgmentAnswer): boolean | null =>
  answer.kind === "noul" ? answer.probability >= 0.5 : null;

/** Maps a Choice answer back to an `OutputFormat` — `null` if the answer isn't Choice-shaped or unrecognized. */
export const answerToOutputFormat = (answer: JudgmentAnswer): OutputFormat | null =>
  answer.kind === "choice" && Object.hasOwn(OUTPUT_FORMAT_CRITERIA, answer.value)
    ? (answer.value as OutputFormat)
    : null;
