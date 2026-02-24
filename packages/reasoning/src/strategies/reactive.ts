// File: src/strategies/reactive.ts
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import type { StepId } from "../types/step.js";
import type { ObservationResult } from "../types/observation.js";
import { categorizeToolName, deriveResultKind } from "../types/observation.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import type { ToolDefinition, ToolOutput } from "@reactive-agents/tools";
import { PromptService } from "@reactive-agents/prompts";
import { EventBus } from "@reactive-agents/core";
import type { ContextProfile } from "../context/context-profile.js";
import { CONTEXT_PROFILES } from "../context/context-profile.js";
import { resolveProfile } from "../context/profile-resolver.js";

interface ToolParamSchema {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly required: boolean;
}

interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly ToolParamSchema[];
}

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
    const llm = yield* LLMService;
    // ToolService is optional — reasoning works with or without tools
    const toolServiceOptRaw = yield* Effect.serviceOption(ToolService);
    const toolServiceOpt = toolServiceOptRaw as
      | { _tag: "Some"; value: ToolServiceInstance }
      | { _tag: "None" };
    // PromptService is optional — falls back to hardcoded strings
    const promptServiceOptRaw = yield* Effect.serviceOption(PromptService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const promptServiceOpt = promptServiceOptRaw as PromptServiceOpt;
    // EventBus is optional — publish reasoning steps when available
    const ebOptRaw = yield* Effect.serviceOption(EventBus).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const ebOpt = ebOptRaw as typeof ebOptRaw;
    // Resolve context profile — use provided profile, or default to "mid"
    const profile: ContextProfile = input.contextProfile ?? CONTEXT_PROFILES["mid"];

    const maxIter = input.config.strategies.reactive.maxIterations;
    const temp = input.config.strategies.reactive.temperature;
    const steps: ReasoningStep[] = [];
    const start = Date.now();

    const fullInitialContext = buildInitialContext(input, false);
    const compactInitialContext = buildInitialContext(input, true);
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
      const systemPrompt = yield* compilePromptOrFallback(
        promptServiceOpt,
        "reasoning.react-system",
        { task: input.taskDescription },
        `You are a reasoning agent. Task: ${input.taskDescription}`,
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

      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: thought,
        timestamp: new Date(),
      });

      // Publish ReasoningStepCompleted for thought
      if (ebOpt._tag === "Some") {
        yield* ebOpt.value.publish({
          _tag: "ReasoningStepCompleted",
          taskId: "reactive",
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
        return buildResult(
          steps,
          extractFinalAnswer(thought),
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
        (thoughtResponse as any).stopReason === "end_turn"
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

        steps.push({
          id: ulid() as StepId,
          type: "action",
          content: currentActionJson,
          timestamp: new Date(),
          metadata: { toolUsed: toolRequest.tool },
        });

        // Publish ReasoningStepCompleted for action
        if (ebOpt._tag === "Some") {
          yield* ebOpt.value.publish({
            _tag: "ReasoningStepCompleted",
            taskId: "reactive",
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
          const toolObs = yield* runToolObservation(toolServiceOpt, toolRequest, input, profile);
          observationContent = toolObs.content;
          obsResult = toolObs.observationResult;
        }

        steps.push({
          id: ulid() as StepId,
          type: "observation",
          content: observationContent,
          timestamp: new Date(),
          metadata: { observationResult: obsResult },
        });

        // Publish ReasoningStepCompleted for observation
        if (ebOpt._tag === "Some") {
          yield* ebOpt.value.publish({
            _tag: "ReasoningStepCompleted",
            taskId: "reactive",
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
          return buildResult(steps, extractFinalAnswer(thought), "completed", start, totalTokens, totalCost);
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
  toolRequest: { tool: string; input: string },
  _input: ReactiveInput,
  profile?: ContextProfile,
): Effect.Effect<ToolObservationOutput, never> {
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
          const maxChars = profile?.toolResultMaxChars ?? 800;
          const content = truncateToolResult(normalized, maxChars);
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

function resolveToolArgs(
  toolService: ToolServiceInstance,
  toolRequest: { tool: string; input: string },
): Effect.Effect<Record<string, unknown>, never> {
  const trimmed = toolRequest.input.trim();

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

// ─── Prompt compilation helper ───

type PromptServiceOpt =
  | { _tag: "Some"; value: { compile: (id: string, vars: Record<string, unknown>, options?: { tier?: string }) => Effect.Effect<{ content: string }, unknown> } }
  | { _tag: "None" };

function compilePromptOrFallback(
  promptServiceOpt: PromptServiceOpt,
  templateId: string,
  variables: Record<string, unknown>,
  fallback: string,
  tier?: string,
): Effect.Effect<string, never> {
  if (promptServiceOpt._tag === "None") {
    return Effect.succeed(fallback);
  }
  return promptServiceOpt.value
    .compile(templateId, variables, tier ? { tier } : undefined)
    .pipe(
      Effect.map((compiled) => compiled.content),
      Effect.catchAll(() => Effect.succeed(fallback)),
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

function buildInitialContext(input: ReactiveInput, compact = false): string {
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
    const toolLines = input.availableToolSchemas.map(formatToolSchema).join("\n");
    sections.push(`Available Tools:\n${toolLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.`);
  } else if (input.availableTools.length > 0) {
    sections.push(`Available Tools: ${input.availableTools.join(", ")}\nTo use a tool: ACTION: tool_name({"param": "value"}) — use JSON for tool arguments.`);
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

function hasFinalAnswer(thought: string): boolean {
  return /final answer:/i.test(thought);
}

function extractFinalAnswer(thought: string): string {
  const match = thought.match(/final answer:\s*([\s\S]*)/i);
  return match ? match[1]!.trim() : thought;
}

function parseToolRequest(
  thought: string,
): { tool: string; input: string } | null {
  // Match the ACTION prefix and tool name
  const prefixMatch = thought.match(/ACTION:\s*([\w-]+)\(/i);
  if (!prefixMatch) return null;

  const tool = prefixMatch[1];
  const argsStart = (prefixMatch.index ?? 0) + prefixMatch[0].length;
  const rest = thought.slice(argsStart);

  // If args start with '{', use brace-matching to extract the JSON object
  if (rest.trimStart().startsWith("{")) {
    const trimOffset = rest.length - rest.trimStart().length;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = trimOffset; i < rest.length; i++) {
      const ch = rest[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          return { tool, input: rest.slice(trimOffset, i + 1) };
        }
      }
    }
  }

  // Fallback: greedy regex (captures up to last ')' in thought)
  const match = thought.match(/ACTION:\s*[\w-]+\((.+)\)/is);
  return match ? { tool, input: match[1] } : null;
}

/** Return ALL ACTION requests found in a thought, in order of appearance.
 * Used to skip duplicate actions and advance to the next uncompleted step
 * when the model writes a multi-step plan in a single thought. */
function parseAllToolRequests(
  thought: string,
): Array<{ tool: string; input: string }> {
  const results: Array<{ tool: string; input: string }> = [];
  const re = /ACTION:/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(thought)) !== null) {
    const slice = thought.slice(match.index);
    const req = parseToolRequest(slice);
    if (req) results.push(req);
  }
  return results;
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

/** Truncate large tool results to prevent context bloat.
 * Keeps first 400 + last 400 chars with an omission marker in between. */
function truncateToolResult(result: string, maxChars = 800): string {
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
      return `${prefix} [Sub-agent "${parsed.subAgentName}"]: ${String(parsed.summary).slice(0, 500)}`;
    }
  } catch {
    // Not JSON — return as-is
  }
  return result;
}

/**
 * Build a compacted context from reasoning steps.
 * After compactAfterSteps steps, older steps are summarized to one-line
 * entries to prevent linear context growth (~17K tokens for 18 steps).
 * Only the most recent fullDetailSteps steps are kept in full detail.
 * Thresholds are driven by the ContextProfile (defaults: 6 / 4 for backward compat).
 */

/** Format a reasoning step in ReAct style (preserves Observation: prefix for LLM continuity) */
function formatStepForContext(step: ReasoningStep): string {
  if (step.type === "observation") return `Observation: ${step.content}`;
  if (step.type === "action") {
    const parsed = (() => { try { return JSON.parse(step.content); } catch { return null; } })();
    return `Action: ${parsed?.tool ?? step.content}`;
  }
  return step.content; // thought — render as-is
}

function buildCompactedContext(
  initialContext: string,
  steps: readonly ReasoningStep[],
  profile?: ContextProfile,
): string {
  const compactAfterSteps = profile?.compactAfterSteps ?? 6;
  const fullDetailSteps = profile?.fullDetailSteps ?? 4;

  if (steps.length === 0) return initialContext;

  if (steps.length <= compactAfterSteps) {
    // Not enough steps to compact — rebuild context from all steps in ReAct format
    const stepLines = steps.map(formatStepForContext).join("\n");
    return `${initialContext}\n\n${stepLines}`;
  }

  // Split into old steps (summarized) and recent steps (full detail)
  const cutoff = steps.length - fullDetailSteps;
  const oldSteps = steps.slice(0, cutoff);
  const recentSteps = steps.slice(cutoff);

  // Summarize old steps: one line per step
  const summaryLines = oldSteps.map((s) => {
    const formatted = formatStepForContext(s);
    const preview = formatted.length > 120 ? formatted.slice(0, 120) + "..." : formatted;
    return preview;
  });
  const summary = `[Earlier steps summary — ${oldSteps.length} steps]:\n${summaryLines.join("\n")}`;

  // Keep recent steps in full detail in ReAct format
  const recentLines = recentSteps.map(formatStepForContext).join("\n");

  return `${initialContext}\n\n${summary}\n\n[Recent steps]:\n${recentLines}`;
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
