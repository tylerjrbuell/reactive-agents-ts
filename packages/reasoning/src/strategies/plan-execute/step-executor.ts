// File: src/strategies/plan-execute/step-executor.ts
/**
 * Step executor for the plan-execute-reflect strategy.
 *
 * WS-6 Phase 3 bucket C extraction (from `strategies/plan-execute.ts`).
 *
 * Dispatches a single plan step based on its type:
 *  - `tool_call`  — direct tool dispatch via `toolService.execute` (no LLM
 *                   kernel needed); strips unresolved `{{from_step:sN}}`
 *                   references, sanitizes output, then applies symmetric
 *                   structured-result compression matching the kernel act
 *                   path.
 *  - `analysis`   — single LLM `complete()` call with NO tools; max 4096
 *                   tokens so thinking-model num_predict budgets cover both
 *                   thinking + content.
 *  - `composite`  — `executeReActKernel` with scoped tools filtered by the
 *                   step's `toolHints`.
 *
 * `StepExecResult` is exported so the outer plan-execute orchestrator can
 * destructure the result (output / tokens / cost / success / rawTerminatedBy).
 * Input is narrowed (`StepExecutorInput`) to only the fields each step branch
 * consumes — keeps this module decoupled from the full `PlanExecuteInput`
 * shape declared in `strategies/plan-execute.ts`.
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { LogEvent } from "@reactive-agents/observability";
import { ExecutionError } from "../../errors/errors.js";
import { resolveStepReferences } from "../../types/plan.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import { buildStepExecutionPrompt } from "../plan-prompts.js";
import type { ToolSummary } from "../plan-prompts.js";
import { executeReActKernel } from "../../kernel/loop/react-kernel.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { executeToolAndObserve } from "../../kernel/capabilities/act/tool-observe.js";
import type { KernelStateLike } from "@reactive-agents/core";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import { extractThinkingSafeContent } from "../../kernel/utils/stream-parser.js";
import { withEnvContext } from "../../context/context-engine.js";
import {
  extractGoalText,
  sanitizeToolOutput,
  stripDeadStorageHints,
  stripFinalAnswerPrefix,
} from "./output-utils.js";

export interface StepExecResult {
  output: string;
  tokens: number;
  cost: number;
  success: boolean;
  /**
   * Full, sanitized (but UNcompressed) tool result for tool_call steps.
   * `output` carries the compressed preview that feeds intermediate
   * analysis/reflection/refinement prompts (protects local-tier context from
   * raw 50KB MCP arrays — see compression note below). `fullResult` preserves
   * the complete data so the final SYNTHESIS step can render every item
   * instead of fabricating tails past the preview cutoff. Reactive achieves
   * the same via in-loop `recall()`; plan-execute's synthesis is tool-less, so
   * the full data must be threaded explicitly. Undefined for analysis/composite
   * steps (their `output` already IS the synthesis-worthy content).
   */
  fullResult?: string;
  /**
   * Raw termination reason from a composite step's sub-kernel.
   * Tool-dispatch + analysis steps do not produce one and leave this
   * undefined. Aggregated by the outer loop so dynamic killswitch reasons
   * (e.g. "budget-limit:tokens:1/0") survive narrowing through to
   * AgentCompleted.terminationReason.
   */
  rawTerminatedBy?: string;
}

/**
 * Narrowed input shape consumed by `executeStep`. Mirrors the subset of
 * `PlanExecuteInput` actually read by each branch.
 */
export interface StepExecutorInput {
  readonly taskDescription: string;
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly systemPrompt?: string;
  readonly taskId?: string;
  readonly resultCompression?: ResultCompressionConfig;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly requiredTools?: readonly string[];
  /** Classifier-relevant tools — forwarded to each per-step kernel so lazy-
   *  disclosure pruning keeps planned MCP/user tools visible. */
  readonly relevantTools?: readonly string[];
  readonly maxRequiredToolRetries?: number;
  readonly modelId?: string;
  readonly synthesisConfig?: import("../../context/synthesis-types.js").SynthesisConfig;
  // FM-I (#195): cross-cutting fields forwarded to each per-step ReAct kernel.
  // Previously omitted from this narrowed interface → Compose hooks,
  // killswitches, and calibration were dead during plan-execute steps.
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
  readonly budgetLimits?: import("../../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
  readonly auditRationale?: boolean;
}

/** File tools whose relative paths the healing pipeline resolves (mirrors act.ts). */
const FILE_TOOL_NAMES = new Set(["file-read", "file-write", "code-execute", "shell-execute"]);

/**
 * Execute a single plan step based on its type:
 * - tool_call: direct tool dispatch via executeToolAndObserve (canonical primitive)
 * - analysis: ReAct kernel with NO tools
 * - composite: ReAct kernel with scoped tools
 */
export function executeStep(
  step: PlanStep,
  stepIndex: number,
  plan: Plan,
  completedSteps: PlanStep[],
  input: StepExecutorInput,
  toolSummaries: ToolSummary[],
  services: StrategyServices,
  maxKernelIter: number,
  retryErrorContext: string | undefined,
  emitLog: (event: LogEvent) => Effect.Effect<void, never>,
): Effect.Effect<StepExecResult, ExecutionError, LLMService> {
  const { toolService } = services;

  if (step.type === "tool_call" && step.toolName && toolService._tag === "Some") {
    // Direct tool dispatch routed through the canonical executeToolAndObserve
    // primitive (no LLM kernel) — gains healing + observation.tool-result /
    // lifecycle.failure Compose tags + guaranteed observation metadata that the
    // hand-rolled dispatch lacked (#195/FM-I). Verifier + semantic-memory stay
    // OFF (parity-cheap opt-out); the result string flow is preserved via the
    // sanitize `preprocess` hook + `stripDeadStorageHints` + `fullResult`.
    return Effect.gen(function* () {
      const rawArgs = step.toolArgs ?? {};
      const resolvedArgs = resolveStepReferences(rawArgs, completedSteps);

      // Strip any remaining unresolved {{from_step:sN}} references (self-ref or
      // missing step). Rather than hard-failing the step, replace with empty string
      // and let the tool handle missing/default args. This prevents infinite retry
      // loops when the LLM generates circular step references (e.g. spawn-agent
      // with agentId={{from_step:s2}} where s2 is the current step).
      for (const [key, value] of Object.entries(resolvedArgs)) {
        if (typeof value === "string" && /\{\{from_step:s\d+\}\}/.test(value)) {
          resolvedArgs[key] = value.replace(/\{\{from_step:s\d+(?::summary)?\}\}/g, "");
        }
      }

      // Synthetic KernelStateLike (CORE shape — emitToCompose's ContextFor<T>
      // requires all fields). plan-execute has no KernelState; build minimal
      // real fields from the plan/step — no cast.
      const syntheticState: KernelStateLike = {
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute",
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
          toolName: step.toolName!,
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
          strategy: "plan-execute",
          state: syntheticState,
          callId: `${plan.id}_${step.id}`,
        },
        {
          ...(input.resultCompression
            ? { compression: input.resultCompression }
            : { compression: { budget: 2000, previewItems: 8 } }),
          // Strip action-tool args/recipients from the compressed preview that
          // feeds tool-less downstream prompts (analysis/reflection/synthesis).
          preprocess: (raw) => sanitizeToolOutput(step.toolName!, raw, resolvedArgs),
          // Strip dead [STORED:]/recall() pointers — downstream prompts can't recall.
          stripDeadStorageHints,
          // Heal internally (the kernel pre-heals; plan-execute didn't heal at all).
          heal: {
            schemas: input.availableToolSchemas ?? [],
            fileToolNames: FILE_TOOL_NAMES,
            cwd: process.cwd(),
          },
          pipeline: input.harnessPipeline,
          eventBus: services.eventBus,
          emitToolCallEvents: true,
          taskId: input.taskId ?? "plan-execute",
          kernelPass: `plan-execute:step-${stepIndex + 1}`,
          ...(input.agentId ? { agentId: input.agentId } : {}),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          emitLog,
          // extractFactsLLM omitted (false) — parity-cheap, no LLM fact pass.
          // verifier / memoryService omitted — opt-out holds (Phase E only).
        },
      );

      return {
        output: observe.content,
        // Full sanitized data for the tool-less SYNTHESIS step. The primitive's
        // `content` is the compressed preview for intermediate prompts; synthesis
        // needs the complete data (fullResult is surfaced from executeNativeToolCall).
        fullResult: observe.fullResult ?? observe.content,
        tokens: 0,
        cost: 0,
        success: observe.success,
      } satisfies StepExecResult;
    });
  }

  // Build prior results for analysis/composite step prompts
  const priorResults = completedSteps
    .filter((s) => s.result)
    .map((s) => ({
      stepId: s.id,
      title: s.title,
      result: s.result!,
    }));

  // Scope tools for composite steps
  const scopedTools: ToolSummary[] =
    step.type === "composite" && step.toolHints
      ? toolSummaries.filter((t) => step.toolHints!.includes(t.name))
      : [];

  // Build the step execution prompt
  const stepPrompt = buildStepExecutionPrompt({
    goal: extractGoalText(input.taskDescription),
    step,
    stepIndex,
    totalSteps: plan.steps.length,
    priorResults,
    scopedTools,
  });

  // Add retry error context if retrying
  const taskText = retryErrorContext
    ? `${stepPrompt}\n\nPREVIOUS ATTEMPT FAILED: ${retryErrorContext}\nPlease try a different approach.`
    : stepPrompt;

  // Analysis steps: single LLM call — no tool loop needed
  // Note: maxTokens 4096 to accommodate thinking models where num_predict
  // covers both thinking + content tokens combined.
  if (step.type === "analysis") {
    return services.llm
      .complete({
        messages: [{ role: "user", content: taskText }],
        systemPrompt: withEnvContext(
          input.systemPrompt ??
            "You are a precise task executor. Produce the requested content directly. Never ask questions or offer to do something — just output the finished result.",
        ),
        maxTokens: 4096,
        temperature: 0.5,
        // Correlate this direct (non-kernel) analysis call so the observable-LLM
        // chokepoint emits a ContextPressure keyed to the real run — analysis
        // steps bypass the kernel hooks, so without this the Cortex gauge stays
        // dark during analysis-only plan-execute runs.
        ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
      })
      .pipe(
        Effect.flatMap((response) => {
          const output = stripFinalAnswerPrefix(
            extractThinkingSafeContent(response).content,
          );
          if (!output.trim()) {
            return Effect.fail(
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Analysis step ${stepIndex + 1} produced empty output (model may have exhausted token budget on thinking)`,
                step: stepIndex,
              }),
            );
          }
          return Effect.succeed({
            output,
            tokens: response.usage.totalTokens,
            cost: response.usage.estimatedCost,
            success: true,
          });
        }),
        Effect.mapError(
          (err) =>
            err instanceof ExecutionError ? err :
            new ExecutionError({
              strategy: "plan-execute-reflect",
              message: `Analysis step ${stepIndex + 1} failed`,
              step: stepIndex,
              cause: err,
            }),
        ),
      );
  }

  // Composite steps: ReAct kernel with scoped tools
  const kernelToolSchemas =
    step.toolHints
      ? (input.availableToolSchemas ?? []).filter((t) =>
          step.toolHints!.includes(t.name),
        )
      : undefined;

  return executeReActKernel({
    task: taskText,
    systemPrompt:
      input.systemPrompt ??
      "You are a precise task executor. Complete the given step.",
    availableToolSchemas: kernelToolSchemas,
    maxIterations: maxKernelIter,
    temperature: 0.5,
    taskId: input.taskId,
    parentStrategy: "plan-execute",
    kernelPass: `plan-execute:step-${stepIndex + 1}`,
    resultCompression: input.resultCompression,
    agentId: input.agentId,
    sessionId: input.sessionId,
    requiredTools: input.requiredTools,
    relevantTools: input.relevantTools,
    maxRequiredToolRetries: input.maxRequiredToolRetries,
    modelId: input.modelId,
    exitOnAllToolsCalled: true,
    synthesisConfig: input.synthesisConfig,
    // FM-I (#195): forward cross-cutting fields so Compose hooks, killswitches,
    // and model calibration are live during per-step execution. executeReActKernel
    // forwards these through buildKernelInput to the kernel.
    harnessPipeline: input.harnessPipeline,
    budgetLimits: input.budgetLimits,
    calibration: input.calibration,
    auditRationale: input.auditRationale,
  }).pipe(
    Effect.map((kernelResult) => ({
      output: stripFinalAnswerPrefix(kernelResult.output || `[Step ${stepIndex + 1} completed]`),
      tokens: kernelResult.totalTokens,
      cost: kernelResult.totalCost,
      success: true,
      ...(kernelResult.rawTerminatedBy !== undefined
        ? { rawTerminatedBy: kernelResult.rawTerminatedBy }
        : {}),
    })),
    Effect.mapError(
      (err) =>
        new ExecutionError({
          strategy: "plan-execute-reflect",
          message: `Step ${stepIndex + 1} execution failed`,
          step: stepIndex,
          cause: err,
        }),
    ),
  );
}
