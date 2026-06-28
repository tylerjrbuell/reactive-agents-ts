// File: src/strategies/blueprint/worker.ts
/**
 * blueprint worker — executes a hydrated Plan's `tool_call` steps as a
 * dependency-ordered DAG with NO LLM in the loop (ReWOO-style execute phase).
 *
 * The worker is the 0-LLM execute phase of the `blueprint` strategy
 * (PLAN → VERIFY → EXECUTE → SOLVE). It is given a plan whose tool DAG has
 * already been planned + verified; its only job is to run the `tool_call`
 * steps in the right order, fanning out independent steps in parallel.
 *
 * Differences from plan-execute's per-step executor (deliberate):
 *  - PARALLEL: independent steps in a wave run concurrently (capped by the
 *    caller-supplied `concurrency`, which is tier-scaled by the strategy).
 *  - PARALLEL-SAFE SPLIT: any step whose tool fails `isParallelBatchSafeTool`
 *    (write/delete/create/update + meta/final-answer) runs SEQUENTIALLY — a
 *    mutating call never runs concurrently with anything else in its wave.
 *  - FAIL-ON-UNRESOLVED-REF: if a step's args still contain `{{from_step:sN}}`
 *    after `resolveStepReferences` (a missing or failed dependency), the step
 *    is marked FAILED with a clear error — it is NOT silently blanked the way
 *    the plan-execute step-executor does. blueprint has no mid-course
 *    observation to recover from a blanked arg, so a dangling reference is a
 *    hard failure that must propagate to dependents.
 *
 * The dispatch shape (synthetic KernelStateLike, healing config, compression,
 * preprocess/strip hooks) mirrors plan-execute's step-executor exactly so the
 * canonical `executeToolAndObserve` primitive behaves identically.
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { LogEvent } from "@reactive-agents/observability";
import type { KernelStateLike, HarnessPipeline } from "@reactive-agents/core";
import {
  computeWaves,
  extractDependencies,
  resolveStepReferences,
} from "../../types/plan.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import { executeToolAndObserve } from "../../kernel/capabilities/act/tool-observe.js";
import { isParallelBatchSafeTool } from "../../kernel/capabilities/decide/tool-gating.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import {
  sanitizeToolOutput,
  stripDeadStorageHints,
} from "../plan-execute/output-utils.js";

/** File tools whose relative paths the healing pipeline resolves (mirrors act.ts / step-executor.ts). */
const FILE_TOOL_NAMES = new Set([
  "file-read",
  "file-write",
  "code-execute",
  "shell-execute",
]);

/** Pattern for any still-unresolved `{{from_step:sN}}` reference after substitution. */
const UNRESOLVED_REF_RE = /\{\{from_step:s\d+(?::summary)?\}\}/;

/** Context the worker needs that is not on the plan itself. */
export interface BlueprintWorkerContext {
  readonly taskId?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  /** Tool schemas for the internal healing pass (weak-model arg repair). */
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly resultCompression?: ResultCompressionConfig;
  readonly harnessPipeline?: HarnessPipeline;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
}

export interface BlueprintWorkerOptions {
  /** Max parallel tool dispatches within a wave. Caller scales by tier. */
  readonly concurrency: number;
}

export interface BlueprintWorkerResult {
  /** All tool_call steps from the plan, each with status + result/fullResult/error set. */
  readonly steps: PlanStep[];
  /** True iff every tool_call step completed successfully. */
  readonly allSucceeded: boolean;
}

/**
 * Find which dependency step IDs of `step` are missing or failed in the
 * completed-by-id map. Used to fail a step BEFORE dispatch when a dependency
 * it relies on never produced a usable result.
 */
function unmetDependencies(
  step: PlanStep,
  byId: ReadonlyMap<string, PlanStep>,
): string[] {
  const unmet: string[] = [];
  for (const dep of extractDependencies(step)) {
    const depStep = byId.get(dep);
    if (!depStep || depStep.status !== "completed" || depStep.result === undefined) {
      unmet.push(dep);
    }
  }
  return unmet;
}

/**
 * Execute a single tool_call step through the canonical executeToolAndObserve
 * primitive. Resolves `{{from_step:sN}}` references against `completedSteps`
 * first; if a reference cannot be resolved the step is marked FAILED (NOT
 * blanked). Pure-ish: returns a NEW PlanStep with status/result/error set;
 * never mutates the input.
 */
function executeBlueprintStep(
  step: PlanStep,
  stepIndex: number,
  plan: Plan,
  completedSteps: readonly PlanStep[],
  ctx: BlueprintWorkerContext,
  services: StrategyServices,
): Effect.Effect<PlanStep, never, LLMService> {
  const startedAt = new Date().toISOString();
  const { toolService } = services;

  // No tool name / no ToolService → cannot dispatch. Fail clearly.
  if (!step.toolName) {
    return Effect.succeed({
      ...step,
      status: "failed" as const,
      error: "tool_call step has no toolName",
      startedAt,
      completedAt: new Date().toISOString(),
    });
  }
  const toolName = step.toolName;

  if (toolService._tag === "None") {
    return Effect.succeed({
      ...step,
      status: "failed" as const,
      error: `Tool "${toolName}" requested but ToolService is not available`,
      startedAt,
      completedAt: new Date().toISOString(),
    });
  }

  return Effect.gen(function* () {
    const rawArgs = step.toolArgs ?? {};
    const resolvedArgs = resolveStepReferences(rawArgs, [...completedSteps]);

    // fail-on-unresolved-ref: blueprint has no mid-course observation to
    // recover a blanked arg, so any dangling {{from_step:sN}} (missing/failed
    // dependency) is a HARD failure. Do NOT blank it (the plan-execute
    // step-executor blanks; blueprint must not).
    const unresolved = Object.entries(resolvedArgs)
      .filter(([, v]) => typeof v === "string" && UNRESOLVED_REF_RE.test(v))
      .map(([k]) => k);
    if (unresolved.length > 0) {
      return {
        ...step,
        status: "failed" as const,
        error: `unresolved dependency reference(s) in arg(s) [${unresolved.join(", ")}] — a referenced step is missing or failed`,
        startedAt,
        completedAt: new Date().toISOString(),
      } satisfies PlanStep;
    }

    // Synthetic KernelStateLike — mirrors step-executor.ts:151-165. blueprint
    // has no KernelState; build minimal real fields from the plan/step (no cast).
    const syntheticState: KernelStateLike = {
      taskId: ctx.taskId ?? "blueprint",
      strategy: "blueprint",
      kernelType: "react",
      steps: completedSteps.map(() => ({ type: "observation" })),
      toolsUsed: new Set(
        completedSteps.map((s) => s.toolName).filter((n): n is string => !!n),
      ),
      iteration: stepIndex,
      tokens: 0,
      status: "acting",
      output: null,
      error: null,
      meta: {},
    };

    const observe = yield* executeToolAndObserve(
      toolService,
      {
        toolName,
        args: resolvedArgs,
        ...(step.rationale && step.rationale.why
          ? {
              rationale: {
                why: step.rationale.why,
                ...(typeof step.rationale.confidence === "number"
                  ? { confidence: step.rationale.confidence }
                  : {}),
              },
            }
          : {}),
      },
      {
        iteration: stepIndex,
        phase: "act",
        strategy: "blueprint",
        state: syntheticState,
        callId: `${plan.id}_${step.id}`,
      },
      {
        ...(ctx.resultCompression
          ? { compression: ctx.resultCompression }
          : { compression: { budget: 2000, previewItems: 8 } }),
        preprocess: (raw) => sanitizeToolOutput(toolName, raw, resolvedArgs),
        stripDeadStorageHints,
        // Heal internally (weak-model arg errors would otherwise hard-fail) —
        // mirrors step-executor.ts:199-204.
        heal: {
          schemas: ctx.availableToolSchemas ?? [],
          fileToolNames: FILE_TOOL_NAMES,
          cwd: process.cwd(),
        },
        ...(ctx.harnessPipeline ? { pipeline: ctx.harnessPipeline } : {}),
        eventBus: services.eventBus,
        emitToolCallEvents: true,
        taskId: ctx.taskId ?? "blueprint",
        kernelPass: `blueprint:step-${stepIndex + 1}`,
        ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        emitLog: ctx.emitLog,
        // verifier / memoryService / LLM-facts omitted — parity-cheap opt-out.
      },
    );

    return {
      ...step,
      status: observe.success ? ("completed" as const) : ("failed" as const),
      result: observe.content,
      fullResult: observe.fullResult ?? observe.content,
      ...(observe.success ? {} : { error: observe.content }),
      startedAt,
      completedAt: new Date().toISOString(),
    } satisfies PlanStep;
  });
}

/**
 * Execute a hydrated Plan's `tool_call` steps as a dependency-ordered DAG with
 * NO LLM in the loop. Independent steps run in parallel (capped by
 * `opts.concurrency`); mutating steps run sequentially. Non-tool_call steps
 * (analysis/composite) are skipped — the strategy handles analysis/solve.
 *
 * Waves are computed via `computeWaves` and executed in order. Within each
 * wave, parallel-safe tools fan out via `Effect.all({ concurrency })` while
 * parallel-unsafe tools run one-at-a-time. Results from prior waves are
 * applied to `resolveStepReferences` before each step.
 */
export function executeBlueprintWorker(
  plan: Plan,
  services: StrategyServices,
  ctx: BlueprintWorkerContext,
  opts: BlueprintWorkerOptions,
): Effect.Effect<BlueprintWorkerResult, never, LLMService> {
  return Effect.gen(function* () {
    // Worker is tools-only: only tool_call steps participate in the DAG.
    const toolSteps = plan.steps.filter((s) => s.type === "tool_call");

    // Wave grouping over the tool DAG. computeWaves only considers dependency
    // resolution, not parallel-safety — we split each wave further below.
    const waves = computeWaves(toolSteps, new Set<string>());

    // Accumulator of executed steps, keyed for dependency lookup. Both
    // completed AND failed steps go in so dependents can detect a failed dep.
    const byId = new Map<string, PlanStep>();
    const ordered: PlanStep[] = [];

    for (const wave of waves) {
      // Snapshot of all steps completed in PRIOR waves — what this wave's
      // {{from_step:sN}} references can resolve against. (Steps within the same
      // wave never reference each other, by DAG construction.)
      const priorCompleted = ordered.filter(
        (s) => s.status === "completed" && s.result !== undefined,
      );

      // Pre-fail any step whose dependency is missing/failed BEFORE dispatch —
      // a failed dependency poisons the whole downstream chain.
      const dispatchable: PlanStep[] = [];
      for (const step of wave) {
        const unmet = unmetDependencies(step, byId);
        if (unmet.length > 0) {
          const failed: PlanStep = {
            ...step,
            status: "failed",
            error: `dependency step(s) [${unmet.join(", ")}] did not complete successfully`,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          };
          byId.set(failed.id, failed);
          ordered.push(failed);
        } else {
          dispatchable.push(step);
        }
      }

      // Split this wave: parallel-safe tools fan out; parallel-unsafe
      // (write/delete/create/update/meta) run sequentially.
      const parallelSafe = dispatchable.filter((s) =>
        isParallelBatchSafeTool(s.toolName ?? ""),
      );
      const sequential = dispatchable.filter(
        (s) => !isParallelBatchSafeTool(s.toolName ?? ""),
      );

      const mkExec = (step: PlanStep) =>
        executeBlueprintStep(
          step,
          step.seq - 1,
          plan,
          priorCompleted,
          ctx,
          services,
        );

      // Parallel-safe bucket — concurrency-capped fan-out.
      const safeResults =
        parallelSafe.length > 0
          ? yield* Effect.all(parallelSafe.map(mkExec), {
              concurrency: Math.max(1, opts.concurrency),
            })
          : [];

      // Parallel-unsafe bucket — strictly sequential (concurrency 1).
      const seqResults: PlanStep[] = [];
      for (const step of sequential) {
        seqResults.push(yield* mkExec(step));
      }

      for (const r of [...safeResults, ...seqResults]) {
        byId.set(r.id, r);
        ordered.push(r);
      }
    }

    // Re-order results to match the plan's original tool_call ordering so
    // downstream solve sees steps in plan order, not wave/bucket order.
    const orderedById = new Map(ordered.map((s) => [s.id, s]));
    const steps = toolSteps.map((s) => orderedById.get(s.id) ?? s);

    const allSucceeded =
      steps.length > 0 && steps.every((s) => s.status === "completed");

    return { steps, allSucceeded } satisfies BlueprintWorkerResult;
  });
}
