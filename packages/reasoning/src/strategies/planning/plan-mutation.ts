// File: src/strategies/planning/plan-mutation.ts
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
import { extractStructuredOutput, structuredCallSpend } from "../../structured-output/pipeline.js";
import {
  buildPatchPrompt,
  buildAugmentPrompt,
} from "./plan-prompts.js";
import type { ToolSummary } from "./plan-prompts.js";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import { extractGoalText } from "./plan-text.js";
import { tokenSpendOf, type TokenSpend } from "../../kernel/run-budget.js";
import { normalizeReplanRefs } from "./plan-refs.js";
import { titlesNearDuplicate } from "../../kernel/policy/plan-steps.js";

/** Replanned steps plus the replan call's spend (incl. the provider's split). */
export type PlanMutation = { steps: PlanStep[] } & TokenSpend;

/** Most steps one augment may add (a gap-filler, not a second plan). */
export const MAX_AUGMENT_STEPS = 3;

/**
 * Drop candidates whose title near-duplicates an `existing` title or an earlier
 * kept candidate, then cap. The one dedupe for patch and augment steps.
 */
export function dedupeNewSteps<S extends { readonly title: string }>(
  candidates: readonly S[],
  existing: readonly string[],
  cap = Number.POSITIVE_INFINITY,
): S[] {
  const seen = [...existing];
  const out: S[] = [];
  for (const c of candidates) {
    if (seen.some((t) => titlesNearDuplicate(t, c.title))) continue;
    seen.push(c.title);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
}

/** Minimal input shape consumed by `patchPlan`. */
export interface PatchInput {
  readonly taskDescription: string;
  /** Tool schemas so the recovery prompt isn't tool-blind (see buildPatchPrompt). */
  readonly availableToolSchemas?: readonly ToolSchema[];
  /** Commanded LLM sampling temperature — wins over the 0.3 default (GH #246). */
  readonly temperature?: number;
}

/**
 * Map a tool schema to the enriched ToolSummary the plan prompts render. The
 * one builder for plan-execute and blueprint; parameters pass through whole
 * (the renderer reads the fields it shows).
 */
export const toToolSummary = (t: ToolSchema): ToolSummary => ({
  name: t.name,
  signature: `(${t.parameters.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ")})`,
  ...(t.description ? { description: t.description } : {}),
  ...(t.parameters.length > 0 ? { params: t.parameters } : {}),
});

/** Minimal input shape consumed by `augmentPlan`. */
export interface AugmentInput {
  readonly availableToolSchemas?: readonly ToolSchema[];
  /** Commanded LLM sampling temperature — wins over the 0.3 default (GH #246). */
  readonly temperature?: number;
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
  guidance?: string,
): Effect.Effect<
  PlanMutation | null,
  Error,
  LLMService
> {
  const patchTools = (input.availableToolSchemas ?? []).map(toToolSummary);
  const patchPrompt = buildPatchPrompt(
    extractGoalText(input.taskDescription),
    plan.steps,
    patchTools,
    guidance,
  );

  return extractStructuredOutput({
    schema: LLMPlanOutputSchema,
    prompt: patchPrompt,
    systemPrompt:
      "You are a planning agent. Rewrite the failed and pending steps to recover.",
    strategy: "plan-execute-reflect",
    maxRetries: 1,
    // GH #246: commanded temperature wins; unset keeps the 0.3 default.
    temperature: input.temperature ?? 0.3,
    maxTokens: 4096,
    ...(plan.taskId ? { traceContext: { taskId: plan.taskId } } : {}),
  }).pipe(
    Effect.flatMap((result) => {
      const patchedPlan = hydratePlan(result.data, {
        taskId: plan.taskId,
        agentId: plan.agentId,
        goal: plan.goal,
        planMode: plan.mode,
      });
      // Re-number patch steps starting after the failed step
      // A rewrite never restates work already completed (nor itself).
      const fresh = dedupeNewSteps(
        patchedPlan.steps,
        plan.steps.filter((s) => s.status === "completed").map((s) => s.title),
      );
      // Nothing new: no patch, so the caller keeps the tail it would otherwise replace with nothing.
      if (fresh.length === 0) return Effect.succeed(null);
      const patchedSteps = fresh.map((s, idx) => ({
        ...s,
        id: `s${failedStepIndex + 2 + idx}`,
        seq: failedStepIndex + 2 + idx,
      }));
      const spend = tokenSpendOf(structuredCallSpend(result.usage, { prompt: patchPrompt, raw: result.raw }));
      // Replanned steps get the same keyed-ref rewrite (and event) as a fresh plan (plan-refs.ts).
      return normalizeReplanRefs(patchedSteps, plan.taskId).pipe(Effect.map((steps) => ({ steps, ...spend })));
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
  PlanMutation | null,
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
    strategy: "plan-execute-reflect",
    maxRetries: 1,
    // GH #246: commanded temperature wins; unset keeps the 0.3 default.
    temperature: input.temperature ?? 0.3,
    maxTokens: 4096,
    ...(plan.taskId ? { traceContext: { taskId: plan.taskId } } : {}),
  }).pipe(
    Effect.flatMap((result) => {
      const augmentedPlan = hydratePlan(result.data, {
        taskId: plan.taskId,
        agentId: plan.agentId,
        goal: plan.goal,
        planMode: plan.mode,
      });
      // Never re-add a step already on the plan (failed ones may be retried); cap the additions.
      const fresh = dedupeNewSteps(
        augmentedPlan.steps,
        plan.steps.filter((s) => s.status !== "failed").map((s) => s.title),
        MAX_AUGMENT_STEPS,
      );
      const augmentedSteps = fresh.map((s, idx) => ({
        ...s,
        id: `s${nextSeq + idx}`,
        seq: nextSeq + idx,
      }));
      const spend = tokenSpendOf(structuredCallSpend(result.usage, { prompt: augmentPrompt, raw: result.raw }));
      return normalizeReplanRefs(augmentedSteps, plan.taskId).pipe(Effect.map((steps) => ({ steps, ...spend })));
    }),
    Effect.catchAll(() => Effect.succeed(null)),
  );
}
