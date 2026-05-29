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
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { compressToolResult } from "../../kernel/capabilities/attend/tool-formatting.js";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import { extractThinkingSafeContent } from "../../kernel/utils/stream-parser.js";
import { withEnvContext } from "../../context/context-engine.js";
import {
  extractGoalText,
  sanitizeToolOutput,
  stripFinalAnswerPrefix,
} from "./output-utils.js";

export interface StepExecResult {
  output: string;
  tokens: number;
  cost: number;
  success: boolean;
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
  readonly maxRequiredToolRetries?: number;
  readonly modelId?: string;
  readonly synthesisConfig?: import("../../context/synthesis-types.js").SynthesisConfig;
}

/**
 * Execute a single plan step based on its type:
 * - tool_call: direct tool dispatch via toolService.execute
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
    // Direct tool dispatch — no LLM kernel needed
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

      const toolStart = Date.now();

      yield* emitLog({
        _tag: "tool_call",
        tool: step.toolName!,
        iteration: stepIndex + 1,
        timestamp: new Date(),
      });

      // Publish ToolCallStarted with the step's intentional rationale so
      // execution-engine collects it into the debrief. plan-execute owns
      // tool dispatch directly (no kernel act-phase), so without this
      // hand-off the rationale never reaches the rationaleLog subscriber.
      yield* publishReasoningStep(services.eventBus, {
        _tag: "ToolCallStarted",
        taskId: input.taskId ?? "plan-execute",
        toolName: step.toolName!,
        callId: `${plan.id}_${step.id}`,
        ...(step.rationale && step.rationale.why
          ? { rationale: { why: step.rationale.why, ...(typeof step.rationale.confidence === "number" ? { confidence: step.rationale.confidence } : {}) } }
          : {}),
        kernelPass: `plan-execute:step-${stepIndex + 1}`,
      });

      const toolResult = yield* toolService.value
        .execute({
          toolName: step.toolName!,
          arguments: resolvedArgs,
          agentId: input.agentId ?? "reasoning-agent",
          sessionId: input.sessionId ?? "reasoning-session",
        })
        .pipe(
          Effect.tapError(
            (e) => {
              const toolDurationMs = Date.now() - toolStart;
              return emitLog({
                _tag: "tool_result",
                tool: step.toolName!,
                duration: toolDurationMs,
                status: "error",
                error: String(e),
                timestamp: new Date(),
              });
            }
          ),
          Effect.mapError(
            (e) =>
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Tool ${step.toolName} failed: ${String(e)}`,
                step: stepIndex,
                cause: e,
              }),
          ),
        );
      const toolDurationMs = Date.now() - toolStart;

      yield* emitLog({
        _tag: "tool_result",
        tool: step.toolName!,
        duration: toolDurationMs,
        status: "success",
        timestamp: new Date(),
      });

      // Publish ToolCallCompleted so MetricsCollector tracks tool execution
      yield* publishReasoningStep(services.eventBus, {
        _tag: "ToolCallCompleted",
        taskId: input.taskId ?? "plan-execute",
        toolName: step.toolName!,
        callId: `${plan.id}_${step.id}`,
        durationMs: toolDurationMs,
        success: toolResult.success !== false,
        kernelPass: `plan-execute:step-${stepIndex + 1}`,
        ...(step.toolArgs !== undefined ? { args: step.toolArgs } : {}),
        ...(toolResult.success !== false ? { result: toolResult.result } : { error: String(toolResult.result) }),
      });

      const rawOutput =
        typeof toolResult.result === "string"
          ? toolResult.result
          : JSON.stringify(toolResult.result);

      // Sanitize tool_call output: strip internal metadata (args, recipient, raw JSON)
      // so it doesn't leak into downstream steps or final synthesis.
      // Data-fetching tools keep full output; action tools get a clean confirmation.
      const sanitized = sanitizeToolOutput(step.toolName!, rawOutput, resolvedArgs);

      // Structured-result compression — symmetric to kernel/act path. Without
      // this, plan-execute shipped raw 50KB+ MCP arrays (github/list_commits)
      // into the next step's prompt AND the reflection prompt, blowing local-tier
      // context and triggering fabrication-from-training (MCP probe M2/M3:
      // composite 15-20%). The kernel's `compressToolResult` already produces
      // a fit-aware preview with scratchpad pointer — reuse it here.
      const compressionBudget = input.resultCompression?.budget ?? 2000;
      const compressionPreviewItems = input.resultCompression?.previewItems ?? 8;
      const compressed = compressToolResult(
        sanitized,
        step.toolName!,
        compressionBudget,
        compressionPreviewItems,
      );

      return {
        output: compressed.content,
        tokens: 0,
        cost: 0,
        success: toolResult.success !== false,
      };
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
    maxRequiredToolRetries: input.maxRequiredToolRetries,
    modelId: input.modelId,
    exitOnAllToolsCalled: true,
    synthesisConfig: input.synthesisConfig,
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
