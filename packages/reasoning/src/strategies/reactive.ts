// File: src/strategies/reactive.ts
import { Effect } from "effect";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import type { ObservationResult } from "../types/observation.js";
import { categorizeToolName, deriveResultKind } from "../types/observation.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ToolDefinition, ToolOutput, ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import { CONTEXT_PROFILES } from "../context/context-profile.js";
import {
  parseAllToolRequests,
  hasFinalAnswer,
  extractFinalAnswer,
  evaluateTransform,
  compressToolResult,
  nextToolResultKey,
} from "./shared/tool-utils.js";
export type { CompressResult } from "./shared/tool-utils.js";
import { buildCompactedContext } from "./shared/context-utils.js";
import { compilePromptOrFallback, resolveStrategyServices } from "./shared/service-utils.js";
import { makeStep } from "./shared/step-utils.js";

// Re-export shared utilities for backwards compatibility
export { evaluateTransform, compressToolResult } from "./shared/tool-utils.js";

// parseToolRequestWithTransform is the public name used by tests — re-export the
// shared `parseToolRequest` under the legacy export name, keeping the old behaviour
// (same algorithm — parse + optional transform expression).
export { parseToolRequest as parseToolRequestWithTransform } from "./shared/tool-utils.js";

import type { ToolSchema } from "./shared/tool-utils.js";

interface ReactiveInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  /** Full tool schemas with parameter info — preferred over toolNames */
  readonly availableToolSchemas?: readonly ToolSchema[];
  /** Fallback: tool names only (legacy) */
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
  /** Model context profile — controls compaction thresholds, verbosity, tool result sizes. */
  readonly contextProfile?: ContextProfile;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Task ID for event correlation */
  readonly taskId?: string;
  /** Tool result compression config — controls preview size, scratchpad overflow, and pipe transforms. */
  readonly resultCompression?: ResultCompressionConfig;
}

/**
 * ReAct loop: Thought -> Action -> Observation, iterating until done.
 *
 * When ToolService is available in context, ACTION calls are executed
 * against real registered tools and results are fed back as observations.
 * Without ToolService, tool calls are noted as unavailable.
 */
export const executeReactive = (
  input: ReactiveInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const { llm, toolService: toolServiceOpt, promptService: promptServiceOpt, eventBus: ebOpt } =
      yield* resolveStrategyServices;

    // Resolve context profile — use provided profile, or default to "mid"
    const profile: ContextProfile = input.contextProfile ?? CONTEXT_PROFILES["mid"];

    const maxIter = input.contextProfile?.maxIterations ?? input.config.strategies.reactive.maxIterations;
    const temp = input.contextProfile?.temperature ?? input.config.strategies.reactive.temperature;
    const steps: ReasoningStep[] = [];
    const start = Date.now();
    const scratchpadStore = new Map<string, string>();

    const fullInitialContext = buildInitialContext(input, false, profile);
    const compactInitialContext = buildInitialContext(input, true, profile);
    let iteration = 0;
    let totalTokens = 0;
    let totalCost = 0;

    while (iteration < maxIter) {
      // After the first complete tool cycle (action + observation in steps), switch to
      // compact initial context — tool schemas drop from ~100 tokens to ~15 tokens per call.
      const hasCompletedToolCycle =
        steps.some((s) => s.type === "action") &&
        steps.some((s) => s.type === "observation");
      const baseContext = hasCompletedToolCycle ? compactInitialContext : fullInitialContext;
      // Build context for this iteration — compacted when steps exceed threshold
      const context = buildCompactedContext(baseContext, steps, profile);

      // ── THOUGHT ──
      // Use PromptService for system prompt if available
      const defaultFallback = input.systemPrompt
        ? `${input.systemPrompt}\n\nTask: ${input.taskDescription}`
        : `You are a reasoning agent. Task: ${input.taskDescription}`;

      const systemPrompt = yield* compilePromptOrFallback(
        promptServiceOpt,
        "reasoning.react-system",
        { task: input.taskDescription },
        defaultFallback,
        profile.tier,
      );
      const thoughtContent = yield* compilePromptOrFallback(
        promptServiceOpt,
        "reasoning.react-thought",
        {
          context,
          history: steps.map((s) => `[${s.type}] ${s.content}`).join("\n"),
        },
        buildThoughtPrompt(context, steps, profile),
        profile.tier,
      );

      const thoughtResponse = yield* llm
        .complete({
          messages: [
            { role: "user", content: thoughtContent },
          ],
          systemPrompt,
          maxTokens: 1500,
          temperature: temp,
          // Stop before the model fabricates its own Observation — the framework
          // provides real observations after executing the tool.
          stopSequences: ["Observation:", "\nObservation:"],
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "reactive",
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

      steps.push(makeStep("thought", thought));

      // Publish ReasoningStepCompleted for thought
      if (ebOpt._tag === "Some") {
        yield* ebOpt.value.publish({
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "reactive",
          strategy: "reactive",
          step: steps.length,
          totalSteps: maxIter,
          thought,
        }).pipe(Effect.catchAll(() => Effect.void));
      }

      // ── ACTION: check for tool call BEFORE final answer check.
      // If the model outputs both ACTION and FINAL ANSWER in one response
      // (a common issue without stop sequences), execute the action first
      // so the framework provides a real observation rather than returning
      // the raw hallucinated text.
      //
      // Smart action selection: if the model wrote a multi-step plan with multiple
      // ACTION lines (e.g. step 1: ACTION chain_a, step 2: ACTION chain_b), skip
      // any that already have a prior ✓ observation in the history so we advance
      // to the first genuinely uncompleted step instead of looping on step 1.
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

      // ── CHECK: does the thought indicate a final answer (and no pending action)? ──
      if (!toolRequest && hasFinalAnswer(thought)) {
        const finalAnswer = extractFinalAnswer(thought);
        if (ebOpt._tag === "Some") {
          yield* ebOpt.value.publish({
            _tag: "FinalAnswerProduced",
            taskId: input.taskId ?? "reactive",
            strategy: "reactive",
            answer: finalAnswer,
            iteration,
            totalTokens: totalCost,
          }).pipe(Effect.catchAll(() => Effect.void));
        }
        return buildResult(
          steps,
          finalAnswer,
          "completed",
          start,
          totalTokens,
          totalCost,
        );
      }

      // ── EARLY TERMINATION: model gave a complete prose response with no tool call ──
      // If the model stops naturally (end_turn) with no tool request and no
      // explicit FINAL ANSWER marker after at least one iteration, treat the
      // response as the final answer rather than spinning needlessly.
      // Require >= 50 chars to avoid triggering on short/default responses.
      if (
        !toolRequest &&
        iteration >= 1 &&
        thought.trim().length >= 50 &&
        (thoughtResponse as { stopReason?: string }).stopReason === "end_turn"
      ) {
        return buildResult(steps, thought.trim(), "completed", start, totalTokens, totalCost);
      }
      if (toolRequest) {
        const currentActionJson = JSON.stringify(toolRequest);

        // ── DUPLICATE ACTION PRE-CHECK ──────────────────────────────────────
        // Check if this exact action already succeeded ANYWHERE in the history
        // (not just the last iteration). Non-consecutive duplicate detection
        // catches patterns like chain_a→chain_b→chain_c→chain_a where the
        // consecutive check would miss the second chain_a write.
        // Only triggers for ✓ observations (file-writes) — reads are excluded
        // since their results don't start with ✓.
        const isDuplicate = steps.some((step, idx) => {
          if (step.type !== "action") return false;
          if (step.content !== currentActionJson) return false;
          const nextStep = steps[idx + 1];
          return (
            nextStep?.type === "observation" &&
            nextStep.metadata?.observationResult?.success === true
          );
        });

        steps.push(makeStep("action", currentActionJson, { toolUsed: toolRequest.tool }));

        // Publish ReasoningStepCompleted for action
        if (ebOpt._tag === "Some") {
          yield* ebOpt.value.publish({
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "reactive",
            strategy: "reactive",
            step: steps.length,
            totalSteps: maxIter,
            action: currentActionJson,
          }).pipe(Effect.catchAll(() => Effect.void));
        }

        // Execute tool OR inject duplicate warning (skip re-execution).
        // For duplicates, surface the prior result with an advisory.
        let observationContent: string;
        let obsResult: ObservationResult;

        if (isDuplicate) {
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
          obsResult = priorObsStep?.metadata?.observationResult ?? makeObservationResult(toolRequest.tool, true, observationContent);
        } else {
          const toolStartMs = Date.now();
          const toolObs = yield* runToolObservation(
            toolServiceOpt as { _tag: "Some"; value: ToolServiceInstance } | { _tag: "None" },
            toolRequest,
            input,
            profile,
            input.resultCompression,
            scratchpadStore,
          );
          const toolDurationMs = Date.now() - toolStartMs;
          observationContent = toolObs.content;
          obsResult = toolObs.observationResult;

          // Store actual duration in action step metadata for metric extraction
          const lastStep = steps[steps.length - 1];
          if (lastStep?.type === "action") {
            steps[steps.length - 1] = {
              ...lastStep,
              metadata: { ...(lastStep.metadata ?? {}), duration: toolDurationMs },
            };
          }

          // Publish ToolCallCompleted so MetricsCollector tracks tool execution from reasoning path
          if (ebOpt._tag === "Some") {
            yield* ebOpt.value.publish({
              _tag: "ToolCallCompleted",
              taskId: input.taskId ?? "reactive",
              toolName: toolRequest.tool,
              callId: lastStep?.id ?? "unknown",
              durationMs: toolDurationMs,
              success: obsResult.success,
            }).pipe(Effect.catchAll(() => Effect.void));
          }
        }

        steps.push(makeStep("observation", observationContent, { observationResult: obsResult }));

        // Publish ReasoningStepCompleted for observation
        if (ebOpt._tag === "Some") {
          yield* ebOpt.value.publish({
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "reactive",
            strategy: "reactive",
            step: steps.length,
            totalSteps: maxIter,
            observation: observationContent,
          }).pipe(Effect.catchAll(() => Effect.void));
        }

        // After executing the action, check if the original thought also had
        // a FINAL ANSWER — if so, we're done (no need for another LLM call).
        if (hasFinalAnswer(thought)) {
          iteration++;
          const finalAnswer = extractFinalAnswer(thought);
          if (ebOpt._tag === "Some") {
            yield* ebOpt.value.publish({
              _tag: "FinalAnswerProduced",
              taskId: input.taskId ?? "reactive",
              strategy: "reactive",
              answer: finalAnswer,
              iteration,
              totalTokens: totalCost,
            }).pipe(Effect.catchAll(() => Effect.void));
          }
          return buildResult(steps, finalAnswer, "completed", start, totalTokens, totalCost);
        }
      }
      // Context is rebuilt from steps at the top of each loop iteration via
      // buildCompactedContext — no need to manually append to context.

      iteration++;
    }

    // Max iterations reached — return last thought as partial output rather than null.
    // This ensures callers always get something meaningful even when the agent runs out
    // of iterations mid-task (e.g., complex multi-tool chains with tight iteration budgets).
    const lastThought = steps.filter((s) => s.type === "thought").pop()?.content ?? null;
    return buildResult(steps, lastThought, "partial", start, totalTokens, totalCost);
  });

// ─── Local type alias for the ToolService interface ───

type ToolServiceInstance = {
  readonly execute: (input: {
    toolName: string;
    arguments: Record<string, unknown>;
    agentId: string;
    sessionId: string;
  }) => Effect.Effect<ToolOutput, unknown>;
  readonly getTool: (name: string) => Effect.Effect<ToolDefinition, unknown>;
};

// ─── Tool execution (called from inside Effect.gen, no extra requirements) ───

interface ToolObservationOutput {
  readonly content: string;
  readonly observationResult: ObservationResult;
}

function runToolObservation(
  toolServiceOpt: { _tag: "Some"; value: ToolServiceInstance } | { _tag: "None" },
  toolRequest: { tool: string; input: string; transform?: string },
  _input: ReactiveInput,
  profile?: ContextProfile,
  compressionConfig?: ResultCompressionConfig,
  scratchpadStore?: Map<string, string>,
): Effect.Effect<ToolObservationOutput, never> {
  // Short-circuit scratchpad-read for auto-stored tool results
  if (toolRequest.tool === "scratchpad-read" && scratchpadStore && scratchpadStore.size > 0) {
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
    const args = yield* resolveToolArgs(toolService, toolRequest);

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

          // Layer 2: pipe transform — evaluate in-process, inject only transformed result
          if (toolRequest.transform && (compressionConfig?.codeTransform ?? true)) {
            let parsed: unknown = normalized;
            try { parsed = JSON.parse(normalized); } catch { /* use string */ }
            const transformed = evaluateTransform(toolRequest.transform, parsed);
            // Store full original for follow-up access even when transform is used
            if ((compressionConfig?.autoStore ?? true) && scratchpadStore) {
              const key = nextToolResultKey();
              scratchpadStore.set(key, normalized);
            }
            const isSuccess = !transformed.startsWith("[Transform error:");
            return {
              content: transformed,
              observationResult: makeObservationResult(toolRequest.tool, isSuccess, transformed),
            } satisfies ToolObservationOutput;
          }

          // Layer 1: auto-preview compression (existing code)
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
          } satisfies ToolObservationOutput;
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
              } satisfies ToolObservationOutput;
            }),
            Effect.catchAll(() => {
              const content = `[Tool error: ${msg}]`;
              return Effect.succeed({
                content,
                observationResult: makeObservationResult(toolRequest.tool, false, content),
              } satisfies ToolObservationOutput);
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
      } satisfies ToolObservationOutput);
    }),
  );
}

/**
 * Normalize Python-style triple-quoted strings ("""...""") to valid JSON strings.
 * Some models (e.g., cogito, smaller Ollama models) produce these in ACTION outputs.
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

function resolveToolArgs(
  toolService: ToolServiceInstance,
  toolRequest: { tool: string; input: string },
): Effect.Effect<Record<string, unknown>, never> {
  const trimmed = normalizeTripleQuotes(toolRequest.input.trim());

  // Try JSON object/array parsing
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return Effect.succeed(parsed as Record<string, unknown>);
      }
    } catch {
      // JSON looks truncated or malformed — check if tool has multiple required params
      return toolService
        .getTool(toolRequest.tool)
        .pipe(
          Effect.flatMap((toolDef: ToolDefinition) => {
            const requiredParams = toolDef.parameters.filter(
              (p: { required?: boolean }) => p.required,
            );
            if (requiredParams.length > 1) {
              // Multi-param tool with broken JSON — don't guess, report the problem
              const paramNames = requiredParams.map((p: { name: string }) => p.name).join(", ");
              return Effect.succeed({
                _parseError: true,
                error: `Malformed JSON for tool "${toolRequest.tool}". Expected JSON with keys: ${paramNames}. Got: ${trimmed.slice(0, 100)}...`,
              } as Record<string, unknown>);
            }
            // Single-param: map raw string to first param
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

  // Map raw string to first required parameter of the tool definition
  return toolService
    .getTool(toolRequest.tool)
    .pipe(
      Effect.map((toolDef: ToolDefinition) => {
        const firstParam =
          toolDef.parameters.find((p: { required?: boolean }) => p.required) ?? toolDef.parameters[0];
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

// ─── Helpers (private to module) ───

function formatToolSchema(tool: ToolSchema): string {
  if (tool.parameters.length === 0) {
    return `- ${tool.name}() — ${tool.description}`;
  }
  const params = tool.parameters
    .map((p) => `"${p.name}": "${p.type}${p.required ? " (required)" : " (optional)"}"`)
    .join(", ");
  return `- ${tool.name}({${params}}) — ${tool.description}`;
}

function formatToolSchemaCompact(tool: ToolSchema): string {
  if (tool.parameters.length === 0) return `- ${tool.name}()`;
  const params = tool.parameters
    .map(p => `${p.name}: ${p.type}${p.required ? "" : "?"}`)
    .join(", ");
  return `- ${tool.name}(${params})`;
}

interface FilteredTools {
  primary: readonly ToolSchema[];   // mentioned in task — full schema
  secondary: readonly ToolSchema[]; // not mentioned — compact/collapsed
}

function filterToolsByRelevance(
  taskDescription: string,
  schemas: readonly ToolSchema[],
): FilteredTools {
  const taskLower = taskDescription.toLowerCase();
  const primary: ToolSchema[] = [];
  const secondary: ToolSchema[] = [];

  for (const tool of schemas) {
    // Check if tool name (or prefix before /) appears in the task description
    const nameVariants = [
      tool.name.toLowerCase(),
      tool.name.split("/").pop()?.toLowerCase() ?? "",
      // Also check without hyphens: "list_commits" matches "list commits"
      tool.name.toLowerCase().replace(/[-_/]/g, " "),
    ];
    const mentioned = nameVariants.some(v => v && taskLower.includes(v));
    (mentioned ? primary : secondary).push(tool);
  }

  return { primary, secondary };
}

function buildInitialContext(input: ReactiveInput, compact = false, profile?: ContextProfile): string {
  const sections: string[] = [
    `Task: ${input.taskDescription}`,
    `Task Type: ${input.taskType}`,
  ];

  // Sprint 3B: omit memory section when empty — saves ~20 tokens per call
  if (input.memoryContext.trim()) {
    sections.push(`Relevant Memory:\n${input.memoryContext}`);
  }

  // Sprint 3A: compact tool reference after first tool cycle (schemas already seen by model)
  if (compact) {
    const toolNames = input.availableToolSchemas && input.availableToolSchemas.length > 0
      ? input.availableToolSchemas.map((t) => t.name).join(", ")
      : input.availableTools.join(", ");
    sections.push(toolNames ? `Tools: ${toolNames}` : "No tools available.");
  } else if (input.availableToolSchemas && input.availableToolSchemas.length > 0) {
    const detail = profile?.toolSchemaDetail ?? "full";
    const compressionNote = [
      ``,
      `TOOL RESULTS:`,
      `Large results are stored automatically. You will see a compact preview:`,
      `  [STORED: _tool_result_1 | tool/name]`,
      `  Type: Array(30) | Schema: sha, commit.message, author.login`,
      `  Preview: [0] sha=abc1234  msg="fix: bug"  ...`,
      `  — use scratchpad-read("_tool_result_1") to access the full result`,
      ``,
      `PIPE TRANSFORMS (optional, advanced):`,
      `To get exactly what you need in one step, append | transform: <expr> to any ACTION:`,
      `  ACTION: github/list_commits({"owner":"x","repo":"y"}) | transform: result.slice(0,3).map(c => ({sha: c.sha.slice(0,7), msg: c.commit.message.split('\\n')[0]}))`,
      `Only the transform output enters context. result = parsed JSON (or raw string if not JSON).`,
    ].join("\n");

    const { primary, secondary } = filterToolsByRelevance(input.taskDescription, input.availableToolSchemas);

    // Primary tools: always full schema (these are what the instruction asks for)
    const primaryLines = primary.map(formatToolSchema).join("\n");

    // Secondary tools: format based on tier
    let secondarySection = "";
    if (secondary.length > 0) {
      if (detail === "names-only") {
        secondarySection = `\nAlso available: ${secondary.map(t => t.name).join(", ")}`;
      } else if (detail === "names-and-types") {
        secondarySection = `\nOther tools:\n${secondary.map(formatToolSchemaCompact).join("\n")}`;
      } else {
        // full: show secondary tools with compact format (types but no descriptions)
        // to reduce noise while keeping usability
        secondarySection = `\nOther tools:\n${secondary.map(formatToolSchemaCompact).join("\n")}`;
      }
    }

    // When ALL tools are secondary (none mentioned in task), use the tier-based format for all
    if (primary.length === 0) {
      if (detail === "names-only") {
        const toolNames = input.availableToolSchemas.map(t => t.name).join(", ");
        sections.push(`Tools: ${toolNames}\nTo use: ACTION: tool_name({"param": "value"})${compressionNote}`);
      } else if (detail === "names-and-types") {
        const toolLines = input.availableToolSchemas.map(formatToolSchemaCompact).join("\n");
        sections.push(`Available Tools:\n${toolLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names.${compressionNote}`);
      } else {
        const toolLines = input.availableToolSchemas.map(formatToolSchema).join("\n");
        sections.push(
          `Available Tools:\n${toolLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.${compressionNote}`
        );
      }
    } else {
      sections.push(
        `Available Tools:\n${primaryLines}${secondarySection}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.${compressionNote}`
      );
    }
  } else if (input.availableTools.length > 0) {
    const compressionNote = [
      ``,
      `TOOL RESULTS:`,
      `Large results are stored automatically. You will see a compact preview:`,
      `  [STORED: _tool_result_1 | tool/name]`,
      `  Type: Array(30) | Schema: sha, commit.message, author.login`,
      `  Preview: [0] sha=abc1234  msg="fix: bug"  ...`,
      `  — use scratchpad-read("_tool_result_1") to access the full result`,
      ``,
      `PIPE TRANSFORMS (optional, advanced):`,
      `To get exactly what you need in one step, append | transform: <expr> to any ACTION:`,
      `  ACTION: github/list_commits({"owner":"x","repo":"y"}) | transform: result.slice(0,3).map(c => ({sha: c.sha.slice(0,7), msg: c.commit.message.split('\\n')[0]}))`,
      `Only the transform output enters context. result = parsed JSON (or raw string if not JSON).`,
    ].join("\n");
    sections.push(`Available Tools: ${input.availableTools.join(", ")}\nTo use a tool: ACTION: tool_name({"param": "value"}) — use JSON for tool arguments.${compressionNote}`);
  } else {
    sections.push("No tools available for this task.");
  }

  return sections.join("\n\n");
}

function buildCompletedSummary(steps: readonly ReasoningStep[]): string {
  // Build a deduplicated list of SUCCESSFUL observations to make completed
  // work front-and-center. Uses structured ObservationResult.success instead
  // of string-prefix matching.
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

const SIMPLIFIED_RULES =
  `RULES:\n1. ONE action per turn — wait for the real result.\n2. Use EXACT parameter names from tools above.\n3. When done: FINAL ANSWER: <answer>\n4. Do NOT repeat completed actions.`;

const STANDARD_RULES =
  `RULES:\n1. ONE action per turn. Wait for the real result before proceeding.\n2. Use EXACT parameter names from tool schemas above — do NOT guess parameter names.\n3. When you have ALL required information, immediately write: FINAL ANSWER: <your answer>\n4. Check 'ALREADY DONE' above before planning. If step 1 is already done, start your plan at the FIRST step that is NOT listed there.\n5. For file paths not specified in the task, choose a reasonable path (e.g., ./output.md).\n6. Do NOT fabricate results — wait for the real tool response.\n7. Trust your tool results. Once a file-write succeeds or a file-read returns content, the action is done — do NOT repeat it.`;

const DETAILED_RULES =
  `RULES:\n1. ONE action per turn. Wait for the real result before proceeding.\n2. Use EXACT parameter names from tool schemas above — do NOT guess parameter names.\n3. When you have ALL required information, immediately write: FINAL ANSWER: <your answer>\n4. Check 'ALREADY DONE' above before planning. If step 1 is already done, start your plan at the FIRST step that is NOT listed there.\n5. For file paths not specified in the task, choose a reasonable path (e.g., ./output.md).\n6. Do NOT fabricate results — wait for the real tool response.\n7. Trust your tool results. Once a file-write succeeds or a file-read returns content, the action is done — do NOT repeat it.\n8. If a tool returns an error, read the expected schema and retry with correct parameters.\n9. For multi-step tasks, plan all steps first, then execute one at a time.`;

function getRulesForComplexity(complexity: "simplified" | "standard" | "detailed"): string {
  if (complexity === "simplified") return SIMPLIFIED_RULES;
  if (complexity === "detailed") return DETAILED_RULES;
  return STANDARD_RULES;
}

function buildThoughtPrompt(
  context: string,
  history: readonly ReasoningStep[],
  profile?: ContextProfile,
): string {
  const completed = buildCompletedSummary(history);
  const rules = getRulesForComplexity(profile?.rulesComplexity ?? "standard");
  return `${context}${completed}\n\n${rules}\n\nThink step-by-step, then either take ONE action or give your FINAL ANSWER:`;
}

/**
 * Build a structured ObservationResult from a tool execution.
 * This is the primary path — replaces string-prefix checking.
 */
function makeObservationResult(
  toolName: string,
  success: boolean,
  displayText: string,
): ObservationResult {
  const category = categorizeToolName(toolName);
  const resultKind = deriveResultKind(category, success);
  // Preserve errors and first writes on compaction
  const preserveOnCompaction = !success || category === "error";
  return { success, toolName, displayText, category, resultKind, preserveOnCompaction };
}

/** Simple head+tail truncation — used only when agent explicitly reads the full stored result. */
export function truncateForDisplay(result: string, maxChars: number): string {
  if (result.length <= maxChars) return result;
  const half = Math.floor(maxChars / 2);
  const omitted = result.length - maxChars;
  return `${result.slice(0, half)}\n[...${omitted} chars omitted...]\n${result.slice(-half)}`;
}

/**
 * Sprint 3C: Tool-aware observation normalization.
 * Replaces verbose JSON with semantically equivalent but compact representations
 * before the observation enters the context window.
 */
function normalizeObservation(toolName: string, result: string): string {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;

    // file-write success: {"written":true,"path":"..."} → "✓ Written to ./path"
    if (toolName === "file-write" && parsed.written === true) {
      const rawPath = String(parsed.path ?? "file");
      // Show relative path when possible for brevity
      const path = rawPath.includes("/") ? `./${rawPath.split("/").pop()}` : rawPath;
      return `✓ Written to ${path}`;
    }

    // code-execute stub: {"executed":false,"message":"..."} → compact notice
    if (toolName === "code-execute" && parsed.executed === false) {
      return "[Code execution unavailable — compute from first principles]";
    }

    // web-search: format results as numbered title+url list
    if (toolName === "web-search" && Array.isArray(parsed.results)) {
      const lines = (parsed.results as Array<{ title?: string; url?: string }>)
        .slice(0, 5)
        .map((r, i) => `${i + 1}. ${r.title ?? "result"}: ${r.url ?? ""}`)
        .join("\n");
      return lines || result;
    }

    // http-get: if there's a plain "content" or "body" field, use that directly
    if ((toolName === "http-get") && typeof parsed.content === "string") {
      return parsed.content;
    }

    // agent-delegate: structured sub-agent summary
    if (typeof parsed.subAgentName === "string" && typeof parsed.summary === "string") {
      const prefix = parsed.success ? "✓" : "✗";
      const tokStr = typeof parsed.tokensUsed === "number" && parsed.tokensUsed > 0
        ? ` | ${parsed.tokensUsed} tok`
        : "";
      return `${prefix} [Sub-agent "${parsed.subAgentName}"${tokStr}]: ${String(parsed.summary).slice(0, 500)}`;
    }
  } catch {
    // Not JSON — return as-is
  }
  return result;
}

function buildResult(
  steps: readonly ReasoningStep[],
  output: unknown,
  status: "completed" | "partial",
  startMs: number,
  tokensUsed: number,
  cost: number,
): ReasoningResult {
  return {
    strategy: "reactive",
    steps: [...steps],
    output,
    metadata: {
      duration: Date.now() - startMs,
      cost,
      tokensUsed,
      stepsCount: steps.length,
      confidence: status === "completed" ? 0.8 : 0.4,
    },
    status,
  };
}
