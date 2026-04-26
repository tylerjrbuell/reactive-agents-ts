/**
 * Think phase — calls the LLM and understands what it decided to do.
 *
 * Extracted verbatim from react-kernel.ts. Handles:
 * - Dynamic final-answer tool injection
 * - Harness skill injection
 * - System prompt + context assembly (static + guidance sections)
 * - LLM stream consumption with text delta emission
 * - Native FC tool call parsing + required-tool gating
 * - Termination oracle evaluation
 * - Fast-path trivial task exit
 */
import { Effect, Stream, FiberRef, Either } from "effect";
import { ExecutionError } from "../../../errors/errors.js";
import { LLMService, selectAdapter } from "@reactive-agents/llm-provider";
import type { StopReason } from "@reactive-agents/llm-provider";
import {
  toProviderMessage,
  buildToolSchemas,
} from "../attend/context-utils.js";
import { defaultContextCurator } from "../../../context/context-curator.js";
import { StreamingTextCallback } from "@reactive-agents/core";
import {
  finalAnswerTool,
  shouldShowFinalAnswer,
  type ToolCallSpec,
  type ResolverInput,
} from "@reactive-agents/tools";
import {
  guardRequiredToolsBlock,
  guardPrematureFinalAnswer,
  guardCompletionGaps,
  guardQualityCheck,
  guardDiminishingReturns,
  guardEvidenceGrounding,
} from "./think-guards.js";

import type { ToolSchema } from "../attend/tool-formatting.js";
import {
  hasFinalAnswer,
  extractFinalAnswer,
  stripPreamble,
} from "../act/tool-parsing.js";
import {
  gateNativeToolCallsForRequiredTools,
} from "../act/tool-gating.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsFromSteps,
} from "../verify/requirement-state.js";
import { evaluateTermination, defaultEvaluators, type TerminationContext } from "../decide/arbitrator.js";
import { assembleOutput } from "../../../kernel/loop/output-assembly.js";
import { extractThinking, rescueFromThinking } from "../reason/stream-parser.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../act/tool-execution.js";
import {
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelMessage,
} from "../../../kernel/state/kernel-state.js";
import type { GuidanceContext } from "../../../context/context-manager.js";

import { META_TOOLS as META_TOOL_SET } from "../../../kernel/state/kernel-constants.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

/** Per-tier context pressure thresholds — local models get narrowed earlier. */
export const CONTEXT_PRESSURE_THRESHOLDS: Record<string, number> = {
  local: 0.80,
  mid: 0.85,
  large: 0.90,
  frontier: 0.95,
};

/** Returns true when token pressure is critical — only final-answer should be offered. */
export function shouldNarrowToFinalAnswerOnly(opts: {
  estimatedTokens: number
  maxTokens: number
  tier?: string
}): boolean {
  const threshold = CONTEXT_PRESSURE_THRESHOLDS[opts.tier ?? "mid"] ?? 0.85;
  return opts.estimatedTokens / opts.maxTokens >= threshold
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
    ] as readonly ToolSchema[];

    // ── Context pressure hard gate ───────────────────────────────────────────
    // When token budget is exhausted beyond the tier-specific threshold, the
    // model has nothing useful to reason with. Narrow available tools to only
    // final-answer so the model's next action is a clean exit.
    //
    // Important: never narrow while required tools are still pending — doing so
    // hides the very tools the harness is demanding, creating an unsatisfiable
    // state (model sees only `final-answer` but is told it must call `web-search`).
    const missingRequiredForPressure = getMissingRequiredToolsFromSteps(
      state.steps,
      input.requiredTools ?? [],
      input.requiredToolQuantities,
    );
    const pressureCritical =
      missingRequiredForPressure.length === 0 &&
      shouldNarrowToFinalAnswerOnly({
        estimatedTokens: state.tokens,
        maxTokens: input.contextProfile?.maxTokens ?? Number.MAX_SAFE_INTEGER,
        tier: profile.tier,
      });

    const effectiveSchemas: readonly ToolSchema[] = pressureCritical
      ? [{ name: finalAnswerTool.name, description: finalAnswerTool.description, parameters: finalAnswerTool.parameters }]
      : augmentedToolSchemas;

    // ── Classification-based tool pruning ────────────────────────────────────
    // When the classify phase identified required/relevant tools for this task,
    // prune the system prompt to only show those tools + meta tools.
    // This dramatically reduces attention load for local/mid models
    // (e.g. 38 GitHub MCP tools → 3 classified tools), preventing the model
    // from hallucinating tool names or losing track of the correct ones.
    //
    // Only prune when the full set is large (> 15). For small capability-only
    // tool sets the classifier output is incomplete and pruning hides valid tools.
    const PRUNE_MIN_TOOLS = 15;
    const classifiedRequired = input.requiredTools ?? [];
    const classifiedRelevant = input.relevantTools ?? [];
    const hasClassification = classifiedRequired.length > 0 || classifiedRelevant.length > 0;

    const promptSchemas: readonly ToolSchema[] =
      hasClassification && !pressureCritical && effectiveSchemas.length > PRUNE_MIN_TOOLS
        ? effectiveSchemas.filter((ts) =>
            classifiedRequired.includes(ts.name) ||
            classifiedRelevant.includes(ts.name) ||
            META_TOOL_SET.has(ts.name),
          )
        : effectiveSchemas;

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

    // ── Context assembly: ContextManager.build() is the sole path ────────────
    // All sections (identity + adapter patch, static context, tool guidance,
    // tool elaboration, progress, prior work, guidance) are rendered by
    // ContextManager. Think.ts supplies promptSchemas (classification-pruned)
    // and the effective system prompt body (harness-skill-wrapped when active).
    // profileOverrides were already merged into `profile` by kernel-runner;
    // here we only need the adapter.
    const { adapter } = selectAdapter({ supportsToolCalling: true }, profile.tier, input.modelId);

    // Read pending guidance signals, clear from state before LLM call.
    const pending = state.pendingGuidance;
    state = transitionState(state, { pendingGuidance: undefined });
    const guidance: GuidanceContext = {
      requiredToolsPending: pending?.requiredToolsPending ?? [],
      loopDetected: pending?.loopDetected ?? false,
      icsGuidance: pending?.icsGuidance,
      oracleGuidance: pending?.oracleGuidance,
      errorRecovery: pending?.errorRecovery,
      actReminder: pending?.actReminder,
      qualityGateHint: pending?.qualityGateHint,
      evidenceGap: pending?.evidenceGap,
    };

    // ── Native FC: convert tool schemas to LLM ToolDefinition format ──────
    // When the required-tools gate has blocked a tool, narrow the FC tools
    // parameter to only required (unsatisfied) + meta tools. This forces models
    // like cogito:14b (which lack tool_choice support) to select the right tool
    // instead of stubbornly re-selecting a previously successful one.
    // Uses promptSchemas (classification-pruned) so FC definitions match the
    // system prompt — the model can only call tools it can actually see.
    const filteredToolSchemas = buildToolSchemas(state, input, profile, promptSchemas);

    // ContextCurator (S2.5): sole authority for the per-iteration prompt.
    // - Slice A: port + default wrapper (byte-identical with ContextManager).
    // - Slice B: curator owns the trust-aware "Recent tool observations" section.
    // - Slice C: profile.recentObservationsLimit threads through here so agents
    //   can opt-in via profileOverrides without touching kernel internals.
    //   Defaults to 0 across all tiers → off by default, preserves prior shape.
    const {
      systemPrompt: systemPromptText,
      messages: conversationMessages,
    } = defaultContextCurator.curate(state, input, profile, guidance, adapter, {
      availableTools: promptSchemas,
      systemPromptBody: effectiveSystemPrompt,
      toolElaboration: input.toolElaboration,
      includeRecentObservations: profile.recentObservationsLimit ?? 0,
    });

    // ── TextParseDriver: inject format instructions into system prompt ────────
    // When the driver is in text-parse mode (local models that can't reliably emit
    // FC JSON), append the driver's format guide so the model knows how to express
    // tool calls as structured text. For native-fc mode, buildPromptInstructions
    // returns "" so this is a no-op.
    //
    // Skip when toolSchemaDetail is "names-only" or "names-and-types" — the profile
    // has already decided to suppress full descriptions; injecting them via driver
    // instructions would contradict the profile's intent and expose descriptions the
    // model shouldn't see.
    const canInjectDriverInstructions =
      profile.toolSchemaDetail !== "names-only" && profile.toolSchemaDetail !== "names-and-types";
    const driverInstructions = canInjectDriverInstructions
      ? context.toolCallingDriver.buildPromptInstructions(filteredToolSchemas)
      : "";
    const systemPromptWithDriver = driverInstructions
      ? `${systemPromptText}\n\n${driverInstructions}`
      : systemPromptText;

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
    const llmTools = filteredToolSchemas.map((ts) => ({
      name: ts.name,
      description: ts.description,
      inputSchema: {
        type: "object" as const,
        properties: Object.fromEntries(
          (ts.parameters ?? []).map((p) => [
            p.name,
            {
              type: p.type ?? "string",
              description: p.description,
              // Gemini requires `items` on every array-type parameter
              ...(p.type === "array" ? { items: p.items ?? { type: "string" } } : {}),
              ...(p.enum ? { enum: p.enum } : {}),
            },
          ]),
        ),
        required: (ts.parameters ?? [])
          .filter((p) => p.required)
          .map((p) => p.name),
      } as Record<string, unknown>,
    }));

    // Request logprobs when entropy sensor may be active (modelId present in meta)
    const wantLogprobs = state.meta.entropy?.modelId !== undefined;

    const llmStreamEffect = llm.stream({
      messages: conversationMessages,
      systemPrompt: systemPromptWithDriver,
      maxTokens: state.maxOutputTokensOverride ?? outputMaxTokens,
      temperature: temp,
      // TextParseDriver: pass empty tools array — constrained providers (Anthropic/OpenAI)
      // enforce FC when tools are present, which breaks text-parse mode for local models.
      ...(llmTools.length > 0 && context.toolCallingDriver.mode !== "text-parse" ? { tools: llmTools } : {}),
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
            yield* textDeltaCb(event.text).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reason/think.ts:342", tag: errorTag(err) })));
          }
        } else if (event.type === "content_complete") {
          accumulatedContent = event.content;
          // Extract stop reason from content_complete event if present
          if ("stopReason" in event && typeof (event as Record<string, unknown>).stopReason === "string") {
            accumulatedStopReason = (event as Record<string, unknown>).stopReason as string;
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
        } else if (event.type === "error") {
          streamConsumeError = event.error;
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
        `toolCallResolver=${!!input.toolCallResolver}. ` +
        `llmToolsCount=${llmTools.length}.`
      );
    }

    // Store logprobs in entropy meta for the entropy sensor
    if (accumulatedLogprobs.length > 0) {
      const entropyMeta = state.meta.entropy ?? {};
      state = transitionState(state, { meta: { ...state.meta, entropy: { ...entropyMeta, lastLogprobs: accumulatedLogprobs } } });
    }

    // Build response shape matching original llm.complete() return
    const thoughtResponse = {
      content: accumulatedContent,
      stopReason: accumulatedStopReason as StopReason,
      usage: accumulatedUsage,
      model: input.modelId ?? "unknown",
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
          content: "[Harness] Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.",
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
    const providerThinking = (thoughtResponse as Record<string, unknown>).thinking as string | undefined;
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
      system: systemPromptWithDriver,
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
    if (input.toolCallResolver) {
      const resolver = input.toolCallResolver;

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

      // Use resolveWithDialect to capture which tier fired (native-fc / fenced-json / pseudo-code / etc.)
      const resolverWithDialect = resolver.resolveWithDialect
        ? resolver.resolveWithDialect(
            resolverInput,
            effectiveSchemas.map((ts) => ({
              name: ts.name,
              paramNames: ts.parameters?.map((p) => p.name) ?? [],
            })),
          )
        : resolver.resolve(
            resolverInput,
            effectiveSchemas.map((ts) => ({
              name: ts.name,
              paramNames: ts.parameters?.map((p) => p.name) ?? [],
            })),
          ).pipe(Effect.map((result) => ({ result, dialect: "none" as const })));

      const { result: resolverResult, dialect: dialectObserved } = yield* resolverWithDialect;

      // Record dialect on state.meta for telemetry
      if (dialectObserved !== "none") {
        state = transitionState(state, {
          meta: { ...state.meta, lastDialectObserved: dialectObserved },
        });
      }

      if (resolverResult._tag === "tool_calls") {
        const rawCalls = resolverResult.calls as readonly ToolCallSpec[];
        // Compute per-tool call counts from step history for budget enforcement.
        const toolCallCounts = buildSuccessfulToolCallCounts(state.steps);

        const { effective, blockedOptionalBatch, quotaBudgetConflict } = gateNativeToolCallsForRequiredTools(
          rawCalls,
          input.requiredTools ?? [],
          state.toolsUsed,
          input.relevantTools,
          toolCallCounts,
          input.maxCallsPerTool,
          input.requiredToolQuantities,
          input.strictToolDependencyChain,
          input.nextMovesPlanning,
        );

        if (blockedOptionalBatch) {
          const redirect = guardRequiredToolsBlock(
            rawCalls,
            input,
            state,
            profile,
            hooks,
            newSteps,
            newTokens,
            newCost,
            thought,
            thinking,
          );
          if (redirect) return redirect;
          // Falls through if the guard decides no redirect is needed (should be unreachable
          // while blockedOptionalBatch is true — guard always returns a state in that case).
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
        // Genuine final answer (no tool calls). Run the guard chain — if any
        // guard fires, redirect the loop. Otherwise fall through to assembly.
        const redirect =
          guardPrematureFinalAnswer(input, state, profile, adapter, newSteps, newTokens, newCost) ??
          guardCompletionGaps(input, state, newSteps, newTokens, newCost) ??
          guardQualityCheck(input, state, profile, adapter, newSteps, newTokens, newCost) ??
          guardEvidenceGrounding(state, resolverResult.content, newSteps, newTokens, newCost);
        if (redirect) return redirect;

        // All checks pass — assemble final output
        const hasFA = hasFinalAnswer(resolverResult.content);
        const cleanContentFA = stripPreamble(
          hasFA
            ? extractFinalAnswer(resolverResult.content)
            : resolverResult.content,
        );
        const terminatedBy = hasFA ? "final_answer" : "end_turn";

        const assembled = assembleOutput({
          steps: newSteps,
          finalAnswer: cleanContentFA,
          terminatedBy: "llm_end_turn",
          entropyScores: state.meta.entropy?.entropyHistory,
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
        const missingReq = getMissingRequiredToolsFromSteps(
          state.steps,
          reqTools,
          input.requiredToolQuantities,
        );

        // ── Standard thinking handler ──────────────────────────────────────
        // Note: Even if all required tools are met, we continue the loop to
        // allow the model to call final-answer explicitly. The act phase will
        // accept final-answer once all required tools are satisfied.
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
          const quantities = input.requiredToolQuantities ?? {};
          const successCounts = buildSuccessfulToolCallCounts(state.steps);
          const missingWithProgress = missingReq.map((t) => {
            const needed = quantities[t];
            if (!needed || needed <= 1) return t;
            const actual = successCounts[t] ?? 0;
            return `${t} (${actual}/${needed} calls done)`;
          });
          const isStuck = consecutiveEmpty >= 2;
          const defaultNudge = isStuck
            ? `⚠️ ACTION REQUIRED: You have not made progress. You MUST call: ${missingWithProgress.join(", ")} RIGHT NOW. Stop waiting and use the tool immediately.`
            : `Continue working on the task. You still need to call: ${missingWithProgress.join(", ")}. Use the available tools to complete the task.`;

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
          // Extracted to think-guards.guardDiminishingReturns. When the guard fires it returns the
          // full thinking-branch redirect state; when it passes through (novelty high, <3 real obs,
          // or empty observations) we continue with the default/adapter nudge below.
          const diminishingRedirect = guardDiminishingReturns(
            state,
            input,
            profile,
            newTokens,
            newCost,
            {
              thinkingContent,
              thinkingSteps,
              missingReq,
              adapterOrDefaultNudge: nudgeMessage,
            },
          );
          if (diminishingRedirect) return diminishingRedirect;

          thinkingSteps = [...thinkingSteps, makeStep("observation", nudgeMessage, {
            observationResult: makeObservationResult("system", true, nudgeMessage),
          })];
        }

        // Route nudge through pendingGuidance instead of injecting a synthetic USER
        // message into the conversation thread. Rendered in the Guidance: section of
        // the next system prompt. Keeps the FC thread clean.
        return transitionState(state, {
          steps: thinkingSteps,
          tokens: newTokens,
          cost: newCost,
          iteration: state.iteration + 1,
          priorThought: thinkingContent || state.priorThought,
          pendingGuidance: nudgeMessage
            ? {
                requiredToolsPending: missingReq,
                errorRecovery: nudgeMessage,
              }
            : undefined,
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
        entropy: state.meta.entropy?.latestScore as TerminationContext["entropy"],
        trajectory: state.meta.entropy?.latestTrajectory as TerminationContext["trajectory"],
        controllerDecisions: state.meta.controllerDecisions as TerminationContext["controllerDecisions"],
        // CHANGE A: hand the run-wide controller history to the oracle so
        // controllerSignalVetoEvaluator can detect pathological tactical
        // activity that should override an apparent successful exit.
        controllerDecisionLog: state.controllerDecisionLog,
        toolsUsed: state.toolsUsed,
        requiredTools: (state.meta.requiredTools as string[]) ?? (input.requiredTools as string[]) ?? [],
        allToolSchemas: input.allToolSchemas ?? input.availableToolSchemas ?? [],
        redirectCount: priorRedirects,
        priorFinalAnswerAttempts: priorFAAttempts,
        taskDescription: input.task,
      };

      const decision = evaluateTermination(oracleCtx, defaultEvaluators);

      // CHANGE A: a "fail" verdict from the veto evaluator transitions to
      // status:"failed" — the kernel terminates and result.success becomes
      // false. The agent's textual output (if any) is discarded; the
      // veto reason becomes state.error.
      if (decision.shouldExit && decision.action === "fail") {
        return transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          cost: newCost,
          status: "failed" as const,
          error: decision.reason,
          output: null,
          priorThought: thought.trim(),
          iteration: state.iteration + 1,
          meta: {
            ...state.meta,
            terminatedBy: "controller_signal_veto",
            evaluator: decision.evaluator,
            allVerdicts: decision.allVerdicts,
          },
        });
      }

      if (decision.shouldExit && decision.output) {
        const assembled = assembleOutput({
          steps: state.steps,
          finalAnswer: decision.output,
          terminatedBy: decision.reason,
          entropyScores: state.meta.entropy?.entropyHistory,
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
