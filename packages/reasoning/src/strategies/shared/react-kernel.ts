/**
 * ReAct Kernel — the shared execution primitive for all reasoning strategies.
 *
 * Implements: Think → Parse Action → Execute Tool → Observe → Repeat
 *
 * This kernel is what makes every strategy "tool-aware". Strategies define
 * their outer control loop (how many kernel calls, when to retry, how to
 * assess quality). The kernel handles all tool interaction.
 *
 * Extracted from reactive.ts — the inner `while (iteration < maxIter)` loop,
 * `runToolObservation`, and `resolveToolArgs` are faithfully reproduced here
 * so this file is a complete standalone execution primitive.
 */
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningStep } from "../../types/index.js";
import type { StepId } from "../../types/step.js";
import type { ObservationResult } from "../../types/observation.js";
import { categorizeToolName, deriveResultKind } from "../../types/observation.js";
import { ExecutionError } from "../../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import type { ToolDefinition, ToolOutput, ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../../context/context-profile.js";
import { CONTEXT_PROFILES } from "../../context/context-profile.js";
import {
  parseAllToolRequests,
  hasFinalAnswer,
  extractFinalAnswer,
  evaluateTransform,
  formatToolSchemas,
  compressToolResult,
  nextToolResultKey,
} from "./tool-utils.js";
import type { ToolSchema } from "./tool-utils.js";
import { resolveStrategyServices, publishReasoningStep } from "./service-utils.js";
import { buildCompactedContext } from "./context-utils.js";

// ── Public input / output types ──────────────────────────────────────────────

export interface ReActKernelInput {
  /** The task description to accomplish */
  task: string;
  /** Optional custom system prompt for steering behavior */
  systemPrompt?: string;
  /** Full tool schemas — passed from execution engine via availableToolSchemas */
  availableToolSchemas?: readonly ToolSchema[];
  /**
   * Optional prior context to inject above the task.
   * Used by Reflexion (critique text), Plan-Execute (plan context), etc.
   */
  priorContext?: string;
  /** Maximum iterations before giving up. Default: 10 */
  maxIterations?: number;
  /** Model context profile controlling compaction thresholds, result sizes, etc. */
  contextProfile?: ContextProfile;
  /** Tool result compression configuration */
  resultCompression?: ResultCompressionConfig;
  /** LLM sampling temperature */
  temperature?: number;
  /** Task ID for EventBus correlation */
  taskId?: string;
  /** Name of the calling strategy (for event tagging) */
  parentStrategy?: string;
}

export interface ReActKernelResult {
  /** Final answer text */
  output: string;
  /** All reasoning steps (thought / action / observation) */
  steps: ReasoningStep[];
  /** Total tokens consumed across all LLM calls */
  totalTokens: number;
  /** Total estimated cost */
  totalCost: number;
  /** Distinct tool names that were called at least once */
  toolsUsed: string[];
  /** Number of iterations completed */
  iterations: number;
  /** How the loop terminated */
  terminatedBy: "final_answer" | "max_iterations" | "end_turn";
}

// ── Kernel entry point ────────────────────────────────────────────────────────

/**
 * Execute the ReAct Think→Act→Observe loop.
 *
 * Works with or without ToolService in context.
 * When ToolService is absent every iteration is pure thought (tool calls
 * produce a "not available" observation rather than real results).
 */
export const executeReActKernel = (
  input: ReActKernelInput,
): Effect.Effect<ReActKernelResult, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    const services = yield* resolveStrategyServices;
    const { llm, toolService, promptService: _promptService, eventBus } = services;

    const profile: ContextProfile = input.contextProfile ?? CONTEXT_PROFILES["mid"];
    const maxIter = input.maxIterations ?? profile.maxIterations ?? 10;
    const temp = input.temperature ?? profile.temperature ?? 0.7;
    const strategy = input.parentStrategy ?? "react-kernel";

    const steps: ReasoningStep[] = [];
    const toolsUsed = new Set<string>();
    const scratchpadStore = new Map<string, string>();
    let iteration = 0;
    let totalTokens = 0;
    let totalCost = 0;

    // Build initial context string
    const toolSection =
      input.availableToolSchemas && input.availableToolSchemas.length > 0
        ? `Available Tools:\n${formatToolSchemas(input.availableToolSchemas)}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.`
        : "No tools available for this task.";

    const priorSection = input.priorContext ? `\n\n${input.priorContext}` : "";

    const initialContext = `Task: ${input.task}\n\n${toolSection}${priorSection}`;

    // System prompt
    const systemPromptText = input.systemPrompt
      ? `${input.systemPrompt}\n\nTask: ${input.task}`
      : `You are a reasoning agent. Task: ${input.task}`;

    // ── Main ReAct loop ───────────────────────────────────────────────────────
    while (iteration < maxIter) {
      // Build compacted context from initial context + accumulated steps
      const context = buildCompactedContext(initialContext, steps, profile);

      // Add completed-actions summary (skip already-done steps)
      const completedSummary = buildCompletedSummary(steps);

      const thoughtPrompt = `${context}${completedSummary}

RULES:
1. ONE action per turn. Wait for the real result before proceeding.
2. Use EXACT parameter names from tool schemas above — do NOT guess parameter names.
3. When you have ALL required information, immediately write: FINAL ANSWER: <your answer>
4. Check 'ALREADY DONE' above before planning. If step 1 is already done, start your plan at the FIRST step that is NOT listed there.
5. For file paths not specified in the task, choose a reasonable path (e.g., ./output.md).
6. Do NOT fabricate results — wait for the real tool response.
7. Trust your tool results. Once a file-write succeeds or a file-read returns content, the action is done — do NOT repeat it.

Think step-by-step, then either take ONE action or give your FINAL ANSWER:`;

      // ── THOUGHT ────────────────────────────────────────────────────────────
      const thoughtResponse = yield* llm
        .complete({
          messages: [{ role: "user", content: thoughtPrompt }],
          systemPrompt: systemPromptText,
          maxTokens: 1500,
          temperature: temp,
          stopSequences: ["Observation:", "\nObservation:"],
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy,
                message: `LLM thought failed at iteration ${iteration}: ${
                  err && typeof err === "object" && "message" in err
                    ? (err as { message: string }).message
                    : String(err)
                }`,
                step: iteration,
                cause: err,
              }),
          ),
        );

      const thought = thoughtResponse.content;
      totalTokens += thoughtResponse.usage.totalTokens;
      totalCost += thoughtResponse.usage.estimatedCost;

      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: thought,
        timestamp: new Date(),
      });

      // Publish thought event
      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? strategy,
        strategy,
        step: steps.length,
        totalSteps: maxIter,
        thought,
      });

      // ── ACTION SELECTION ────────────────────────────────────────────────────
      // Smart action selection: skip already-succeeded actions so we advance
      // to the first genuinely uncompleted step.
      const allToolRequests = parseAllToolRequests(thought);
      const toolRequest =
        allToolRequests.find((req) => {
          const actionJson = JSON.stringify(req);
          return !steps.some((step, idx) => {
            if (step.type !== "action") return false;
            if (step.content !== actionJson) return false;
            const nextStep = steps[idx + 1];
            return (
              nextStep?.type === "observation" &&
              nextStep.metadata?.observationResult?.success === true
            );
          });
        }) ??
        allToolRequests[0] ??
        null;

      // ── FINAL ANSWER CHECK (no pending action) ──────────────────────────────
      if (!toolRequest && hasFinalAnswer(thought)) {
        const finalAnswer = extractFinalAnswer(thought);
        yield* publishReasoningStep(eventBus, {
          _tag: "FinalAnswerProduced",
          taskId: input.taskId ?? strategy,
          strategy,
          answer: finalAnswer,
          iteration,
          totalTokens: totalCost,
        });
        return {
          output: finalAnswer,
          steps: [...steps],
          totalTokens,
          totalCost,
          toolsUsed: [...toolsUsed],
          iterations: iteration + 1,
          terminatedBy: "final_answer" as const,
        };
      }

      // ── EARLY END_TURN TERMINATION ──────────────────────────────────────────
      // If the model stops naturally with a substantive response and no tool call
      // after at least one iteration, treat it as a final answer.
      if (
        !toolRequest &&
        iteration >= 1 &&
        thought.trim().length >= 50 &&
        (thoughtResponse as { stopReason?: string }).stopReason === "end_turn"
      ) {
        return {
          output: thought.trim(),
          steps: [...steps],
          totalTokens,
          totalCost,
          toolsUsed: [...toolsUsed],
          iterations: iteration + 1,
          terminatedBy: "end_turn" as const,
        };
      }

      // ── TOOL EXECUTION ──────────────────────────────────────────────────────
      if (toolRequest) {
        const currentActionJson = JSON.stringify(toolRequest);

        // Duplicate detection — has this exact action already succeeded?
        const isDuplicate = steps.some((step, idx) => {
          if (step.type !== "action") return false;
          if (step.content !== currentActionJson) return false;
          const nextStep = steps[idx + 1];
          return (
            nextStep?.type === "observation" &&
            nextStep.metadata?.observationResult?.success === true
          );
        });

        steps.push({
          id: ulid() as StepId,
          type: "action",
          content: currentActionJson,
          timestamp: new Date(),
          metadata: { toolUsed: toolRequest.tool },
        });

        toolsUsed.add(toolRequest.tool);

        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? strategy,
          strategy,
          step: steps.length,
          totalSteps: maxIter,
          action: currentActionJson,
        });

        let observationContent: string;
        let obsResult: ObservationResult;

        if (isDuplicate) {
          // Surface prior result with advisory — don't re-execute
          const priorSuccessObs = steps.find((step, idx) => {
            if (step.type !== "action" || step.content !== currentActionJson) return false;
            const next = steps[idx + 1];
            return (
              next?.type === "observation" &&
              next.metadata?.observationResult?.success === true
            );
          });
          const priorObsStep = priorSuccessObs
            ? steps[steps.indexOf(priorSuccessObs) + 1]
            : undefined;
          const priorObsContent = priorObsStep?.content ?? "";
          observationContent = `${priorObsContent} [Already done — do NOT repeat. Continue with next task step or give FINAL ANSWER if all steps are complete.]`;
          obsResult = priorObsStep?.metadata?.observationResult ??
            makeObservationResult(toolRequest.tool, true, observationContent);
        } else {
          const toolStartMs = Date.now();
          const toolObs = yield* runKernelToolObservation(
            toolService as { _tag: "Some"; value: KernelToolServiceInstance } | { _tag: "None" },
            toolRequest,
            profile,
            input.resultCompression,
            scratchpadStore,
          );
          const toolDurationMs = Date.now() - toolStartMs;
          observationContent = toolObs.content;
          obsResult = toolObs.observationResult;

          // Store actual duration in action step metadata
          const lastStep = steps[steps.length - 1];
          if (lastStep?.type === "action") {
            steps[steps.length - 1] = {
              ...lastStep,
              metadata: { ...(lastStep.metadata ?? {}), duration: toolDurationMs },
            };
          }

          // Publish ToolCallCompleted for MetricsCollector
          yield* publishReasoningStep(eventBus, {
            _tag: "ToolCallCompleted",
            taskId: input.taskId ?? strategy,
            toolName: toolRequest.tool,
            callId: lastStep?.id ?? "unknown",
            durationMs: toolDurationMs,
            success: obsResult.success,
          });
        }

        steps.push({
          id: ulid() as StepId,
          type: "observation",
          content: observationContent,
          timestamp: new Date(),
          metadata: { observationResult: obsResult },
        });

        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? strategy,
          strategy,
          step: steps.length,
          totalSteps: maxIter,
          observation: observationContent,
        });

        // If the thought also contained a FINAL ANSWER after the action, return now
        if (hasFinalAnswer(thought)) {
          iteration++;
          const finalAnswer = extractFinalAnswer(thought);
          yield* publishReasoningStep(eventBus, {
            _tag: "FinalAnswerProduced",
            taskId: input.taskId ?? strategy,
            strategy,
            answer: finalAnswer,
            iteration,
            totalTokens: totalCost,
          });
          return {
            output: finalAnswer,
            steps: [...steps],
            totalTokens,
            totalCost,
            toolsUsed: [...toolsUsed],
            iterations: iteration,
            terminatedBy: "final_answer" as const,
          };
        }
      }

      iteration++;
    }

    // Max iterations reached — return last thought as partial output
    const lastThought =
      steps.filter((s) => s.type === "thought").pop()?.content ?? "";
    return {
      output: lastThought,
      steps: [...steps],
      totalTokens,
      totalCost,
      toolsUsed: [...toolsUsed],
      iterations: iteration,
      terminatedBy: "max_iterations" as const,
    };
  });

// ── Private helpers ───────────────────────────────────────────────────────────

/** Narrow ToolService surface used internally by the kernel */
type KernelToolServiceInstance = {
  readonly execute: (input: {
    toolName: string;
    arguments: Record<string, unknown>;
    agentId: string;
    sessionId: string;
  }) => Effect.Effect<ToolOutput, unknown>;
  readonly getTool: (name: string) => Effect.Effect<ToolDefinition, unknown>;
};

interface KernelToolObservationOutput {
  readonly content: string;
  readonly observationResult: ObservationResult;
}

/** Build ObservationResult from tool name + success + display text */
function makeObservationResult(
  toolName: string,
  success: boolean,
  displayText: string,
): ObservationResult {
  const category = categorizeToolName(toolName);
  const resultKind = deriveResultKind(category, success);
  const preserveOnCompaction = !success || category === "error";
  return { success, toolName, displayText, category, resultKind, preserveOnCompaction };
}

/**
 * Simple head+tail truncation for when structured compression is not available.
 */
function truncateForDisplay(result: string, maxChars: number): string {
  if (result.length <= maxChars) return result;
  const half = Math.floor(maxChars / 2);
  const omitted = result.length - maxChars;
  return `${result.slice(0, half)}\n[...${omitted} chars omitted...]\n${result.slice(-half)}`;
}

/**
 * Normalize Python-style triple-quoted strings ("""...""") to valid JSON strings.
 */
function normalizeTripleQuotes(input: string): string {
  return input.replace(/"""([\s\S]*?)"""/g, (_, content: string) => {
    const escaped = content
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    return `"${escaped}"`;
  });
}

/**
 * Normalize tool-specific raw output to compact semantic representations.
 */
function normalizeObservation(toolName: string, result: string): string {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;

    if (toolName === "file-write" && parsed.written === true) {
      const rawPath = String(parsed.path ?? "file");
      const path = rawPath.includes("/") ? `./${rawPath.split("/").pop()}` : rawPath;
      return `✓ Written to ${path}`;
    }

    if (toolName === "code-execute" && parsed.executed === false) {
      return "[Code execution unavailable — compute from first principles]";
    }

    if (toolName === "web-search" && Array.isArray(parsed.results)) {
      const lines = (parsed.results as Array<{ title?: string; url?: string }>)
        .slice(0, 5)
        .map((r, i) => `${i + 1}. ${r.title ?? "result"}: ${r.url ?? ""}`)
        .join("\n");
      return lines || result;
    }

    if (toolName === "http-get" && typeof parsed.content === "string") {
      return parsed.content;
    }

    if (typeof parsed.subAgentName === "string" && typeof parsed.summary === "string") {
      const prefix = parsed.success ? "✓" : "✗";
      const tokStr =
        typeof parsed.tokensUsed === "number" && parsed.tokensUsed > 0
          ? ` | ${parsed.tokensUsed} tok`
          : "";
      return `${prefix} [Sub-agent "${parsed.subAgentName}"${tokStr}]: ${String(parsed.summary).slice(0, 500)}`;
    }
  } catch {
    // Not JSON — return as-is
  }
  return result;
}

/**
 * Resolve tool arguments from the raw ACTION string.
 * Handles JSON objects, malformed JSON, and plain string→first-param mapping.
 */
function resolveKernelToolArgs(
  toolService: KernelToolServiceInstance,
  toolRequest: { tool: string; input: string },
): Effect.Effect<Record<string, unknown>, never> {
  const trimmed = normalizeTripleQuotes(toolRequest.input.trim());

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return Effect.succeed(parsed as Record<string, unknown>);
      }
    } catch {
      return toolService
        .getTool(toolRequest.tool)
        .pipe(
          Effect.flatMap((toolDef: ToolDefinition) => {
            const requiredParams = toolDef.parameters.filter(
              (p: { required?: boolean }) => p.required,
            );
            if (requiredParams.length > 1) {
              const paramNames = requiredParams.map((p: { name: string }) => p.name).join(", ");
              return Effect.succeed({
                _parseError: true,
                error: `Malformed JSON for tool "${toolRequest.tool}". Expected JSON with keys: ${paramNames}. Got: ${trimmed.slice(0, 100)}...`,
              } as Record<string, unknown>);
            }
            const firstParam = requiredParams[0] ?? toolDef.parameters[0];
            return Effect.succeed(
              firstParam
                ? ({ [firstParam.name]: trimmed } as Record<string, unknown>)
                : ({ input: trimmed } as Record<string, unknown>),
            );
          }),
          Effect.catchAll(() =>
            Effect.succeed({ input: trimmed } as Record<string, unknown>),
          ),
        );
    }
  }

  return toolService
    .getTool(toolRequest.tool)
    .pipe(
      Effect.map((toolDef: ToolDefinition) => {
        const firstParam =
          toolDef.parameters.find((p: { required?: boolean }) => p.required) ??
          toolDef.parameters[0];
        if (firstParam) {
          return { [firstParam.name]: trimmed } as Record<string, unknown>;
        }
        return { input: trimmed } as Record<string, unknown>;
      }),
      Effect.catchAll(() =>
        Effect.succeed({ input: trimmed } as Record<string, unknown>),
      ),
    );
}

/**
 * Execute a single tool call and produce a structured observation.
 * Mirrors reactive.ts's runToolObservation() exactly.
 */
function runKernelToolObservation(
  toolServiceOpt: { _tag: "Some"; value: KernelToolServiceInstance } | { _tag: "None" },
  toolRequest: { tool: string; input: string; transform?: string },
  profile?: ContextProfile,
  compressionConfig?: ResultCompressionConfig,
  scratchpadStore?: Map<string, string>,
): Effect.Effect<KernelToolObservationOutput, never> {
  // Short-circuit scratchpad-read for auto-stored tool results
  if (
    toolRequest.tool === "scratchpad-read" &&
    scratchpadStore &&
    scratchpadStore.size > 0
  ) {
    try {
      const args = JSON.parse(toolRequest.input) as { key?: string } | string;
      const key = typeof args === "string" ? args : (args.key ?? "");
      if (scratchpadStore.has(key)) {
        const value = scratchpadStore.get(key)!;
        const budget = compressionConfig?.budget ?? profile?.toolResultMaxChars ?? 800;
        const content = truncateForDisplay(value, budget);
        return Effect.succeed({
          content,
          observationResult: makeObservationResult("scratchpad-read", true, content),
        });
      }
    } catch {
      // fall through to normal scratchpad-read tool execution
    }
  }

  if (toolServiceOpt._tag === "None") {
    const content = `[Tool "${toolRequest.tool}" requested but ToolService is not available — add .withTools() to agent builder]`;
    return Effect.succeed({
      content,
      observationResult: makeObservationResult(toolRequest.tool, false, content),
    });
  }

  const toolService = toolServiceOpt.value;

  return Effect.gen(function* () {
    const args = yield* resolveKernelToolArgs(toolService, toolRequest);

    const result = yield* toolService
      .execute({
        toolName: toolRequest.tool,
        arguments: args,
        agentId: "reasoning-agent",
        sessionId: "reasoning-session",
      })
      .pipe(
        Effect.map((r: ToolOutput) => {
          const raw = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
          const normalized = normalizeObservation(toolRequest.tool, raw);

          // Pipe transform — evaluate in-process, inject only transformed result
          if (toolRequest.transform && (compressionConfig?.codeTransform ?? true)) {
            let parsed: unknown = normalized;
            try {
              parsed = JSON.parse(normalized);
            } catch {
              /* use string */
            }
            const transformed = evaluateTransform(toolRequest.transform, parsed);
            if ((compressionConfig?.autoStore ?? true) && scratchpadStore) {
              const key = nextToolResultKey();
              scratchpadStore.set(key, normalized);
            }
            const isSuccess = !transformed.startsWith("[Transform error:");
            return {
              content: transformed,
              observationResult: makeObservationResult(toolRequest.tool, isSuccess, transformed),
            } satisfies KernelToolObservationOutput;
          }

          // Structured compression / auto-preview
          const budget = compressionConfig?.budget ?? profile?.toolResultMaxChars ?? 800;
          const previewItems = compressionConfig?.previewItems ?? 3;
          const autoStore = compressionConfig?.autoStore ?? true;
          const compressed = compressToolResult(normalized, toolRequest.tool, budget, previewItems);
          if (autoStore && compressed.stored && scratchpadStore) {
            scratchpadStore.set(compressed.stored.key, compressed.stored.value);
          }
          const content = compressed.content;
          return {
            content,
            observationResult: makeObservationResult(toolRequest.tool, r.success !== false, content),
          } satisfies KernelToolObservationOutput;
        }),
        Effect.catchAll((e) => {
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === "object" && e !== null && "message" in e
                ? String((e as { message: unknown }).message)
                : String(e);
          return toolService.getTool(toolRequest.tool).pipe(
            Effect.map((toolDef: ToolDefinition) => {
              const paramHints = toolDef.parameters
                .map((p) => `"${p.name}": "${p.type}${p.required ? ", required" : ", optional"}"`)
                .join(", ");
              const content = `[Tool error: ${msg}] Expected: ${toolRequest.tool}({${paramHints}})`;
              return {
                content,
                observationResult: makeObservationResult(toolRequest.tool, false, content),
              } satisfies KernelToolObservationOutput;
            }),
            Effect.catchAll(() => {
              const content = `[Tool error: ${msg}]`;
              return Effect.succeed({
                content,
                observationResult: makeObservationResult(toolRequest.tool, false, content),
              } satisfies KernelToolObservationOutput);
            }),
          );
        }),
      );

    return result;
  }).pipe(
    Effect.catchAll((e) => {
      const content = `[Unexpected error executing tool: ${String(e)}]`;
      return Effect.succeed({
        content,
        observationResult: makeObservationResult(toolRequest.tool, false, content),
      } satisfies KernelToolObservationOutput);
    }),
  );
}

/**
 * Build a summary of already-completed (successful) observations.
 * Used to guide the model away from repeating done steps.
 */
function buildCompletedSummary(steps: readonly ReasoningStep[]): string {
  const successes: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.type === "observation") {
      if (step.metadata?.observationResult?.success !== true) continue;
      const c = step.content.trim();
      const key = c.slice(0, 60);
      if (!seen.has(key)) {
        seen.add(key);
        successes.push(c.length > 80 ? c.slice(0, 80) + "…" : c);
      }
    }
  }
  if (successes.length === 0) return "";
  return (
    `\n\nALREADY DONE — skip these, choose only from the REMAINING steps:\n${successes.map((s) => `- ${s}`).join("\n")}` +
    `\n← Your NEXT action must be a step that is NOT listed above. →`
  );
}
