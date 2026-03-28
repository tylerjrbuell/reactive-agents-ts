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
import { Effect, Stream, FiberRef, Ref } from "effect";
import type { ReasoningStep } from "../../types/index.js";
import { ExecutionError } from "../../errors/errors.js";
import { LLMService, selectAdapter } from "@reactive-agents/llm-provider";
import type { StreamEvent, LLMMessage } from "@reactive-agents/llm-provider";
import { StreamingTextCallback } from "@reactive-agents/core";
import type { ContextProfile } from "../../context/context-profile.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import {
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  scratchpadStoreRef,
  detectCompletionGaps,
  type FinalAnswerCapture,
  briefTool,
  buildBriefResponse,
  type BriefInput,
  pulseTool,
  buildPulseResponse,
  type PulseInput,
  makeRecallHandler,
  recallTool,
  makeFindHandler,
  findTool,
  ragMemoryStore,
  webSearchHandler,
  ToolService,
  type ToolCallSpec,
  type ResolverInput,
} from "@reactive-agents/tools";

// Re-export for test and consumer backward compatibility
export { detectCompletionGaps } from "@reactive-agents/tools";

import type { ToolSchema } from "./tool-utils.js";
import {
  hasFinalAnswer,
  extractFinalAnswer,
} from "./tool-utils.js";
import { evaluateTermination, defaultEvaluators, type TerminationContext } from "./termination-oracle.js";
import { assembleOutput } from "./output-assembly.js";
import { buildStaticContext, buildDynamicContext } from "../../context/context-engine.js";
import { applyMessageWindow } from "../../context/message-window.js";
import type { MemoryItem } from "../../context/context-engine.js";
import { extractThinking, rescueFromThinking } from "./thinking-utils.js";
import { makeStep } from "./step-utils.js";
import { executeNativeToolCall, makeObservationResult } from "./tool-execution.js";
import { runKernel } from "./kernel-runner.js";
import {
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelMessage,
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
   * Full unfiltered tool schemas from the registry. Used by the dynamic task
   * completion guard to detect MCP namespaces referenced in the task, even
   * when adaptive filtering has hidden some tools from the LLM prompt.
   */
  allToolSchemas?: readonly ToolSchema[];
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
  /** Model identifier for routing/entropy scoring */
  modelId?: string;
  /** Exit kernel loop when all scoped tools have been called successfully */
  exitOnAllToolsCalled?: boolean;
  /** Meta-tool configuration and pre-computed static data for brief/pulse/recall/find. */
  metaTools?: {
    brief?: boolean;
    find?: boolean;
    pulse?: boolean;
    recall?: boolean;
    staticBriefInfo?: {
      indexedDocuments: readonly { source: string; chunkCount: number; format: string }[];
      availableSkills: readonly { name: string; purpose: string }[];
      memoryBootstrap: { semanticLines: number; episodicEntries: number };
    };
    harnessContent?: string;
  };
  /** Feature flag: use native function calling instead of text-based ACTION: parsing.
   *  Default: determined by provider capabilities at runtime. */
  useNativeFunctionCalling?: boolean;
  /** Pre-built ToolCallResolver instance — injected by the kernel runner when FC is active */
  toolCallResolver?: import("@reactive-agents/tools").ToolCallResolver;
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
  _task: string,
  systemPrompt?: string,
  tier?: "local" | "mid" | "large" | "frontier",
): string {
  // Use custom system prompt if provided (no task appended — task is in messages[0])
  if (systemPrompt) return systemPrompt;

  // Lean tier-adaptive instruction — NO task, NO tool schemas, NO format rules
  // The task is seeded as state.messages[0] by the execution engine.
  const t = tier ?? "mid";
  if (t === "local") {
    return "You are a helpful assistant. Use the provided tools when needed to complete tasks.";
  }
  if (t === "frontier" || t === "large") {
    return "You are an expert reasoning agent. Think step by step. Use tools precisely and efficiently. Prefer concise, direct answers once you have sufficient information.";
  }
  // mid tier
  return "You are a reasoning agent. Think step by step and use available tools when needed.";
}

// ── reactKernel: ThoughtKernel ───────────────────────────────────────────────

/**
 * The ReAct ThoughtKernel — a single-step transition function.
 *
 * Given a KernelState, performs ONE reasoning step and returns the next state.
 * Reads `state.status` to decide what to do:
 *
 * - "thinking": Build context, call LLM, parse response, transition to "acting" or "done"
 * - "acting": Execute tool from meta.pendingNativeToolCalls (native FC), observe, transition to "thinking" or "done"
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

// ── KernelMessage → LLMMessage conversion ────────────────────────────────────

/** Convert a KernelMessage to provider-native LLMMessage format. */
function toProviderMessage(msg: KernelMessage): LLMMessage {
  if (msg.role === "assistant") {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant message with tool calls — provider maps to their format
      return {
        role: "assistant",
        content: [
          ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
          ...msg.toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        ],
      } as LLMMessage;
    }
    return { role: "assistant", content: msg.content };
  }
  if (msg.role === "tool_result") {
    return {
      role: "tool" as const,
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      content: msg.content,
    } as LLMMessage;
  }
  // user role (or fallback)
  return { role: "user", content: msg.content };
}

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

    const maxIter = (state.meta.maxIterations as number) ?? 10;

    // ── Dynamic meta-tool injection (final-answer) ───────────────────────────
    // When all required tools have been called and the agent is ready to complete,
    // inject the final-answer tool into the available tool schemas so the LLM
    // can discover and use it as the preferred termination mechanism.
    const hasNonMetaToolCalledForThink = [...state.toolsUsed].some(
      (t) => t !== "final-answer" && t !== "task-complete" && t !== "context-status" && t !== "brief" && t !== "pulse" && t !== "find" && t !== "recall",
    );
    // When no required tools are specified, scratchpad usage alone satisfies the
    // "has done real work" condition — matches the hard gate logic at line ~680.
    const hasAnyToolWork = hasNonMetaToolCalledForThink
      || ((input.requiredTools ?? []).length === 0 && state.toolsUsed.size > 0);
    const hasErrorsForThink = state.steps.some(
      (s) => s.type === "observation" && s.metadata?.observationResult?.success === false,
    );
    const finalAnswerVisible = shouldShowFinalAnswer({
      requiredToolsCalled: state.toolsUsed,
      requiredTools: [...(input.requiredTools ?? [])],
      iteration: state.iteration,
      hasErrors: hasErrorsForThink,
      hasNonMetaToolCalled: hasAnyToolWork,
    });

    const augmentedToolSchemas: readonly import("./tool-utils.js").ToolSchema[] = [
      ...(input.availableToolSchemas ?? []),
      ...(finalAnswerVisible ? [{ name: finalAnswerTool.name, description: finalAnswerTool.description, parameters: finalAnswerTool.parameters }] : []),
      ...(input.metaTools?.brief ? [{ name: briefTool.name, description: briefTool.description, parameters: briefTool.parameters }] : []),
      ...(input.metaTools?.pulse ? [{ name: pulseTool.name, description: pulseTool.description, parameters: pulseTool.parameters }] : []),
    ] as readonly import("./tool-utils.js").ToolSchema[];

    // ── Harness skill injection ──────────────────────────────────────────────
    const harnessContent = input.metaTools?.harnessContent;
    const isNonTrivial =
      input.task.length >= 80 ||
      (input.requiredTools?.length ?? 0) > 0 ||
      (input.metaTools?.staticBriefInfo?.indexedDocuments.length ?? 0) > 0;
    const effectiveSystemPrompt =
      harnessContent && isNonTrivial && (input.metaTools?.brief || input.metaTools?.pulse)
        ? `${harnessContent}\n\n${input.systemPrompt ?? ""}`
        : input.systemPrompt;

    // ── Split context: static in system prompt, dynamic in user message ─────
    // Static content (tool schemas, RULES, task) is sent once in the system prompt
    // to avoid repeating ~500-700 tokens of identical content every iteration.
    const staticContext = buildStaticContext({
      task: input.task,
      profile,
      availableToolSchemas: augmentedToolSchemas,
      requiredTools: input.requiredTools,
      environmentContext: input.environmentContext,
    });
    const baseSystemPrompt = buildSystemPrompt(input.task, effectiveSystemPrompt, profile.tier);
    const adapter = selectAdapter({ supportsToolCalling: true }, profile.tier);
    const patchedBase = adapter.systemPromptPatch?.(baseSystemPrompt, profile.tier ?? "mid") ?? baseSystemPrompt;
    const systemPromptText = `${patchedBase}\n\n${staticContext}`;

    // ── Auto-forward: inject full stored result from last observation ──────────
    // When the previous tool result was compressed and auto-stored in the scratchpad
    // (storedKey on the observation step metadata), inject the full content into this
    // iteration's context so the model can use it directly without calling recall.
    // Budget: 2,000 chars. Only the LAST stored result is forwarded.
    const AUTO_FORWARD_BUDGET = 2_000;
    let autoForwardSection = "";
    if (state.iteration > 0) {
      const lastObsStep = state.steps.filter((s) => s.type === "observation").pop();
      const storedKey = lastObsStep?.metadata?.storedKey as string | undefined;
      if (storedKey && state.scratchpad.has(storedKey)) {
        const fullResult = state.scratchpad.get(storedKey)!;
        const injected =
          fullResult.length <= AUTO_FORWARD_BUDGET
            ? fullResult
            : fullResult.slice(0, AUTO_FORWARD_BUDGET) +
              `\n[...${fullResult.length - AUTO_FORWARD_BUDGET} chars truncated — use recall("${storedKey}") for full content]`;
        autoForwardSection = `[Auto-forwarded full result for ${storedKey}]:\n${injected}`;
      }
    }

    let thoughtPrompt = buildDynamicContext({
      task: input.task,
      steps: state.steps,
      availableToolSchemas: augmentedToolSchemas,
      requiredTools: input.requiredTools,
      iteration: state.iteration,
      maxIterations: maxIter,
      profile,
      memories: (state.meta.memories as MemoryItem[] | undefined),
      priorContext: input.priorContext,
    });

    if (autoForwardSection) {
      thoughtPrompt += `\n\n${autoForwardSection}`;
    }

    thoughtPrompt += "\n\nThink step-by-step. Use available tools when needed, or provide your final answer directly.";

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

    // ── Native FC: convert tool schemas to LLM ToolDefinition format ──────
    const llmTools = augmentedToolSchemas.map((ts) => ({
      name: ts.name,
      description: ts.description,
      inputSchema: {
        type: "object" as const,
        properties: Object.fromEntries(
          (ts.parameters ?? []).map((p) => [
            p.name,
            { type: p.type ?? "string", description: p.description },
          ]),
        ),
        required: (ts.parameters ?? [])
          .filter((p) => p.required)
          .map((p) => p.name),
      } as Record<string, unknown>,
    }));

    // Request logprobs when entropy sensor may be active (modelId present in meta)
    const wantLogprobs = (state.meta.entropy as any)?.modelId !== undefined;

    // ── Build conversation messages ──────────────────────────────────────────
    // Send state.messages directly through sliding window compaction,
    // then convert to provider-native format. The messages array IS the
    // conversation thread — no need to rebuild from steps.
    let compactedMessages = applyMessageWindow(state.messages, profile as import("../../context/context-profile.js").ContextProfile);

    // Defensive: if messages are empty (shouldn't happen after Task 9 seeding), fall back
    if (compactedMessages.length === 0) {
      compactedMessages = [{ role: "user" as const, content: thoughtPrompt }];
    }

    // Convert KernelMessage[] → LLMMessage[] for the provider
    const conversationMessages: LLMMessage[] = (compactedMessages as readonly KernelMessage[]).map(toProviderMessage);

    const llmStreamEffect = llm.stream({
      messages: conversationMessages,
      systemPrompt: systemPromptText,
      maxTokens: outputMaxTokens,
      temperature: temp,
      ...(llmTools.length > 0 ? { tools: llmTools } : {}),
      ...(wantLogprobs ? { logprobs: true, topLogprobs: 5 } : {}),
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
    let accumulatedLogprobs: { token: string; logprob: number; topLogprobs?: readonly { token: string; logprob: number }[] }[] = [];
    // Native FC: accumulate tool_use blocks from stream events
    let accumulatedToolCalls: { id: string; name: string; input: string }[] = [];
    let accumulatedStopReason: string = "end_turn";

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
          // Extract stop reason from content_complete event if present
          if ("stopReason" in event && typeof (event as any).stopReason === "string") {
            accumulatedStopReason = (event as any).stopReason;
          }
        } else if (event.type === "usage") {
          accumulatedUsage = event.usage;
        } else if (event.type === "logprobs") {
          accumulatedLogprobs = [...accumulatedLogprobs, ...event.logprobs];
        } else if (event.type === "tool_use_start") {
          // Native FC: start accumulating a new tool call
          accumulatedToolCalls.push({ id: event.id, name: event.name, input: "" });
          accumulatedStopReason = "tool_use";
        } else if (event.type === "tool_use_delta") {
          // Native FC: accumulate JSON input for the current tool call
          const currentTC = accumulatedToolCalls[accumulatedToolCalls.length - 1];
          if (currentTC) {
            currentTC.input += event.input;
          }
        }
      }),
    ).pipe(Effect.catchAll(() => Effect.void));

    // Store logprobs in entropy meta for the entropy sensor
    if (accumulatedLogprobs.length > 0) {
      const entropyMeta = (state.meta.entropy as any) ?? {};
      (state.meta as any).entropy = { ...entropyMeta, lastLogprobs: accumulatedLogprobs };
    }

    // Build response shape matching original llm.complete() return
    const thoughtResponse = {
      content: accumulatedContent,
      stopReason: accumulatedStopReason as "end_turn",
      usage: accumulatedUsage,
      model: "unknown",
    };

    // Increment LLM call counter
    state = transitionState(state, { llmCalls: (state.llmCalls ?? 0) + 1 });

    const rawThought = thoughtResponse.content;
    const newTokens = state.tokens + thoughtResponse.usage.totalTokens;
    const newCost = state.cost + thoughtResponse.usage.estimatedCost;

    // Strip <think>...</think> blocks before parsing
    const { thinking: extractedThinking, content: cleanContent } = extractThinking(rawThought);
    const providerThinking = (thoughtResponse as any).thinking as string | undefined;
    const thinking = extractedThinking || providerThinking || null;
    let thought = cleanContent || providerThinking || rawThought;
    // Thinking models (e.g. cogito) may put the full answer in the thinking field
    // with only a tiny fragment in content. When content is deficient, extract
    // structured value (final answer, code, tool calls) from thinking.
    if (thought.trim().length < 50 && thinking && thinking.length > 100) {
      const rescued = rescueFromThinking(thinking, thought.trim());
      if (rescued) thought = rescued;
    }

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

    // ── FAST-PATH: trivial task exit ─────────────────────────────────────────
    // If this is the first iteration, the model produced no tool call, no
    // FINAL ANSWER prefix (handled by the oracle), and the response is
    // substantive, exit immediately without running the termination oracle or
    // tool-parsing pipeline. Avoids 4-6 extra loop iterations that meta-tool
    // injection + entropy scoring would otherwise add to simple Q&A.
    // SKIP fast-path when required tools are specified — the agent must use
    // them before it can exit, even if the model already knows the answer.
    const hasRequiredTools = (input.requiredTools?.length ?? 0) > 0;
    if (
      state.iteration === 0 &&
      !hasRequiredTools &&
      !thought.match(/ACTION:/i) &&
      !thought.match(/FINAL\s+ANSWER\s*[:：]/i) &&
      thought.trim().length > 20 &&
      thoughtResponse.stopReason === "end_turn"
    ) {
      const output = thought.trim();
      return transitionState(state, {
        steps: newSteps,
        tokens: newTokens,
        cost: newCost,
        status: "done" as const,
        output,
        priorThought: output,
        iteration: state.iteration + 1,
        meta: {
          ...state.meta,
          terminatedBy: "end_turn",
        },
      });
    }

    // ── NATIVE FUNCTION CALLING BRANCH ─────────────────────────────────────
    // The LLM returns structured tool_use blocks instead of text-based ACTION:
    // directives. We resolve them through the ToolCallResolver.
    if ((input as ReActKernelInput).toolCallResolver) {
      const resolver = (input as ReActKernelInput).toolCallResolver!;

      // Parse accumulated tool call inputs from JSON strings
      const parsedToolCalls = accumulatedToolCalls.map((tc) => {
        let parsedInput: unknown = {};
        try {
          parsedInput = tc.input ? JSON.parse(tc.input) : {};
        } catch {
          parsedInput = {};
        }
        return { id: tc.id, name: tc.name, input: parsedInput };
      });

      const resolverInput: ResolverInput = {
        content: accumulatedContent || undefined,
        toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
        stopReason: accumulatedStopReason,
      };

      const resolverResult = yield* resolver.resolve(
        resolverInput,
        augmentedToolSchemas.map((ts) => ({ name: ts.name })),
      );

      if (resolverResult._tag === "tool_calls") {
        // Store pending native tool calls in meta for handleActing
        return transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          cost: newCost,
          status: "acting",
          meta: {
            ...state.meta,
            pendingNativeToolCalls: resolverResult.calls as readonly ToolCallSpec[],
            // Store thought + thinking for post-action FA check
            lastThought: thought,
            lastThinking: thinking,
          },
        });
      }

      if (resolverResult._tag === "final_answer") {
        // Genuine final answer (no tool calls). Check completion gaps first —
        // if required tools haven't been called, redirect instead of accepting.
        const requiredTools = input.requiredTools ?? [];
        const allRequiredMet = requiredTools.every((t) => state.toolsUsed.has(t));
        if (!allRequiredMet && state.iteration < (state.meta.maxIterations as number ?? 10) - 1) {
          const missing = requiredTools.filter((t) => !state.toolsUsed.has(t));

          // Use adapter hint for targeted guidance, fall back to generic redirect
          const lastActStep = state.steps.filter(s => s.type === "action").pop();
          const lastTool = (lastActStep?.metadata?.toolCall as { name?: string } | undefined)?.name;
          const adapterRedirect = adapter.continuationHint?.({
            toolsUsed: state.toolsUsed,
            requiredTools: requiredTools as string[],
            missingTools: missing,
            iteration: state.iteration,
            maxIterations: (state.meta.maxIterations as number) ?? 10,
            lastToolName: lastTool,
          });
          const redirectMsg = adapterRedirect
            ?? `Not done yet — you still need to call: ${missing.join(", ")}. Do not give a final answer until all required tools have been used.`;

          const redirectStep = makeStep("observation", redirectMsg, {
            observationResult: makeObservationResult("system", false, redirectMsg),
          });

          // Append redirect to BOTH steps (observability) AND messages (what LLM sees)
          const redirectMessages = [...(state.messages as readonly KernelMessage[]),
            { role: "user" as const, content: redirectMsg }];

          return transitionState(state, {
            steps: [...newSteps, redirectStep],
            messages: redirectMessages,
            tokens: newTokens,
            cost: newCost,
            iteration: state.iteration + 1,
          });
        }

        // Also check dynamic completion gaps
        const gaps = detectCompletionGaps(
          input.task,
          state.toolsUsed,
          (input as ReActKernelInput).allToolSchemas ?? input.availableToolSchemas ?? [],
          newSteps,
        );
        if (gaps.length > 0 && state.iteration < (state.meta.maxIterations as number ?? 10) - 1) {
          const gapMsg = `Not done yet — missing steps:\n${gaps.map((g) => `• ${g}`).join("\n")}`;
          const gapStep = makeStep("observation", gapMsg, {
            observationResult: makeObservationResult("system", false, gapMsg),
          });
          const gapMessages = [...(state.messages as readonly KernelMessage[]),
            { role: "user" as const, content: gapMsg }];
          return transitionState(state, {
            steps: [...newSteps, gapStep],
            messages: gapMessages,
            tokens: newTokens,
            cost: newCost,
            iteration: state.iteration + 1,
          });
        }

        // All checks pass — assemble final output
        const hasFA = hasFinalAnswer(resolverResult.content);
        const cleanContent = hasFA
          ? extractFinalAnswer(resolverResult.content)
          : resolverResult.content;
        const terminatedBy = hasFA ? "final_answer" : "end_turn";

        const assembled = assembleOutput({
          steps: newSteps,
          finalAnswer: cleanContent,
          terminatedBy: "llm_end_turn",
          entropyScores: (state.meta.entropy as any)?.entropyHistory,
        });
        return transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          cost: newCost,
          status: "done" as const,
          output: assembled.text,
          priorThought: thought.trim(),
          iteration: state.iteration + 1,
          meta: {
            ...state.meta,
            terminatedBy,
          },
        });
      } else if (resolverResult._tag === "thinking") {
        // Model returned no tool calls and no substantial content — it's uncertain
        // what to do next. Add a step with any content and inject guidance.
        const thinkingContent = resolverResult.content.trim();
        const reqTools = input.requiredTools ?? [];
        const missingReq = reqTools.filter((t) => !state.toolsUsed.has(t));

        // Count consecutive empty responses (thinking with no content)
        const consecutiveEmpty = !thinkingContent
          ? newSteps.reduceRight((count, s) => {
              if (count === -1) return -1; // stopped counting
              if (s.type === "observation" && s.content.startsWith("Continue working")) return count + 1;
              if (s.type === "thought" || s.type === "action") return -1; // reset
              return count;
            }, 0)
          : 0;

        let thinkingSteps = [...newSteps];
        if (thinkingContent) {
          thinkingSteps = [...thinkingSteps, makeStep("thought", thinkingContent)];
        }

        // Build nudge message — ALWAYS when required tools are missing, not just on empty
        // responses. This ensures an observation step is injected between thoughts,
        // preventing the consecutive-thoughts loop detector from killing productive
        // iterations where the model thinks but hasn't called the next tool yet.
        let nudgeMessage: string | undefined;
        if (missingReq.length > 0) {
          // After 2 consecutive empty responses, escalate to a stronger directive
          const isStuck = consecutiveEmpty >= 2;
          const defaultNudge = isStuck
            ? `⚠️ ACTION REQUIRED: You have not made progress. You MUST call: ${missingReq.join(", ")} RIGHT NOW. Stop waiting and use the tool immediately.`
            : `Continue working on the task. You still need to call: ${missingReq.join(", ")}. Use the available tools to complete the task.`;

          // Try adapter hint first (returns undefined for non-local tiers)
          const lastObsForHint = state.steps.filter((s) => s.type === "observation").pop();
          const lastActionForHint = state.steps.filter((s) => s.type === "action").pop();
          const lastToolNameForHint = (lastActionForHint?.metadata?.toolCall as { name?: string } | undefined)?.name;
          const adapterNudge = adapter.continuationHint?.({
            toolsUsed: state.toolsUsed,
            requiredTools: reqTools,
            missingTools: missingReq,
            iteration: state.iteration,
            maxIterations: (state.meta.maxIterations as number) ?? 10,
            lastToolName: lastToolNameForHint,
            lastToolResultPreview: lastObsForHint?.content?.slice(0, 200),
          });

          nudgeMessage = adapterNudge ?? defaultNudge;
          thinkingSteps = [...thinkingSteps, makeStep("observation", nudgeMessage, {
            observationResult: makeObservationResult("system", true, nudgeMessage),
          })];
        }

        // Append the nudge as a user message in conversation history
        // so the model sees it in the next iteration's context (not just as a step).
        const updatedMessages = nudgeMessage
          ? [...(state.messages as readonly KernelMessage[]), { role: "user" as const, content: nudgeMessage }]
          : state.messages;

        return transitionState(state, {
          steps: thinkingSteps,
          tokens: newTokens,
          cost: newCost,
          iteration: state.iteration + 1,
          priorThought: thinkingContent || state.priorThought,
          messages: updatedMessages,
        });
      }
    }

    // ── TERMINATION ORACLE ──────────────────────────────────────────────────
    // Unified exit decision: replaces scattered hasFinalAnswer, end_turn, and
    // completion-gap checks with a single scored signal pipeline.
    {
      const priorRedirects = newSteps.filter(
        (s) => s.type === "observation" && s.content.startsWith("\u26A0\uFE0F Not done yet"),
      ).length;
      const priorFAAttempts = state.steps.filter(
        (s) => s.type === "observation" && s.content.startsWith("\u26A0\uFE0F") && s.content.includes("final-answer"),
      ).length;

      const oracleCtx: TerminationContext = {
        thought: thought.trim(),
        thinking: thinking?.trim(),
        stopReason: thoughtResponse.stopReason ?? "end_turn",
        toolRequest: null,
        iteration: state.iteration,
        steps: state.steps,
        priorThought: state.priorThought,
        entropy: (state.meta.entropy as any)?.latestScore,
        trajectory: (state.meta.entropy as any)?.latestTrajectory,
        controllerDecisions: (state.meta.controllerDecisions as any[]) ?? undefined,
        toolsUsed: state.toolsUsed,
        requiredTools: (state.meta.requiredTools as string[]) ?? (input.requiredTools as string[]) ?? [],
        allToolSchemas: input.allToolSchemas ?? input.availableToolSchemas ?? [],
        redirectCount: priorRedirects,
        priorFinalAnswerAttempts: priorFAAttempts,
        taskDescription: input.task,
      };

      const decision = evaluateTermination(oracleCtx, defaultEvaluators);

      if (decision.shouldExit && decision.output) {
        const assembled = assembleOutput({
          steps: state.steps,
          finalAnswer: decision.output,
          terminatedBy: decision.reason,
          entropyScores: (state.meta.entropy as any)?.entropyHistory,
        });
        return transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          cost: newCost,
          status: "done" as const,
          output: assembled.text,
          priorThought: thought.trim(),
          iteration: state.iteration + 1,
          meta: {
            ...state.meta,
            terminatedBy: decision.reason,
            evaluator: decision.evaluator,
            allVerdicts: decision.allVerdicts,
          },
        });
      }

      if (decision.action === "redirect") {
        const gapMsg = `\u26A0\uFE0F Not done yet — ${decision.reason}.\nComplete remaining actions before finishing.`;
        const gapStep = makeStep("observation", gapMsg, {
          observationResult: makeObservationResult("completion-guard", false, gapMsg),
        });
        yield* hooks.onObservation(state, gapMsg, false);
        return transitionState(state, {
          steps: [...newSteps, gapStep],
          tokens: newTokens,
          cost: newCost,
          iteration: state.iteration + 1,
          priorThought: thought.trim(),
          meta: { ...state.meta, redirectCount: (priorRedirects + 1) },
        });
      }

      // Continue — update priorThought for next iteration's stability check
      state = transitionState(state, { priorThought: thought.trim() });
    }

    // No tool request and oracle said continue — increment iteration and loop
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

    // ── NATIVE FC ACTING BRANCH ─────────────────────────────────────────────
    // When the thinking phase stored pendingNativeToolCalls, execute them here
    // using the structured ToolCallSpec (pre-parsed arguments, no regex repair).
    const pendingNativeCalls = state.meta.pendingNativeToolCalls as readonly ToolCallSpec[] | undefined;
    if (pendingNativeCalls && pendingNativeCalls.length > 0) {
      const newToolsUsed = new Set(state.toolsUsed);
      let allSteps = [...state.steps];

      for (const tc of pendingNativeCalls) {
        const META_TOOL_NAMES = new Set(["final-answer", "task-complete", "context-status", "brief", "pulse", "find", "recall"]);

        // ── BRIEF INLINE HANDLER (FC) ─────────────────────────────────────────
        if (tc.name === "brief" && input.metaTools?.brief) {
          const liveStore = yield* Ref.get(scratchpadStoreRef);
          const recallKeys = [...liveStore.keys()];
          const briefInput: BriefInput = {
            section: tc.arguments?.section as string | undefined,
            availableTools: input.availableToolSchemas ?? [],
            indexedDocuments: input.metaTools.staticBriefInfo?.indexedDocuments ?? [],
            availableSkills: input.metaTools.staticBriefInfo?.availableSkills ?? [],
            memoryBootstrap: input.metaTools.staticBriefInfo?.memoryBootstrap ?? { semanticLines: 0, episodicEntries: 0 },
            recallKeys,
            tokens: state.tokens,
            tokenBudget: (input.contextProfile as any)?.maxTokens ?? 8000,
            entropy: ((state.meta as any).entropy?.latest) as { composite: number; shape: string; momentum: number } | undefined,
            controllerDecisionLog: state.controllerDecisionLog,
            iterationCount: state.iteration,
          };
          const briefContent = buildBriefResponse(briefInput);
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const obsStep = makeStep("observation", briefContent, {
            observationResult: makeObservationResult("brief", true, briefContent),
          });
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            briefContent,
            true,
          );
          newToolsUsed.add(tc.name);
          allSteps = [...allSteps, actionStep, obsStep];
          continue;
        }

        // ── PULSE INLINE HANDLER (FC) ─────────────────────────────────────────
        if (tc.name === "pulse" && input.metaTools?.pulse) {
          const pulseInput: PulseInput = {
            question: tc.arguments?.question as string | undefined,
            entropy: ((state.meta as any).entropy?.latest) as { composite: number; shape: string; momentum: number; history?: readonly number[] } | undefined,
            controllerDecisionLog: state.controllerDecisionLog,
            steps: allSteps,
            iteration: state.iteration,
            maxIterations: (state.meta.maxIterations as number | undefined) ?? 10,
            tokens: state.tokens,
            tokenBudget: (input.contextProfile as any)?.maxTokens ?? 8000,
            task: input.task,
            allToolSchemas: input.allToolSchemas ?? input.availableToolSchemas ?? [],
            toolsUsed: newToolsUsed,
            requiredTools: input.requiredTools ?? [],
          };
          const pulseContent = JSON.stringify(buildPulseResponse(pulseInput), null, 2);
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const obsStep = makeStep("observation", pulseContent, {
            observationResult: makeObservationResult("pulse", true, pulseContent),
          });
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            pulseContent,
            true,
          );
          newToolsUsed.add(tc.name);
          allSteps = [...allSteps, actionStep, obsStep];
          continue;
        }

        // ── FINAL-ANSWER HARD GATE (FC) ───────────────────────────────────────
        if (tc.name === "final-answer") {
          const META_TOOLS = new Set(["final-answer", "task-complete", "context-status", "brief", "pulse", "find", "recall"]);
          const hasNonMetaToolCalled = [...newToolsUsed].some((t) => !META_TOOLS.has(t));
          const requiredTools = input.requiredTools ?? [];
          const allRequiredMet = requiredTools.every((t) => newToolsUsed.has(t));
          let canComplete = allRequiredMet && (hasNonMetaToolCalled || requiredTools.length === 0);

          // ── Dynamic task completion guard (FC) ──────────────────────────────
          let completionGapMessage: string | undefined;
          const priorFinalAnswerAttempts = allSteps.filter(
            (s) => s.type === "observation" && s.content.startsWith("⚠️") && s.content.includes("final-answer"),
          ).length;
          if (canComplete && priorFinalAnswerAttempts < 1) {
            const gaps = detectCompletionGaps(
              input.task,
              newToolsUsed,
              input.allToolSchemas ?? input.availableToolSchemas ?? [],
              allSteps,
            );
            if (gaps.length > 0) {
              canComplete = false;
              completionGapMessage = `Not done yet — missing steps:\n${gaps.map((g) => `  • ${g}`).join("\n")}\nComplete these actions before calling final-answer.`;
            }
          }

          const handlerResult = yield* makeFinalAnswerHandler({
            canComplete,
            pendingTools: completionGapMessage ? [completionGapMessage] : undefined,
          })({ ...tc.arguments });
          const resultObj = handlerResult as Record<string, unknown>;

          if (resultObj.accepted === true) {
            const capture = resultObj._capture as FinalAnswerCapture;
            const finalObsContent = `✓ final-answer accepted: ${capture.output}`;
            const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
              toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
            });
            const finalObsStep = makeStep("observation", finalObsContent, {
              observationResult: makeObservationResult("final-answer", true, finalObsContent),
            });

            yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
            yield* hooks.onObservation(
              transitionState(state, { steps: [...allSteps, actionStep] }),
              finalObsContent,
              true,
            );

            newToolsUsed.add(tc.name);
            return transitionState(state, {
              steps: [...allSteps, actionStep, finalObsStep],
              toolsUsed: newToolsUsed,
              status: "done",
              output: capture.output,
              iteration: state.iteration + 1,
              meta: {
                ...state.meta,
                terminatedBy: "final_answer_tool" as const,
                finalAnswerCapture: capture,
                pendingNativeToolCalls: undefined,
                lastThought: undefined,
                lastThinking: undefined,
              },
            });
          }

          // Rejected — produce error observation and continue
          const rejectionMsg = typeof resultObj.error === "string"
            ? resultObj.error
            : "final-answer rejected: conditions not yet met.";
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const rejectObs = `⚠️ ${rejectionMsg}`;
          const rejectObsStep = makeStep("observation", rejectObs, {
            observationResult: makeObservationResult("final-answer", false, rejectObs),
          });

          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            rejectObs,
            false,
          );

          newToolsUsed.add(tc.name);
          allSteps = [...allSteps, actionStep, rejectObsStep];
          continue;
        }

        // ── Check blocked tools ───────────────────────────────────────────────
        const isBlocked = input.blockedTools?.includes(tc.name) ?? false;
        if (isBlocked) {
          const blockMsg = `⚠️ BLOCKED: ${tc.name} already executed successfully in a prior pass.`;
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const blockObsStep = makeStep("observation", blockMsg, {
            observationResult: makeObservationResult(tc.name, true, blockMsg),
          });
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            blockMsg,
            true,
          );
          allSteps = [...allSteps, actionStep, blockObsStep];
          continue;
        }

        // ── Duplicate action detection (FC) ───────────────────────────────────
        // Has this exact tool call (same name + same args) already succeeded?
        const currentActionJson = JSON.stringify({ tool: tc.name, args: tc.arguments });
        const isDuplicate = allSteps.some((step, idx) => {
          if (step.type !== "action") return false;
          const stepTc = step.metadata?.toolCall as { name: string; arguments: unknown } | undefined;
          if (!stepTc) return false;
          if (JSON.stringify({ tool: stepTc.name, args: stepTc.arguments }) !== currentActionJson) return false;
          const next = allSteps[idx + 1];
          return next?.type === "observation" && next.metadata?.observationResult?.success === true;
        });
        if (isDuplicate) {
          // Surface prior result with advisory — don't re-execute
          const priorSuccessIdx = allSteps.findIndex((step, idx) => {
            if (step.type !== "action") return false;
            const stepTc = step.metadata?.toolCall as { name: string; arguments: unknown } | undefined;
            if (!stepTc) return false;
            if (JSON.stringify({ tool: stepTc.name, args: stepTc.arguments }) !== currentActionJson) return false;
            const next = allSteps[idx + 1];
            return next?.type === "observation" && next.metadata?.observationResult?.success === true;
          });
          const priorObsContent = priorSuccessIdx >= 0 ? allSteps[priorSuccessIdx + 1]?.content ?? "" : "";
          const reqTools = input.requiredTools ?? [];
          const missingReq = reqTools.filter((t) => !newToolsUsed.has(t));
          const nextHint = missingReq.length > 0
            ? `You still need to call: ${missingReq.join(", ")}. Do that now.`
            : "Give FINAL ANSWER if all steps are complete.";
          const dupContent = `${priorObsContent} [Already done — do NOT repeat. ${nextHint}]`;
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const dupObsStep = makeStep("observation", dupContent, {
            observationResult: makeObservationResult(tc.name, true, dupContent),
          });
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            dupContent,
            true,
          );
          allSteps = [...allSteps, actionStep, dupObsStep];
          continue;
        }

        // ── Side-effect guard (FC) ────────────────────────────────────────────
        // Tools that mutate external state must not run twice even with different parameters
        const SIDE_EFFECT_PREFIXES = ["send", "create", "delete", "push", "merge", "fork", "update", "assign", "remove"];
        const isSideEffectTool = SIDE_EFFECT_PREFIXES.some(
          (p) => tc.name.toLowerCase().includes(p),
        );
        if (isSideEffectTool) {
          const sideEffectAlreadyDone = allSteps.some((step, idx) => {
            if (step.type !== "action") return false;
            const stepTc = step.metadata?.toolCall as { name: string } | undefined;
            if (stepTc?.name !== tc.name) return false;
            const next = allSteps[idx + 1];
            return next?.type === "observation" && next.metadata?.observationResult?.success === true;
          });
          if (sideEffectAlreadyDone) {
            const sideEffectMsg = `⚠️ ${tc.name} already executed successfully with different parameters. Side-effect tools must NOT be called twice. Move on to the next step or give FINAL ANSWER.`;
            const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
              toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
            });
            const sideObsStep = makeStep("observation", sideEffectMsg, {
              observationResult: makeObservationResult(tc.name, true, sideEffectMsg),
            });
            yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
            yield* hooks.onObservation(
              transitionState(state, { steps: [...allSteps, actionStep] }),
              sideEffectMsg,
              true,
            );
            allSteps = [...allSteps, actionStep, sideObsStep];
            continue;
          }
        }

        // ── Repetition guard (FC) ─────────────────────────────────────────────
        // When the same tool is called 2+ times, nudge to synthesize
        if (!META_TOOL_NAMES.has(tc.name)) {
          const priorCallsOfSameTool = allSteps.filter((s) => {
            if (s.type !== "action") return false;
            const stepTc = s.metadata?.toolCall as { name: string } | undefined;
            return (stepTc?.name ?? "") === tc.name;
          }).length;
          if (priorCallsOfSameTool >= 2) {
            // Include missing required tools in the nudge so the model knows what to do next
            const reqTools = input.requiredTools ?? [];
            const missingRequired = reqTools.filter((t) => !newToolsUsed.has(t));
            const missingHint = missingRequired.length > 0
              ? ` You still need to call: ${missingRequired.join(", ")}. Do that now instead of repeating ${tc.name}.`
              : " Use final-answer to respond now.";
            const nudge = `⚠️ You have already called ${tc.name} ${priorCallsOfSameTool} times. Stop repeating this tool.${missingHint}`;
            const nudgeStep = makeStep("observation", nudge, {
              observationResult: makeObservationResult(tc.name, false, nudge),
            });
            yield* hooks.onObservation(
              transitionState(state, { steps: allSteps }),
              nudge,
              false,
            );
            allSteps = [...allSteps, nudgeStep];
            continue;
          }
        }

        // ── Execute the tool via ToolService ──────────────────────────────────
        const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
          toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          toolUsed: tc.name,
        });
        allSteps = [...allSteps, actionStep];
        newToolsUsed.add(tc.name);

        yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));

        if (toolService._tag === "None") {
          const errContent = `[Tool "${tc.name}" requested but ToolService is not available]`;
          const errObsStep = makeStep("observation", errContent, {
            observationResult: makeObservationResult(tc.name, false, errContent),
          });
          yield* hooks.onObservation(
            transitionState(state, { steps: allSteps }),
            errContent,
            false,
          );
          allSteps = [...allSteps, errObsStep];
          continue;
        }

        const toolStartMs = Date.now();
        const execResult = yield* executeNativeToolCall(
          toolService.value,
          tc,
          input.agentId ?? "reasoning-agent",
          input.sessionId ?? "reasoning-session",
          { compression, scratchpad: state.scratchpad as Map<string, string> },
        );
        const toolDurationMs = Date.now() - toolStartMs;

        // Update action step with duration
        const lastActionIdx = allSteps.length - 1;
        const lastAction = allSteps[lastActionIdx];
        if (lastAction) {
          allSteps[lastActionIdx] = {
            ...lastAction,
            metadata: { ...(lastAction.metadata ?? {}), duration: toolDurationMs },
          };
        }

        const obsStep = makeStep("observation", execResult.content, {
          observationResult: makeObservationResult(tc.name, execResult.success, execResult.content),
        });

        yield* hooks.onObservation(
          transitionState(state, { steps: allSteps }),
          execResult.content,
          execResult.success,
        );

        allSteps = [...allSteps, obsStep];
      }

      // Sync scratchpad
      const toolScratchpad = yield* Ref.get(scratchpadStoreRef);
      const mergedScratchpad = new Map(state.scratchpad);
      for (const [k, v] of toolScratchpad) {
        mergedScratchpad.set(k, v);
      }

      // ── Build conversation history entry for this round of tool calls ──────
      // Append: assistant message (thought + tool_use blocks) + tool_result messages.
      // This gives the next iteration a proper multi-turn conversation history
      // instead of a packed text blob when useNativeFC is active.
      const newConversationHistory: readonly KernelMessage[] = (() => {
        const prior = state.messages as readonly KernelMessage[];

        // Collect action/observation pairs added by this acting phase.
        // Only include steps added after the current state.steps (i.e. this turn).
        const stepsBefore = state.steps.length;
        const newStepsThisTurn = allSteps.slice(stepsBefore);

        // Build the assistant message with tool call specs
        const assistantThought = (state.meta.lastThought as string) ?? "";
        const toolCallsForHistory = pendingNativeCalls
          .filter((tc) => {
            // Only include tool calls that were actually attempted (their action step exists)
            return newStepsThisTurn.some(
              (s) => s.type === "action" && (s.metadata?.toolCall as { id?: string } | undefined)?.id === tc.id,
            );
          })
          .map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));

        // Build tool result messages — one per tool call that has an observation
        const toolResultMessages: KernelMessage[] = pendingNativeCalls.flatMap((tc) => {
          // Find the observation step that follows the action step for this tool call
          const actionIdx = newStepsThisTurn.findIndex(
            (s) => s.type === "action" && (s.metadata?.toolCall as { id?: string } | undefined)?.id === tc.id,
          );
          if (actionIdx < 0) return [];
          const obsStep = newStepsThisTurn[actionIdx + 1];
          if (!obsStep || obsStep.type !== "observation") return [];
          return [{
            role: "tool_result" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            content: obsStep.content,
          }];
        });

        if (toolCallsForHistory.length === 0) {
          // No tool calls actually appended (all skipped/blocked) — don't add to history
          return prior;
        }

        const assistantMsg: KernelMessage = {
          role: "assistant",
          content: assistantThought,
          toolCalls: toolCallsForHistory,
        };

        // Append progress summary for reactive strategy: tells the model what it did
        // and what's left. This is critical for local/mid models that don't infer
        // next steps from conversation structure alone.
        const reqTools = input.requiredTools ?? [];
        const usedSoFar = [...newToolsUsed];
        const missing = reqTools.filter((t) => !newToolsUsed.has(t));

        if (missing.length > 0) {
          // Structured decision framework: tell the model exactly what to do next.
          // This mirrors what the text-based ReAct path did with "take ONE action
          // or give your FINAL ANSWER" — a clear binary choice the model can follow.
          const progressMsg: KernelMessage = {
            role: "user",
            content: `You must still call: ${missing.join(", ")}. Call ${missing[0]} now with the appropriate arguments.`,
          };
          return [...prior, assistantMsg, ...toolResultMessages, progressMsg];
        }

        // All required tools called — tell model to finish
        if (reqTools.length > 0) {
          const finishMsg: KernelMessage = {
            role: "user",
            content: "All required tools have been called. Synthesize the results and provide your final answer.",
          };
          return [...prior, assistantMsg, ...toolResultMessages, finishMsg];
        }

        return [...prior, assistantMsg, ...toolResultMessages];
      })();

      // All native tool calls executed — transition back to thinking
      return transitionState(state, {
        steps: allSteps,
        toolsUsed: newToolsUsed,
        scratchpad: mergedScratchpad,
        messages: newConversationHistory,
        status: "thinking",
        iteration: state.iteration + 1,
        meta: {
          ...state.meta,
          pendingNativeToolCalls: undefined,
          lastThought: undefined,
          lastThinking: undefined,
        },
      });
    }

    // No pending native tool calls — shouldn't happen, transition back to thinking
    return transitionState(state, {
      status: "thinking",
      iteration: state.iteration + 1,
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
    // ── Register meta-tools into ToolService when enabled ────────────────────
    const toolServiceOpt = yield* Effect.serviceOption(ToolService);
    if (toolServiceOpt._tag === "Some") {
      const ts = toolServiceOpt.value;
      if (input.metaTools?.recall) {
        yield* ts.register(recallTool, makeRecallHandler(scratchpadStoreRef)).pipe(Effect.catchAll(() => Effect.void));
      }
      if (input.metaTools?.find) {
        yield* ts.register(findTool, makeFindHandler({
          ragStore: ragMemoryStore,
          webSearchHandler,
          recallStoreRef: scratchpadStoreRef,
          config: {},
        })).pipe(Effect.catchAll(() => Effect.void));
      }
    }

    // Native FC detection is handled by runKernel (kernel-runner.ts) —
    // it auto-detects provider capabilities and injects the FC flag + resolver.
    // No need to duplicate that logic here.

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
      metaTools: input.metaTools,
      // Explicit FC overrides are passed through for tests/manual config
      ...(input.useNativeFunctionCalling != null ? { useNativeFunctionCalling: input.useNativeFunctionCalling } : {}),
      ...(input.toolCallResolver ? { toolCallResolver: input.toolCallResolver } : {}),
    } as KernelInput, {
      maxIterations: input.maxIterations ?? 10,
      strategy: input.parentStrategy ?? "react-kernel",
      kernelType: "react",
      taskId: input.taskId,
      kernelPass: input.kernelPass,
      modelId: input.modelId,
      taskDescription: input.task,
      temperature: input.temperature,
      exitOnAllToolsCalled: input.exitOnAllToolsCalled,
    });

    // Determine terminatedBy from state — map oracle reasons to canonical types
    const rawTerminatedBy = state.meta.terminatedBy as string | undefined;
    const terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn" =
      rawTerminatedBy === "final_answer_tool"
        ? "final_answer_tool"
        : rawTerminatedBy === "end_turn" || rawTerminatedBy === "llm_end_turn"
          ? "end_turn"
          : rawTerminatedBy === "final_answer_regex"
            ? "final_answer"
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
      llmCalls: state.llmCalls ?? 0,
    };
  });

