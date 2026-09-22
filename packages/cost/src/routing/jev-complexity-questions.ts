/**
 * Task 9b (shadow-only): batched Jev questions mirroring
 * `complexity-router.ts`'s `heuristicClassify` decision. One Choice over the
 * registered `ModelTier` values (criteria = the cost/latency/capability
 * tradeoff each tier is FOR, not its name) plus speculative Nouls that are
 * independently useful signals for later inversion analysis.
 *
 * SHADOW ONLY — nothing here consumes an answer to change routing. See
 * `jevComplexityShadow` in `complexity-router.ts` and Task 9b Step 4 in the
 * judgment-layer plan for the (not-yet-written) inversion path.
 */
import type { ChoiceSpec, NoulSpec, QuestionSpecs, JudgmentEntry, JudgmentAnswer } from "@reactive-agents/judgment";
import type { ModelTier } from "../types.js";

/** What each tier is FOR — the Choice criteria, drawn from PROVIDER_CONFIGS' cost/quality/speed tradeoffs. */
const TIER_CRITERIA: Record<ModelTier, string> = {
  haiku:
    "Cheapest, fastest tier. Use for simple lookups, short Q&A, direct tool calls with no multi-step reasoning or deep analysis needed.",
  sonnet:
    "Balanced tier. Use for moderate complexity — some code, some analysis, or a short multi-step task, but not requiring the highest reasoning quality.",
  opus:
    "Highest-quality, slowest, most expensive tier. Use for tasks combining code generation, multi-step planning, AND deep analysis/synthesis together — genuinely hard tasks.",
};

export interface ComplexityJevQuestionsInput {
  readonly task: string;
}

export const buildComplexityJevState = (input: ComplexityJevQuestionsInput): JudgmentEntry => ({
  task: input.task,
});

export const buildComplexityJevQuestions = (): QuestionSpecs => ({
  tier: {
    type: "choice",
    instructions: "Which model tier is the best cost/quality/latency fit for completing `task`?",
    criteria: TIER_CRITERIA,
  } satisfies ChoiceSpec,
  "requires-code-execution": {
    type: "noul",
    instructions: "Does `task` require writing or executing code?",
  } satisfies NoulSpec,
  "multi-step-analysis": {
    type: "noul",
    instructions: "Does `task` require multi-step reasoning, comparison, or deep analysis rather than a direct answer?",
  } satisfies NoulSpec,
});

/** Maps a Jev answer's Choice `value` (a `TIER_CRITERIA` key) back to `ModelTier` — `null` if the answer isn't Choice-shaped or the value is unrecognized (never partial-trusted). */
export const jevAnswerToTier = (answer: JudgmentAnswer): ModelTier | null =>
  answer.kind === "choice" && Object.hasOwn(TIER_CRITERIA, answer.value) ? (answer.value as ModelTier) : null;
