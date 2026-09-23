/**
 * Task 9 (shadow-only): batched judgment questions mirroring `adaptive.ts`'s
 * strategy-selection decision. One Choice over the registered sub-strategies
 * (criteria = what each strategy is FOR, not its name) plus three speculative
 * Nouls that are independently useful signals for later inversion analysis.
 * Backend-agnostic — works against whichever `JudgmentBackend` (jev, llm, or
 * a future third) the caller's `JudgmentService` was constructed with.
 *
 * SHADOW ONLY — nothing here consumes an answer to change behavior. See
 * `judgmentClassifyShadow` in `adaptive.ts` and Task 9 Step 4 in the
 * judgment-layer plan for the (not-yet-written) inversion path.
 */
import type { ChoiceSpec, NoulSpec, QuestionSpecs, JudgmentEntry, JudgmentAnswer } from "@reactive-agents/judgment";

type SubStrategy =
  | "reactive"
  | "reflexion"
  | "plan-execute-reflect"
  | "tree-of-thought"
  | "blueprint";

/** What each sub-strategy is FOR — the Choice criteria. Judged by intent, not by name. */
const STRATEGY_CRITERIA: Record<SubStrategy, string> = {
  reactive:
    "Direct tool use for a short, simple, single-hop task — straightforward Q&A or lookup, no planning overhead.",
  reflexion:
    "Iterative critique-and-refine loop: produce output, self-review it against a quality bar, and revise.",
  "plan-execute-reflect":
    "Multi-step task that must adapt mid-course — react to intermediate tool results, debug until passing, investigate, branch on what's observed.",
  "tree-of-thought":
    "Explore and compare multiple alternative approaches, brainstorm options, or weigh trade-offs between them.",
  blueprint:
    "Decomposable, tool-heavy task whose full plan is knowable up front and does NOT depend on observing intermediate results — static multi-file/artifact generation.",
};

export interface AdaptiveJudgmentQuestionsInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly availableTools: readonly string[];
}

export const buildAdaptiveJudgmentState = (input: AdaptiveJudgmentQuestionsInput): JudgmentEntry => ({
  taskDescription: input.taskDescription,
  taskType: input.taskType,
  toolsAvailable: input.availableTools.length > 0,
  toolCount: input.availableTools.length,
});

export const buildAdaptiveJudgmentQuestions = (): QuestionSpecs => ({
  strategy: {
    type: "choice",
    instructions: "Which reasoning strategy best fits `taskDescription`, given `taskType` and whether tools are available?",
    criteria: STRATEGY_CRITERIA,
  } satisfies ChoiceSpec,
  "explicit-steps-given": {
    type: "noul",
    instructions: "Does `taskDescription` already lay out an explicit sequence of steps to follow?",
  } satisfies NoulSpec,
  "requires-retries-or-debugging": {
    type: "noul",
    instructions: "Will completing `taskDescription` likely require reacting to failures, debugging, or retrying based on intermediate results?",
  } satisfies NoulSpec,
  "single-hop-answerable": {
    type: "noul",
    instructions: "Can `taskDescription` likely be answered in a single pass with at most one tool call, with no need to observe and adapt?",
  } satisfies NoulSpec,
});

/** Maps a judgment answer's Choice `value` (a `STRATEGY_CRITERIA` key) back to `SubStrategy` — `null` if the answer isn't Choice-shaped or the value is unrecognized (never partial-trusted). */
export const answerToStrategy = (answer: JudgmentAnswer): SubStrategy | null =>
  answer.kind === "choice" && Object.hasOwn(STRATEGY_CRITERIA, answer.value) ? (answer.value as SubStrategy) : null;
