// File: src/strategies/plan-execute/plan-mutation.ts
/**
 * Plan-mutation helpers for the plan-execute-reflect strategy.
 *
 * WS-6 Phase 3 bucket A extraction (from `strategies/plan-execute.ts`).
 *
 * Two structurally-similar helpers that both call `extractStructuredOutput`
 * against `LLMPlanOutputSchema` and hydrate a fresh `Plan` shape:
 *
 *  - `patchPlan`    — rewrites failed + pending steps after an in-flight
 *                     failure; re-numbers steps starting after the failed
 *                     step index.
 *  - `augmentPlan`  — appends supplementary steps when all existing steps
 *                     completed but the reflector determined the goal is
 *                     unmet; re-numbers steps starting after the existing
 *                     plan tail.
 *
 * Both helpers swallow LLM/extraction failures into `Effect.succeed(null)`
 * so the caller can fall through to the next refinement branch without
 * surfacing a hard error.
 *
 * Input is narrowed (`PatchInput`/`AugmentInput`) to only the fields each
 * helper consumes — keeps this module decoupled from the full
 * `PlanExecuteInput` shape declared in `strategies/plan-execute.ts`.
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import {
  LLMPlanOutputSchema,
  hydratePlan,
} from "../../types/plan.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import { extractStructuredOutput } from "../../structured-output/pipeline.js";
import {
  buildPatchPrompt,
  buildAugmentPrompt,
} from "../plan-prompts.js";
import type { ToolSummary } from "../plan-prompts.js";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import { extractGoalText } from "./output-utils.js";

/** Minimal input shape consumed by `patchPlan`. */
export interface PatchInput {
  readonly taskDescription: string;
}

/** Minimal input shape consumed by `augmentPlan`. */
export interface AugmentInput {
  readonly availableToolSchemas?: readonly ToolSchema[];
}

/**
 * Attempt to patch remaining plan steps after a failure.
 * Uses extractStructuredOutput with buildPatchPrompt.
 */
export function patchPlan(
  plan: Plan,
  failedStepIndex: number,
  input: PatchInput,
  _llm: unknown,
  _currentTokens: number,
): Effect.Effect<
  { steps: PlanStep[]; tokens: number } | null,
  Error,
  LLMService
> {
  const patchPrompt = buildPatchPrompt(extractGoalText(input.taskDescription), plan.steps);

  return extractStructuredOutput({
    schema: LLMPlanOutputSchema,
    prompt: patchPrompt,
    systemPrompt:
      "You are a planning agent. Rewrite the failed and pending steps to recover.",
    maxRetries: 1,
    temperature: 0.3,
    maxTokens: 4096,
  }).pipe(
    Effect.map((result) => {
      const patchedPlan = hydratePlan(result.data, {
        taskId: plan.taskId,
        agentId: plan.agentId,
        goal: plan.goal,
        planMode: plan.mode,
      });
      // Re-number patch steps starting after the failed step
      const patchedSteps = patchedPlan.steps.map((s, idx) => ({
        ...s,
        id: `s${failedStepIndex + 2 + idx}`,
        seq: failedStepIndex + 2 + idx,
      }));
      const tokenEst =
        Math.ceil(result.raw.length / 4) +
        Math.ceil(patchPrompt.length / 4);
      return { steps: patchedSteps, tokens: tokenEst };
    }),
    Effect.catchAll(() => Effect.succeed(null)),
  );
}

/**
 * Generate supplementary plan steps when all existing steps completed but the
 * reflector determined the goal is unmet. Unlike patchPlan (which rewrites
 * failed steps), this appends NEW steps to fill gaps.
 */
export function augmentPlan(
  plan: Plan,
  goal: string,
  reflectionFeedback: string,
  input: AugmentInput,
  _llm: unknown,
  _currentTokens: number,
): Effect.Effect<
  { steps: PlanStep[]; tokens: number } | null,
  Error,
  LLMService
> {
  const toolSummaries: ToolSummary[] = (
    input.availableToolSchemas ?? []
  ).map((t) => ({
    name: t.name,
    signature: `(${t.parameters.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ")})`,
  }));

  const completedSteps = plan.steps
    .filter((s) => s.status === "completed")
    .map((s) => ({
      stepId: s.id,
      title: s.title,
      result: s.result,
    }));

  const augmentPrompt = buildAugmentPrompt({
    goal,
    completedSteps,
    reflectionFeedback,
    tools: toolSummaries,
  });

  const nextSeq = plan.steps.length + 1;

  return extractStructuredOutput({
    schema: LLMPlanOutputSchema,
    prompt: augmentPrompt,
    systemPrompt:
      "You are a planning agent. Generate supplementary steps to fill gaps in an incomplete plan.",
    maxRetries: 1,
    temperature: 0.3,
    maxTokens: 4096,
  }).pipe(
    Effect.map((result) => {
      const augmentedPlan = hydratePlan(result.data, {
        taskId: plan.taskId,
        agentId: plan.agentId,
        goal: plan.goal,
        planMode: plan.mode,
      });
      const augmentedSteps = augmentedPlan.steps.map((s, idx) => ({
        ...s,
        id: `s${nextSeq + idx}`,
        seq: nextSeq + idx,
      }));
      const tokenEst =
        Math.ceil(result.raw.length / 4) +
        Math.ceil(augmentPrompt.length / 4);
      return { steps: augmentedSteps, tokens: tokenEst };
    }),
    Effect.catchAll(() => Effect.succeed(null)),
  );
}
