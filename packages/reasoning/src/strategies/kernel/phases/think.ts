/**
 * Think phase — calls the LLM and understands what it decided to do.
 *
 * Extracted verbatim from react-kernel.ts. Handles:
 * - Dynamic meta-tool injection (final-answer, brief, pulse)
 * - Harness skill injection
 * - System prompt + context assembly (static/ICS split)
 * - LLM stream consumption with text delta emission
 * - Native FC tool call parsing + required-tool gating
 * - Termination oracle evaluation
 * - Fast-path trivial task exit
 */
import { Effect, Stream, FiberRef, Either } from "effect";
import { ExecutionError } from "../../../errors/errors.js";
import { LLMService, selectAdapter } from "@reactive-agents/llm-provider";
import {
  buildSystemPrompt,
  toProviderMessage,
  buildToolSchemas,
  buildConversationMessages,
} from "./context-builder.js";
import { StreamingTextCallback } from "@reactive-agents/core";
import {
  finalAnswerTool,
  shouldShowFinalAnswer,
  detectCompletionGaps,
  briefTool,
  pulseTool,
  recallTool,
  findTool,
  type ToolCallSpec,
  type ResolverInput,
} from "@reactive-agents/tools";

import type { ToolSchema } from "../utils/tool-utils.js";
import {
  hasFinalAnswer,
  extractFinalAnswer,
  gateNativeToolCallsForRequiredTools,
  computeNoveltyRatio,
} from "../utils/tool-utils.js";
import { evaluateTermination, defaultEvaluators, type TerminationContext } from "../utils/termination-oracle.js";
import { assembleOutput } from "../output-assembly.js";
import { buildStaticContext } from "../../../context/context-engine.js";
import { extractThinking, rescueFromThinking } from "../utils/stream-parser.js";
import { makeStep } from "../utils/step-utils.js";
import { makeObservationResult } from "../utils/tool-execution.js";
import {
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelMessage,
  type ReActKernelInput,
} from "../kernel-state.js";

/** Meta-tool names — not counted as "real work" for completion detection. */
const META_TOOL_SET = new Set(["final-answer", "task-complete", "context-status", "brief", "pulse", "find", "recall"]);

/** Returns true when token pressure is critical — only final-answer should be offered. */
export function shouldNarrowToFinalAnswerOnly(opts: {
  estimatedTokens: number
  maxTokens: number
}): boolean {
  return opts.estimatedTokens / opts.maxTokens >= 0.95
}

export function handleThinking(
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

    const augmentedToolSchemas: readonly ToolSchema[] = [
      ...(input.availableToolSchemas ?? []),
      ...(finalAnswerVisible ? [{ name: finalAnswerTool.name, description: finalAnswerTool.description, parameters: finalAnswerTool.parameters }] : []),
      ...(input.metaTools?.brief ? [{ name: briefTool.name, description: briefTool.description, parameters: briefTool.parameters }] : []),
      ...(input.metaTools?.pulse ? [{ name: pulseTool.name, description: pulseTool.description, parameters: pulseTool.parameters }] : []),
      ...(input.metaTools?.recall ? [{ name: recallTool.name, description: recallTool.description, parameters: recallTool.parameters }] : []),
      ...(input.metaTools?.find ? [{ name: findTool.name, description: findTool.description, parameters: findTool.parameters }] : []),
    ] as readonly ToolSchema[];

    // ── Context pressure hard gate ───────────────────────────────────────────
    // When token budget is 95%+ exhausted, the model has nothing useful to
    // reason with. Narrow available tools to only final-answer so the model's
    // next action is a clean exit rather than another fruitless iteration.
    const pressureCritical = shouldNarrowToFinalAnswerOnly({
      estimatedTokens: state.tokens,
      maxTokens: (input.contextProfile as any)?.maxTokens ?? Number.MAX_SAFE_INTEGER,
    });

    const effectiveSchemas: readonly ToolSchema[] = pressureCritical
      ? [{ name: finalAnswerTool.name, description: finalAnswerTool.description, parameters: finalAnswerTool.parameters }]
      : augmentedToolSchemas;

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
    const baseSystemPrompt = buildSystemPrompt(input.task, effectiveSystemPrompt, profile.tier);
    const adapter = selectAdapter({ supportsToolCalling: true }, profile.tier);
    const patchedBase = adapter.systemPromptPatch?.(baseSystemPrompt, profile.tier ?? "mid") ?? baseSystemPrompt;

    // toolGuidance hook — append inline required-tool reminder after schema block
    const toolGuidancePatch = adapter.toolGuidance?.({
      toolNames: effectiveSchemas.map((t) => t.name),
      requiredTools: input.requiredTools ?? [],
      tier: profile.tier ?? "mid",
    });

    // Always use full static context — stable system prompt, never overridden by ICS
    const staticContext = buildStaticContext({
      task: input.task,
      profile,
      availableToolSchemas: effectiveSchemas,
      requiredTools: input.requiredTools,
      environmentContext: input.environmentContext,
    });
    const systemPromptText = `${patchedBase}\n\n${staticContext}${toolGuidancePatch ? `\n${toolGuidancePatch}` : ""}`;

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

    // autoForwardSection is passed directly to buildConversationMessages

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
    // When the required-tools gate has blocked a tool, narrow the FC tools
    // parameter to only required (unsatisfied) + meta tools. This forces models
    // like cogito:14b (which lack tool_choice support) to select the right tool
    // instead of stubbornly re-selecting a previously successful one.
    const filteredToolSchemas = buildToolSchemas(state, input, profile, effectiveSchemas);
    const llmTools = filteredToolSchemas.map((ts) => ({
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
    // Prefer ICS briefs (set by kernel-runner after tool rounds); otherwise sliding window.
    const { messages: conversationMessages, updatedState: stateAfterMessages } =
      buildConversationMessages(state, input, profile, adapter, autoForwardSection);
    state = stateAfterMessages;

    const llmStreamEffect = llm.stream({
      messages: conversationMessages,
      systemPrompt: systemPromptText,
      maxTokens: state.maxOutputTokensOverride ?? outputMaxTokens,
      temperature: temp,
      ...(llmTools.length > 0 ? { tools: llmTools } : {}),
      ...(wantLogprobs ? { logprobs: true, topLogprobs: 5 } : {}),
    });

    const streamInit = yield* Effect.either(
      llmStreamEffect.pipe(
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
      ),
    );

    if (Either.isLeft(streamInit)) {
      return transitionState(state, {
        status: "failed" as const,
        error: streamInit.left.message,
        output: null,
        meta: {
          ...state.meta,
          terminatedBy: "llm_error",
        },
      });
    }

    const llmStream = streamInit.right;

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

    let streamConsumeError: string | undefined;
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
    ).pipe(
      Effect.catchAll((streamErr) => {
        streamConsumeError =
          streamErr && typeof streamErr === "object" && "message" in streamErr
            ? (streamErr as { message: string }).message
            : String(streamErr);
        return Effect.void;
      }),
    );

    if (streamConsumeError !== undefined) {
      return transitionState(state, {
        status: "failed" as const,
        error: `LLM stream failed at iteration ${state.iteration}: ${streamConsumeError}`,
        output: null,
        meta: {
          ...state.meta,
          terminatedBy: "llm_error",
        },
      });
    }

    // ── 0-token diagnostic ───────────────────────────────────────────────────
    // Surface silent empty responses from providers (e.g. Gemini, GPT-4o-mini)
    // before they silently produce success=false. The most likely cause is the
    // fast-path firing despite requiredTools being set, OR a provider returning
    // an empty stream with no error event.
    if (
      accumulatedUsage.totalTokens === 0 &&
      accumulatedContent.length === 0 &&
      accumulatedToolCalls.length === 0
    ) {
      const fastPathEligible = state.iteration === 0 && !((input.requiredTools?.length ?? 0) > 0);
      yield* Effect.log(
        `[think] WARNING: LLM returned 0 tokens at iteration ${state.iteration}. ` +
        `stopReason=${accumulatedStopReason}. ` +
        `hasRequiredTools=${(input.requiredTools?.length ?? 0) > 0} (${(input.requiredTools ?? []).join(",")}). ` +
        `fast-path-eligible=${fastPathEligible}. ` +
        `toolCallResolver=${!!(input as ReActKernelInput).toolCallResolver}. ` +
        `llmToolsCount=${llmTools.length}.`
      );
    }

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

    // ── max_output_tokens recovery ───────────────────────────────────────────
    // Stage 1: LLM hit its output token limit for the first time — escalate to
    //          64k tokens and re-run the same request (no message injection).
    // Stage 2: Override already set — inject a recovery user turn and continue.
    //          Maximum 3 Stage 2 attempts before failing.
    if (thoughtResponse.stopReason === "max_tokens") {
      const recoveryCount = state.maxOutputTokensRecoveryCount ?? 0;

      if (!state.maxOutputTokensOverride) {
        // Stage 1: escalate token limit, re-run same request (no iteration bump)
        return transitionState(state, {
          maxOutputTokensOverride: 64_000,
        });
      } else if (recoveryCount < 3) {
        // Stage 2: inject recovery message, continue conversation (no iteration bump)
        const recoveryMessage: KernelMessage = {
          role: "user",
          content: "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.",
        };
        return transitionState(state, {
          messages: [...state.messages, recoveryMessage],
          maxOutputTokensRecoveryCount: recoveryCount + 1,
        });
      } else {
        // Exhausted all recovery attempts — surface error
        return transitionState(state, {
          status: "failed",
          error: "max_output_tokens limit reached after recovery attempts",
        });
      }
    }

    // Clear recovery state after a successful (non-max_tokens) response so that
    // maxOutputTokensOverride does not persist and silently inflate billing for
    // all remaining iterations. Also reset the count so a later max_tokens event
    // in the same run re-enters Stage 1 cleanly.
    if (state.maxOutputTokensOverride !== undefined) {
      state = transitionState(state, {
        maxOutputTokensOverride: undefined,
        maxOutputTokensRecoveryCount: undefined,
      });
    }

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

    // Publish thought event with full prompt trace for logModelIO.
    // messages[] carries the complete FC conversation thread with role labels.
    // rawResponse is the unmodified LLM output before thought-stripping.
    const messagesForTrace = conversationMessages.map((m) => ({
      role: m.role as string,
      content: typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? (m.content as Record<string, unknown>[]).map((b) => (b as { text?: string }).text ?? "").join("")
          : String(m.content ?? ""),
    }));
    const userContent = messagesForTrace.map((m) => m.content).join("\n---\n");
    yield* hooks.onThought(state, thought, {
      system: systemPromptText,
      user: userContent,
      messages: messagesForTrace,
      rawResponse: rawThought,
    });

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
        effectiveSchemas.map((ts) => ({ name: ts.name })),
      );

      if (resolverResult._tag === "tool_calls") {
        const rawCalls = resolverResult.calls as readonly ToolCallSpec[];
        // Compute per-tool call counts from step history for budget enforcement.
        const toolCallCounts = state.steps.reduce<Record<string, number>>((acc, s) => {
          if (s.type === "action") {
            const name = (s.metadata?.toolCall as { name?: string } | undefined)?.name;
            if (name) acc[name] = (acc[name] ?? 0) + 1;
          }
          return acc;
        }, {});

        const { effective, blockedOptionalBatch } = gateNativeToolCallsForRequiredTools(
          rawCalls,
          input.requiredTools ?? [],
          state.toolsUsed,
          input.relevantTools,
          toolCallCounts,
          input.maxCallsPerTool,
        );

        if (blockedOptionalBatch) {
          const missing = (input.requiredTools ?? []).filter((t) => !state.toolsUsed.has(t));
          const nextRequired = missing[0] ?? "the missing required tool";
          const attemptedTools = rawCalls.map((tc) => tc.name);
          const writeHint =
            nextRequired.includes("write") || nextRequired.includes("file")
              ? ` Use the ${nextRequired} tool with a path from the task and the full report body as content (markdown).`
              : "";
          const blockMsg =
            `Required tools not yet satisfied: ${missing.join(", ")}. Your tool batch did not include any of them — do not use optional tools until these are done. Call ${nextRequired} now with concrete arguments.${writeHint}`;

          yield* hooks.onThought(state, `[GATE] Model tried: ${attemptedTools.join(", ")} — blocked, need: ${missing.join(", ")}`);

          const blockStep = makeStep("observation", blockMsg, {
            observationResult: makeObservationResult("system", false, blockMsg),
          });
          const blockMessages: readonly KernelMessage[] = [
            ...(state.messages as readonly KernelMessage[]),
            { role: "user", content: blockMsg },
          ];

          const prevBlocked = (state.meta.gateBlockedTools as readonly string[] | undefined) ?? [];
          const newBlocked = [...new Set([...prevBlocked, ...attemptedTools])];

          return transitionState(state, {
            steps: [...newSteps, blockStep],
            messages: blockMessages,
            tokens: newTokens,
            cost: newCost,
            status: "thinking",
            iteration: state.iteration + 1,
            meta: {
              ...state.meta,
              lastThought: thought,
              lastThinking: thinking,
              gateBlockedTools: newBlocked,
            },
          });
        }

        if (effective.length > 0) {
          // Store pending native tool calls in meta for handleActing
          return transitionState(state, {
            steps: newSteps,
            tokens: newTokens,
            cost: newCost,
            status: "acting",
            meta: {
              ...state.meta,
              pendingNativeToolCalls: effective,
              // Store thought + thinking for post-action FA check
              lastThought: thought,
              lastThinking: thinking,
            },
          });
        }
        // Resolver returned tool_calls but gated to zero (empty batch) — fall through
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

        // qualityCheck hook — for local models, do a lightweight self-eval
        // before accepting the final answer. Only fires once (iteration > 0 prevents loops).
        if (state.iteration > 0 && !state.meta.qualityCheckDone) {
          const qcMsg = adapter.qualityCheck?.({
            task: input.task,
            requiredTools: input.requiredTools ?? [],
            toolsUsed: state.toolsUsed,
            tier: profile.tier ?? "mid",
          });
          if (qcMsg) {
            const qcStep = makeStep("observation", qcMsg, {
              observationResult: makeObservationResult("system", true, qcMsg),
            });
            const qcMessages = [...(state.messages as readonly KernelMessage[]),
              { role: "user" as const, content: qcMsg }];
            return transitionState(state, {
              steps: [...newSteps, qcStep],
              messages: qcMessages,
              tokens: newTokens,
              cost: newCost,
              iteration: state.iteration + 1,
              // Prevent quality check from firing again next iteration
              meta: { ...state.meta, qualityCheckDone: true },
            });
          }
        }

        // All checks pass — assemble final output
        const hasFA = hasFinalAnswer(resolverResult.content);
        const cleanContentFA = hasFA
          ? extractFinalAnswer(resolverResult.content)
          : resolverResult.content;
        const terminatedBy = hasFA ? "final_answer" : "end_turn";

        const assembled = assembleOutput({
          steps: newSteps,
          finalAnswer: cleanContentFA,
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
        const thinkingContent = resolverResult.content.trim();
        const reqTools = input.requiredTools ?? [];
        const missingReq = reqTools.filter((t) => !state.toolsUsed.has(t));
        const allRequiredMet = reqTools.length > 0 && missingReq.length === 0;

        // ── Promote to done when all required tools are satisfied ─────────
        // The model has completed its tool work. If it returned thinking
        // (empty or non-empty), don't loop — assemble output from what we
        // have: the tool results are the deliverable, not the model's prose.
        if (allRequiredMet) {
          const hasRealToolWork = [...state.toolsUsed].some(
            (t) => !META_TOOL_SET.has(t),
          );
          if (hasRealToolWork) {
            // Use thinking content as output if available, otherwise
            // assemble a summary from tool results.
            const output = thinkingContent
              || state.priorThought
              || "Task completed — all required tools have been executed.";

            yield* hooks.onThought(state, `[ICS] All required tools met, promoting to done`);
            const assembled = assembleOutput({
              steps: newSteps,
              finalAnswer: output,
              terminatedBy: "llm_end_turn",
              entropyScores: (state.meta.entropy as any)?.entropyHistory,
            });
            return transitionState(state, {
              steps: newSteps,
              tokens: newTokens,
              cost: newCost,
              status: "done" as const,
              output: assembled.text,
              priorThought: output,
              iteration: state.iteration + 1,
              meta: {
                ...state.meta,
                terminatedBy: "end_turn",
              },
            });
          }
        }

        // ── Standard thinking handler (required tools still missing) ──────
        const consecutiveEmpty = !thinkingContent
          ? newSteps.reduceRight((count, s) => {
              if (count === -1) return -1;
              if (s.type === "observation" && s.content.startsWith("Continue working")) return count + 1;
              if (s.type === "thought" || s.type === "action") return -1;
              return count;
            }, 0)
          : 0;

        let thinkingSteps = [...newSteps];
        if (thinkingContent) {
          thinkingSteps = [...thinkingSteps, makeStep("thought", thinkingContent)];
        }

        let nudgeMessage: string | undefined;
        if (missingReq.length > 0) {
          const isStuck = consecutiveEmpty >= 2;
          const defaultNudge = isStuck
            ? `⚠️ ACTION REQUIRED: You have not made progress. You MUST call: ${missingReq.join(", ")} RIGHT NOW. Stop waiting and use the tool immediately.`
            : `Continue working on the task. You still need to call: ${missingReq.join(", ")}. Use the available tools to complete the task.`;

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

          // Layer 1: Novelty signal — strengthen nudge when recent observations add little new info.
          // If the model has gathered ≥3 real tool observations and the last one is <20% novel,
          // it has enough context. Override the nudge to be explicit about stopping research.
          const realObs = state.steps.filter(
            (s) => s.type === "observation" &&
              (s.metadata?.observationResult as { toolName?: string } | undefined)?.toolName !== "system",
          );
          if (realObs.length >= 3) {
            const lastObsText = realObs[realObs.length - 1].content;
            const priorObsText = realObs.slice(0, -1).map((s) => s.content).join(" ");
            const novelty = computeNoveltyRatio(lastObsText, priorObsText);
            if (novelty < 0.20) {
              const pct = Math.round(novelty * 100);
              nudgeMessage =
                `Research context is sufficient (last search: ${pct}% new information — diminishing returns). ` +
                `Do NOT search again. Call ${missingReq[0]} now to produce the output.`;
            }
          }

          thinkingSteps = [...thinkingSteps, makeStep("observation", nudgeMessage, {
            observationResult: makeObservationResult("system", true, nudgeMessage),
          })];
        }

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

    // ── NO-RESOLVER FALLBACK ────────────────────────────────────────────────
    // When executeReactive is called directly (without execution engine wiring),
    // toolCallResolver is absent but the LLM may still emit native FC events.
    // Forward them to act.ts via pendingNativeToolCalls so ToolService executes them.
    if (accumulatedToolCalls.length > 0) {
      const parsedCalls: ToolCallSpec[] = accumulatedToolCalls.map((tc, i) => {
        let parsedInput: unknown = {};
        try {
          parsedInput = tc.input ? JSON.parse(tc.input) : {};
        } catch {
          parsedInput = {};
        }
        return {
          id: tc.id ?? `tc-${state.iteration}-${i}`,
          name: tc.name,
          arguments: parsedInput as Record<string, unknown>,
        };
      });

      if (parsedCalls.length > 0) {
        return transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          cost: newCost,
          status: "acting",
          meta: {
            ...state.meta,
            pendingNativeToolCalls: parsedCalls,
            lastThought: thought,
            lastThinking: thinking,
          },
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
