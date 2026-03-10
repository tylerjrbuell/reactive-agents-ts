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
import { Effect, Stream, FiberRef } from "effect";
import type { ReasoningStep } from "../../types/index.js";
import { ExecutionError } from "../../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";
import { StreamingTextCallback } from "@reactive-agents/core";
import type { ContextProfile } from "../../context/context-profile.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import {
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  type FinalAnswerCapture,
} from "@reactive-agents/tools";
import type { ToolSchema } from "./tool-utils.js";
import {
  parseAllToolRequests,
  parseToolRequestGroup,
  hasFinalAnswer,
  extractFinalAnswer,
  parseBareToolCall,
} from "./tool-utils.js";
import { buildContext } from "../../context/context-engine.js";
import type { MemoryItem } from "../../context/context-engine.js";
import { extractThinking } from "./thinking-utils.js";
import { makeStep } from "./step-utils.js";
import { executeToolCall, executeToolGroup, makeObservationResult } from "./tool-execution.js";
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
  /**
   * Tools that MUST be called before the agent can declare success.
   * If the agent attempts to end without using all required tools,
   * it will be redirected up to `maxRequiredToolRetries` times before failing.
   */
  requiredTools?: readonly string[];
  /** Max redirects when required tools are missing (default: 2) */
  maxRequiredToolRetries?: number;
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
  terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn";
  /** Captured final-answer tool payload — present when terminatedBy === "final_answer_tool" */
  finalAnswerCapture?: FinalAnswerCapture;
}

/**
 * Build the system prompt text.
 * Tier-adaptive: frontier/large models get detailed reasoning guidance;
 * mid models get standard guidance; local models get minimal prompt.
 */
function buildSystemPrompt(
  task: string,
  systemPrompt?: string,
  tier?: "local" | "mid" | "large" | "frontier",
): string {
  if (systemPrompt) {
    return `${systemPrompt}\n\nTask: ${task}`;
  }
  const t = tier ?? "mid";
  if (t === "local") {
    return `You are a helpful assistant that uses tools when needed.\n\nTask: ${task}`;
  }
  if (t === "frontier" || t === "large") {
    return `You are an expert reasoning agent. You think step by step, use tools precisely, and produce accurate, well-structured answers.

When solving a task:
- Break complex problems into sub-steps before acting.
- Verify assumptions before drawing conclusions.
- Use the most specific tool available rather than general-purpose ones.
- If a tool result is unexpected, reason about why before retrying.
- Prefer concise, direct answers once you have sufficient evidence.

Task: ${task}`;
  }
  // mid tier
  return `You are a reasoning agent. Think step by step and use available tools when needed.\n\nTask: ${task}`;
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

    const systemPromptText = buildSystemPrompt(input.task, input.systemPrompt, profile.tier);

    const maxIter = (state.meta.maxIterations as number) ?? 10;

    // ── Dynamic meta-tool injection (final-answer) ───────────────────────────
    // When all required tools have been called and the agent is ready to complete,
    // inject the final-answer tool into the available tool schemas so the LLM
    // can discover and use it as the preferred termination mechanism.
    const hasNonMetaToolCalledForThink = [...state.toolsUsed].some(
      (t) => t !== "final-answer" && t !== "task-complete" && t !== "context-status" && t !== "scratchpad-write" && t !== "scratchpad-read",
    );
    const hasErrorsForThink = state.steps.some(
      (s) => s.type === "observation" && s.metadata?.observationResult?.success === false,
    );
    const finalAnswerVisible = shouldShowFinalAnswer({
      requiredToolsCalled: state.toolsUsed,
      requiredTools: [...(input.requiredTools ?? [])],
      iteration: state.iteration,
      hasErrors: hasErrorsForThink,
      hasNonMetaToolCalled: hasNonMetaToolCalledForThink,
    });

    const augmentedToolSchemas: readonly import("./tool-utils.js").ToolSchema[] = finalAnswerVisible
      ? [
          ...(input.availableToolSchemas ?? []),
          {
            name: finalAnswerTool.name,
            description: finalAnswerTool.description,
            parameters: finalAnswerTool.parameters,
          },
        ]
      : (input.availableToolSchemas ?? []);

    const thoughtPrompt = buildContext({
      task: input.task,
      steps: state.steps,
      availableToolSchemas: augmentedToolSchemas,
      requiredTools: input.requiredTools,
      iteration: state.iteration,
      maxIterations: maxIter,
      profile,
      memories: (state.meta.memories as MemoryItem[] | undefined),
      priorContext: input.priorContext,
    }) + "\n\nThink step-by-step, then either take ONE action or give your FINAL ANSWER:";

    // ── STREAM (with text delta emission) ──────────────────────────────────
    // Token budget adapts to model tier: frontier models get more room for
    // sophisticated reasoning; local models are capped to avoid wasted tokens.
    const tierMaxTokens: Record<string, number> = {
      local: 1200,
      mid: 2000,
      large: 3000,
      frontier: 4000,
    };
    const outputMaxTokens = tierMaxTokens[profile.tier] ?? 1500;

    const llmStreamEffect = llm.stream({
      messages: [{ role: "user", content: thoughtPrompt }],
      systemPrompt: systemPromptText,
      maxTokens: outputMaxTokens,
      temperature: temp,
      stopSequences: ["\nObservation:", "\nObservation: "],
    });

    const llmStream = yield* llmStreamEffect.pipe(
      Effect.mapError(
        (err) =>
          new ExecutionError({
            strategy,
            message: `LLM stream failed at iteration ${state.iteration}: ${
              err && typeof err === "object" && "message" in err
                ? (err as { message: string }).message
                : String(err)
            }`,
            step: state.iteration,
            cause: err,
          }),
      ),
      Effect.catchAll((execErr) =>
        Effect.succeed(
          Stream.make({
            type: "content_complete" as const,
            content: `[LLM Error: ${execErr.message}]`,
          }) as Stream.Stream<StreamEvent, never>,
        ),
      ),
    );

    // Accumulate content + emit text deltas via FiberRef callback
    let accumulatedContent = "";
    let accumulatedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };

    const textDeltaCb = yield* FiberRef.get(StreamingTextCallback);

    yield* Stream.runForEach(llmStream, (event) =>
      Effect.gen(function* () {
        if (event.type === "text_delta") {
          accumulatedContent += event.text;
          if (textDeltaCb) {
            yield* textDeltaCb(event.text).pipe(Effect.catchAll(() => Effect.void));
          }
        } else if (event.type === "content_complete") {
          accumulatedContent = event.content;
        } else if (event.type === "usage") {
          accumulatedUsage = event.usage;
        }
      }),
    ).pipe(Effect.catchAll(() => Effect.void));

    // Build response shape matching original llm.complete() return
    const thoughtResponse = {
      content: accumulatedContent,
      stopReason: "end_turn" as const,
      usage: accumulatedUsage,
      model: "unknown",
    };

    const rawThought = thoughtResponse.content;
    const newTokens = state.tokens + thoughtResponse.usage.totalTokens;
    const newCost = state.cost + thoughtResponse.usage.estimatedCost;

    // Strip <think>...</think> blocks before parsing
    const { thinking: extractedThinking, content: cleanContent } = extractThinking(rawThought);
    const providerThinking = (thoughtResponse as any).thinking as string | undefined;
    const thinking = extractedThinking || providerThinking || null;
    let thought = cleanContent || providerThinking || rawThought;

    const thoughtStep = makeStep("thought", thought, thinking ? { thinking } : undefined);
    const newSteps = [...state.steps, thoughtStep];

    // Strip fabricated action/observation pairs — small models often "simulate"
    // multiple tool calls in one thought. Only the FIRST ACTION is real; everything
    // after a fabricated "Observation:" is hallucinated and must be stripped.
    const firstActionIdx = thought.search(/ACTION:/i);
    if (firstActionIdx >= 0) {
      // Find the first "Observation:" AFTER the first ACTION
      const afterAction = thought.slice(firstActionIdx);
      const fabObsMatch = afterAction.match(/\nObservation[:\s]/i);
      if (fabObsMatch && fabObsMatch.index !== undefined) {
        thought = thought.slice(0, firstActionIdx + fabObsMatch.index).trimEnd();
      }
    }

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
      // Parse multi-tool group for parallel / chain dispatch
      const toolRequestGroup = parseToolRequestGroup(thought);
      const hasGroup = toolRequestGroup.mode !== "single" && toolRequestGroup.requests.length > 1;

      return transitionState(state, {
        steps: newSteps,
        tokens: newTokens,
        cost: newCost,
        status: "acting",
        meta: {
          ...state.meta,
          pendingToolRequest: toolRequest,
          pendingToolGroup: hasGroup ? toolRequestGroup : undefined,
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

    // Side-effect guard — tools that mutate external state must not run twice
    // even with different parameters (e.g. sending same message with slight rewording)
    const SIDE_EFFECT_PREFIXES = ["send", "create", "delete", "push", "merge", "fork", "update", "assign", "remove"];
    const isSideEffectTool = SIDE_EFFECT_PREFIXES.some(
      (p) => toolRequest.tool.toLowerCase().includes(p),
    );
    const sideEffectAlreadyDone = isSideEffectTool && state.steps.some((step, idx) => {
      if (step.type !== "action") return false;
      try {
        const prev = JSON.parse(step.content);
        if (prev.tool !== toolRequest.tool) return false;
      } catch { return false; }
      const nextStep = state.steps[idx + 1];
      return nextStep?.type === "observation" && nextStep.metadata?.observationResult?.success === true;
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

    // ── FINAL-ANSWER HARD GATE ───────────────────────────────────────────────
    // When the model calls the `final-answer` meta-tool, run the handler directly
    // (bypassing ToolService) and, if accepted:true, hard-exit the kernel loop.
    if (toolRequest.tool === "final-answer" && !isBlocked) {
      const META_TOOLS = new Set(["final-answer", "task-complete", "context-status", "scratchpad-write", "scratchpad-read"]);
      const hasNonMetaToolCalled = [...state.toolsUsed].some((t) => !META_TOOLS.has(t));
      const requiredTools = input.requiredTools ?? [];
      // For the hard-gate we relax the visibility guard:
      // - All required tools must be called (if any)
      // - At least one non-meta tool must have been used (or no required tools)
      // - We skip hasErrors (model chose to finalize; trust its judgment)
      // - We skip iteration≥2 (already in acting phase after ≥1 think→act cycle)
      const allRequiredMet = requiredTools.every((t) => state.toolsUsed.has(t));
      const canComplete = allRequiredMet && (hasNonMetaToolCalled || requiredTools.length === 0);

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(toolRequest.input) as Record<string, unknown>;
      } catch {
        // fall through with empty args — handler will return accepted:false
      }

      const handlerResult = yield* makeFinalAnswerHandler({ canComplete })({ ...parsedArgs });
      const resultObj = handlerResult as Record<string, unknown>;

      if (resultObj.accepted === true) {
        const capture = resultObj._capture as FinalAnswerCapture;
        // Note: hooks.onAction already fired above (line 485). No double-fire.
        const finalObsContent = `✓ final-answer accepted: ${capture.output}`;
        const finalObsStep = makeStep("observation", finalObsContent, {
          observationResult: makeObservationResult("final-answer", true, finalObsContent),
        });

        yield* hooks.onObservation(
          transitionState(state, { steps: stepsWithAction }),
          finalObsContent,
          true,
        );

        return transitionState(state, {
          steps: [...stepsWithAction, finalObsStep],
          toolsUsed: newToolsUsed,
          status: "done",
          output: capture.output,
          iteration: state.iteration + 1,
          meta: {
            ...state.meta,
            terminatedBy: "final_answer_tool" as const,
            finalAnswerCapture: capture,
            pendingToolRequest: undefined,
            pendingToolGroup: undefined,
            lastThought: undefined,
            lastThinking: undefined,
          },
        });
      }

      // accepted: false — produce an error observation and let the loop continue
      // Note: hooks.onAction already fired above (line 485). No double-fire.
      const rejectionMsg = typeof resultObj.error === "string"
        ? resultObj.error
        : "final-answer rejected: conditions not yet met. Complete required steps first.";
      observationContent = `⚠️ ${rejectionMsg}`;
      obsResult = makeObservationResult("final-answer", false, observationContent);

      yield* hooks.onObservation(
        transitionState(state, { steps: stepsWithAction }),
        observationContent,
        false,
      );

      const rejectObsStep = makeStep("observation", observationContent, { observationResult: obsResult });
      newToolsUsed.add("final-answer");

      return transitionState(state, {
        steps: [...stepsWithAction, rejectObsStep],
        toolsUsed: newToolsUsed,
        status: "thinking",
        iteration: state.iteration + 1,
        meta: {
          ...state.meta,
          pendingToolRequest: undefined,
          pendingToolGroup: undefined,
          lastThought: undefined,
          lastThinking: undefined,
        },
      });
    }

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
    } else if (sideEffectAlreadyDone) {
      observationContent = `⚠️ ${toolRequest.tool} already executed successfully with different parameters. Side-effect tools must NOT be called twice. Move on to the next step or give FINAL ANSWER.`;
      obsResult = makeObservationResult(toolRequest.tool, true, observationContent);
    } else {
      const toolStartMs = Date.now();
      const pendingGroup = state.meta.pendingToolGroup as import("./tool-utils.js").ToolRequestGroup | undefined;
      const toolConfig = {
        profile,
        compression,
        scratchpad: state.scratchpad as Map<string, string>,
        agentId: input.agentId,
        sessionId: input.sessionId,
      };

      if (pendingGroup && pendingGroup.mode !== "single" && pendingGroup.requests.length > 1) {
        // Parallel or chain execution
        const groupResult = yield* executeToolGroup(toolService, pendingGroup, toolConfig);
        const toolDurationMs = Date.now() - toolStartMs;
        observationContent = groupResult.combinedObservation;
        // Use the last result's observationResult (or synthesize one from combined)
        const lastResult = groupResult.results[groupResult.results.length - 1];
        obsResult = lastResult?.observationResult ??
          makeObservationResult(toolRequest.tool, true, observationContent);

        // Track all tools used
        for (const r of pendingGroup.requests) {
          newToolsUsed.add(r.tool);
        }

        // Store duration in action step metadata
        const lastActionStep = stepsWithAction[stepsWithAction.length - 1];
        if (lastActionStep?.type === "action") {
          stepsWithAction[stepsWithAction.length - 1] = {
            ...lastActionStep,
            metadata: { ...(lastActionStep.metadata ?? {}), duration: toolDurationMs },
          };
        }
      } else {
        // Single tool execution (existing path — backwards compatible)
        const toolObs = yield* executeToolCall(toolService, toolRequest, toolConfig);
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
    }

    const observationStep = makeStep("observation", observationContent, { observationResult: obsResult });
    const stepsWithObs = [...stepsWithAction, observationStep];

    // Publish observation event
    yield* hooks.onObservation(
      transitionState(state, { steps: stepsWithAction }),
      observationContent,
      obsResult.success,
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
          pendingToolGroup: undefined,
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
        pendingToolGroup: undefined,
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
      requiredTools: input.requiredTools,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
    }, {
      maxIterations: input.maxIterations ?? 10,
      strategy: input.parentStrategy ?? "react-kernel",
      kernelType: "react",
      taskId: input.taskId,
      kernelPass: input.kernelPass,
    });

    // Determine terminatedBy from state
    const terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn" =
      state.meta.terminatedBy === "final_answer_tool"
        ? "final_answer_tool"
        : state.meta.terminatedBy === "end_turn"
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
      finalAnswerCapture: state.meta.finalAnswerCapture as FinalAnswerCapture | undefined,
    };
  });

