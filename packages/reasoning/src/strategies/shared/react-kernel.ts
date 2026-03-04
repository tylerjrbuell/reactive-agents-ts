/**
 * ReAct Kernel — the shared execution primitive for all reasoning strategies.
 *
 * Implements: Think -> Parse Action -> Execute Tool -> Observe -> Repeat
 *
 * This kernel is what makes every strategy "tool-aware". Strategies define
 * their outer control loop (how many kernel calls, when to retry, how to
 * assess quality). The kernel handles all tool interaction.
 *
 * Exports:
 *   - `reactKernel: ThoughtKernel` — single-step transition function
 *   - `executeReActKernel(input)` — backwards-compatible wrapper using `runKernel(reactKernel, ...)`
 *   - `ReActKernelInput` / `ReActKernelResult` — preserved types for all consumers
 */
import { Effect } from "effect";
import type { ReasoningStep } from "../../types/index.js";
import { ExecutionError } from "../../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ContextProfile } from "../../context/context-profile.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ToolSchema } from "./tool-utils.js";
import {
  parseAllToolRequests,
  hasFinalAnswer,
  extractFinalAnswer,
  parseBareToolCall,
  formatToolSchemas,
  formatToolSchemaCompact,
  filterToolsByRelevance,
} from "./tool-utils.js";
import { buildCompactedContext } from "./context-utils.js";
import { extractThinking } from "./thinking-utils.js";
import { makeStep } from "./step-utils.js";
import { executeToolCall, makeObservationResult } from "./tool-execution.js";
import { runKernel } from "./kernel-runner.js";
import {
  transitionState,
  type KernelState,
  type KernelContext,
  type ThoughtKernel,
} from "./kernel-state.js";

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
  contextProfile?: Partial<ContextProfile>;
  /** Tool result compression configuration */
  resultCompression?: ResultCompressionConfig;
  /** LLM sampling temperature */
  temperature?: number;
  /** Task ID for EventBus correlation */
  taskId?: string;
  /** Name of the calling strategy (for event tagging) */
  parentStrategy?: string;
  /** Descriptive label for this kernel invocation (e.g. "reflexion:generate", "plan-execute:step-3") */
  kernelPass?: string;
  /** Agent ID for tool execution attribution. Falls back to "reasoning-agent". */
  agentId?: string;
  /** Session ID for tool execution attribution. Falls back to "reasoning-session". */
  sessionId?: string;
  /**
   * Tools that MUST NOT be executed — hard code-level guard.
   * When the model requests a blocked tool, a synthetic observation is returned
   * instead of executing. Used by reflexion to prevent re-executing side-effect
   * tools (send, write, create, etc.) that already succeeded in a prior pass.
   */
  blockedTools?: readonly string[];
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

// ── Initial context builder ──────────────────────────────────────────────────

/**
 * Build the initial context string from tool schemas + prior context + task.
 * Tools FIRST, task LAST for recency bias.
 */
function buildInitialContext(
  task: string,
  availableToolSchemas?: readonly ToolSchema[],
  priorContext?: string,
): string {
  let toolSection: string;
  if (availableToolSchemas && availableToolSchemas.length > 0) {
    const { primary, secondary } = filterToolsByRelevance(task, availableToolSchemas);

    const primaryLines = primary.length > 0
      ? formatToolSchemas(primary)
      : "";
    const secondaryLines = secondary.length > 0
      ? (primary.length > 0 ? "\nOther tools:\n" : "") + secondary.map(formatToolSchemaCompact).join("\n")
      : "";

    toolSection = `Available Tools:\n${primaryLines}${secondaryLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.`;
  } else {
    toolSection = "No tools available for this task.";
  }

  const priorSection = priorContext ? `\n${priorContext}\n` : "";

  // Structure: Tools -> Prior context -> Task (task last = recency bias)
  return `${toolSection}${priorSection}\n\nTask: ${task}`;
}

/**
 * Build the system prompt text.
 */
function buildSystemPrompt(task: string, systemPrompt?: string): string {
  return systemPrompt
    ? `${systemPrompt}\n\nTask: ${task}`
    : `You are a reasoning agent. Task: ${task}`;
}

// ── reactKernel: ThoughtKernel ───────────────────────────────────────────────

/**
 * The ReAct ThoughtKernel — a single-step transition function.
 *
 * Given a KernelState, performs ONE reasoning step and returns the next state.
 * Reads `state.status` to decide what to do:
 *
 * - "thinking": Build context, call LLM, parse response, transition to "acting" or "done"
 * - "acting": Execute tool from meta.pendingToolRequest, observe, transition to "thinking" or "done"
 */
export const reactKernel: ThoughtKernel = (
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> => {
  if (state.status === "thinking") {
    return handleThinking(state, context);
  }
  if (state.status === "acting") {
    return handleActing(state, context);
  }
  // For any other status, return state as-is (done/failed/observing are terminal or handled)
  return Effect.succeed(state);
};

// ── Thinking phase ───────────────────────────────────────────────────────────

function handleThinking(
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;
    const { input, profile, hooks } = context;
    const strategy = state.strategy;
    const temp = input.temperature ?? profile.temperature ?? 0.7;

    // Build initial context (on first iteration or re-derive each time for compaction)
    const initialContext = buildInitialContext(
      input.task,
      input.availableToolSchemas,
      input.priorContext,
    );

    const systemPromptText = buildSystemPrompt(input.task, input.systemPrompt);

    // Build compacted context from initial context + accumulated steps
    const compactedContext = buildCompactedContext(initialContext, state.steps, profile);

    // Add completed-actions summary (skip already-done steps)
    const completedSummary = buildCompletedSummary(state.steps);

    const thoughtPrompt = `${compactedContext}${completedSummary}

RULES:
1. You MUST take action NOW. Do NOT ask for clarification — all information is in the Task above.
2. ONE action per turn. Wait for the real result before proceeding.
3. Use EXACT parameter names from tool schemas above — do NOT guess parameter names.
4. When you have ALL required information, immediately write: FINAL ANSWER: <your answer>
5. Check 'ALREADY DONE' above before acting. Skip completed steps.
6. Do NOT fabricate results — wait for the real tool response.
7. Trust your tool results. Once a tool succeeds, the action is done — do NOT repeat it.

You MUST respond with an ACTION or FINAL ANSWER. Do NOT ask questions. Start NOW:`;

    // Publish prompt trace event via hooks
    yield* hooks.onThought(state, `[prompt-trace] ${thoughtPrompt.slice(0, 200)}`);

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
              message: `LLM thought failed at iteration ${state.iteration}: ${
                err && typeof err === "object" && "message" in err
                  ? (err as { message: string }).message
                  : String(err)
              }`,
              step: state.iteration,
              cause: err,
            }),
        ),
        // Convert ExecutionError to a never error channel by catching and dying
        // (or we can handle gracefully). For the kernel contract we need never error.
        Effect.catchAll((execErr) =>
          Effect.succeed({
            content: `[LLM Error: ${execErr.message}]`,
            stopReason: "error" as const,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
            model: "unknown",
          }),
        ),
      );

    const rawThought = thoughtResponse.content;
    const newTokens = state.tokens + thoughtResponse.usage.totalTokens;
    const newCost = state.cost + thoughtResponse.usage.estimatedCost;

    // Strip <think>...</think> blocks before parsing
    const { thinking: extractedThinking, content: cleanContent } = extractThinking(rawThought);
    const providerThinking = (thoughtResponse as any).thinking as string | undefined;
    const thinking = extractedThinking || providerThinking || null;
    const thought = cleanContent || providerThinking || rawThought;

    const thoughtStep = makeStep("thought", thought, thinking ? { thinking } : undefined);
    const newSteps = [...state.steps, thoughtStep];

    // Publish thought event
    yield* hooks.onThought(state, thought);

    // ── ACTION SELECTION ────────────────────────────────────────────────────
    let allToolRequests = parseAllToolRequests(thought);
    if (allToolRequests.length === 0 && thinking) {
      allToolRequests = parseAllToolRequests(thinking);
    }
    let toolRequest: { tool: string; input: string; transform?: string } | null =
      allToolRequests.find((req) => {
        const actionJson = JSON.stringify(req);
        return !newSteps.some((step, idx) => {
          if (step.type !== "action") return false;
          if (step.content !== actionJson) return false;
          const nextStep = newSteps[idx + 1];
          return (
            nextStep?.type === "observation" &&
            nextStep.metadata?.observationResult?.success === true
          );
        });
      }) ??
      allToolRequests[0] ??
      null;

    // ── FINAL ANSWER CHECK (no pending action) ──────────────────────────────
    const hasFA = hasFinalAnswer(thought) || (!!thinking && hasFinalAnswer(thinking));
    if (!toolRequest && hasFA) {
      const finalAnswer = hasFinalAnswer(thought)
        ? extractFinalAnswer(thought)
        : extractFinalAnswer(thinking!);

      // Guard: if the "final answer" looks like a bare tool call, treat as ACTION
      const embeddedToolCall = parseBareToolCall(finalAnswer);
      if (embeddedToolCall) {
        toolRequest = embeddedToolCall;
      } else {
        return transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          cost: newCost,
          status: "done",
          output: finalAnswer,
          iteration: state.iteration + 1,
        });
      }
    }

    // ── EARLY END_TURN TERMINATION ──────────────────────────────────────────
    if (
      !toolRequest &&
      state.iteration >= 1 &&
      thought.trim().length >= 50 &&
      (thoughtResponse as { stopReason?: string }).stopReason === "end_turn"
    ) {
      return transitionState(state, {
        steps: newSteps,
        tokens: newTokens,
        cost: newCost,
        status: "done",
        output: thought.trim(),
        iteration: state.iteration + 1,
        meta: { ...state.meta, terminatedBy: "end_turn" },
      });
    }

    // ── TOOL REQUEST FOUND → transition to "acting" ─────────────────────────
    if (toolRequest) {
      return transitionState(state, {
        steps: newSteps,
        tokens: newTokens,
        cost: newCost,
        status: "acting",
        meta: {
          ...state.meta,
          pendingToolRequest: toolRequest,
          // Store thought + thinking for post-action FA check
          lastThought: thought,
          lastThinking: thinking,
        },
      });
    }

    // No tool, no FA, no end_turn — just a thought; increment iteration and loop
    return transitionState(state, {
      steps: newSteps,
      tokens: newTokens,
      cost: newCost,
      iteration: state.iteration + 1,
    });
  });
}

// ── Acting phase ─────────────────────────────────────────────────────────────

function handleActing(
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    const { input, profile, compression, toolService, hooks } = context;
    const toolRequest = state.meta.pendingToolRequest as { tool: string; input: string; transform?: string } | undefined;

    if (!toolRequest) {
      // No pending tool request — shouldn't happen, transition back to thinking
      return transitionState(state, {
        status: "thinking",
        iteration: state.iteration + 1,
      });
    }

    const currentActionJson = JSON.stringify(toolRequest);

    // Duplicate detection — has this exact action already succeeded?
    const isDuplicate = state.steps.some((step, idx) => {
      if (step.type !== "action") return false;
      if (step.content !== currentActionJson) return false;
      const nextStep = state.steps[idx + 1];
      return (
        nextStep?.type === "observation" &&
        nextStep.metadata?.observationResult?.success === true
      );
    });

    const actionStep = makeStep("action", currentActionJson, { toolUsed: toolRequest.tool });
    const stepsWithAction = [...state.steps, actionStep];

    const newToolsUsed = new Set(state.toolsUsed);
    newToolsUsed.add(toolRequest.tool);

    // Publish action event
    yield* hooks.onAction(state, toolRequest.tool, toolRequest.input);

    let observationContent: string;
    let obsResult: import("../../types/observation.js").ObservationResult;

    // Hard side-effect guard — refuse to execute blocked tools from prior passes
    const isBlocked = input.blockedTools?.includes(toolRequest.tool) ?? false;

    if (isBlocked) {
      observationContent = `\u26A0\uFE0F BLOCKED: ${toolRequest.tool} already executed successfully in a prior pass. This tool has side effects and MUST NOT be called again. Move on to the next step or give FINAL ANSWER.`;
      obsResult = makeObservationResult(toolRequest.tool, true, observationContent);
    } else if (isDuplicate) {
      // Surface prior result with advisory — don't re-execute
      const priorSuccessObs = state.steps.find((step, idx) => {
        if (step.type !== "action" || step.content !== currentActionJson) return false;
        const next = state.steps[idx + 1];
        return (
          next?.type === "observation" &&
          next.metadata?.observationResult?.success === true
        );
      });
      const priorObsStep = priorSuccessObs
        ? state.steps[state.steps.indexOf(priorSuccessObs) + 1]
        : undefined;
      const priorObsContent = priorObsStep?.content ?? "";
      observationContent = `${priorObsContent} [Already done — do NOT repeat. Continue with next task step or give FINAL ANSWER if all steps are complete.]`;
      obsResult = priorObsStep?.metadata?.observationResult ??
        makeObservationResult(toolRequest.tool, true, observationContent);
    } else {
      const toolStartMs = Date.now();
      const toolObs = yield* executeToolCall(toolService, toolRequest, {
        profile,
        compression,
        scratchpad: state.scratchpad as Map<string, string>,
        agentId: input.agentId,
        sessionId: input.sessionId,
      });
      const toolDurationMs = Date.now() - toolStartMs;
      observationContent = toolObs.content;
      obsResult = toolObs.observationResult;

      // Store actual duration in action step metadata
      const lastActionStep = stepsWithAction[stepsWithAction.length - 1];
      if (lastActionStep?.type === "action") {
        stepsWithAction[stepsWithAction.length - 1] = {
          ...lastActionStep,
          metadata: { ...(lastActionStep.metadata ?? {}), duration: toolDurationMs },
        };
      }
    }

    const observationStep = makeStep("observation", observationContent, { observationResult: obsResult });
    const stepsWithObs = [...stepsWithAction, observationStep];

    // Publish observation event
    yield* hooks.onObservation(
      transitionState(state, { steps: stepsWithAction }),
      observationContent,
    );

    // Check for post-action FINAL ANSWER (from the thought that triggered this action)
    const thought = state.meta.lastThought as string | undefined;
    const thinking = state.meta.lastThinking as string | null | undefined;
    const postActionHasFA = (thought && hasFinalAnswer(thought)) ||
      (!!thinking && hasFinalAnswer(thinking!));

    if (postActionHasFA) {
      const finalAnswer = (thought && hasFinalAnswer(thought))
        ? extractFinalAnswer(thought)
        : extractFinalAnswer(thinking!);

      return transitionState(state, {
        steps: stepsWithObs,
        toolsUsed: newToolsUsed,
        status: "done",
        output: finalAnswer,
        iteration: state.iteration + 1,
        meta: {
          ...state.meta,
          pendingToolRequest: undefined,
          lastThought: undefined,
          lastThinking: undefined,
        },
      });
    }

    // No FA — continue to next thinking iteration
    return transitionState(state, {
      steps: stepsWithObs,
      toolsUsed: newToolsUsed,
      status: "thinking",
      iteration: state.iteration + 1,
      meta: {
        ...state.meta,
        pendingToolRequest: undefined,
        lastThought: undefined,
        lastThinking: undefined,
      },
    });
  });
}

// ── Backwards-compatible wrapper ─────────────────────────────────────────────

/**
 * Execute the ReAct Think->Act->Observe loop.
 *
 * Works with or without ToolService in context.
 * When ToolService is absent every iteration is pure thought (tool calls
 * produce a "not available" observation rather than real results).
 *
 * This is a backwards-compatible wrapper around `runKernel(reactKernel, ...)`.
 */
export const executeReActKernel = (
  input: ReActKernelInput,
): Effect.Effect<ReActKernelResult, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    const state = yield* runKernel(reactKernel, {
      task: input.task,
      systemPrompt: input.systemPrompt,
      availableToolSchemas: input.availableToolSchemas,
      priorContext: input.priorContext,
      contextProfile: input.contextProfile,
      resultCompression: input.resultCompression,
      temperature: input.temperature,
      agentId: input.agentId,
      sessionId: input.sessionId,
      blockedTools: input.blockedTools,
    }, {
      maxIterations: input.maxIterations ?? 10,
      strategy: input.parentStrategy ?? "react-kernel",
      kernelType: "react",
      taskId: input.taskId,
      kernelPass: input.kernelPass,
    });

    // Determine terminatedBy from state
    const terminatedBy: "final_answer" | "max_iterations" | "end_turn" =
      state.meta.terminatedBy === "end_turn"
        ? "end_turn"
        : state.status === "done"
          ? "final_answer"
          : "max_iterations";

    // When max iterations reached (no explicit output), fall back to last thought content
    // to match the original executeReActKernel behavior.
    const output = state.output
      ?? [...state.steps].filter((s) => s.type === "thought").pop()?.content
      ?? "";

    return {
      output,
      steps: [...state.steps] as ReasoningStep[],
      totalTokens: state.tokens,
      totalCost: state.cost,
      toolsUsed: [...state.toolsUsed],
      iterations: state.iteration,
      terminatedBy,
    };
  });

// ── Private helpers ───────────────────────────────────────────────────────────

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
        successes.push(c.length > 80 ? c.slice(0, 80) + "\u2026" : c);
      }
    }
  }
  if (successes.length === 0) return "";
  return (
    `\n\nALREADY DONE — skip these, choose only from the REMAINING steps:\n${successes.map((s) => `- ${s}`).join("\n")}` +
    `\n\u2190 Your NEXT action must be a step that is NOT listed above. \u2192`
  );
}
