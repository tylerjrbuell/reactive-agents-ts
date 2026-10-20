/**
 * Think phase — response normalization stage.
 *
 * `handleThinking`'s post-stream normalization, moved verbatim from
 * `think.ts` (#219 / HS-249 decomposition): native-FC name de-sanitization,
 * the 0-token diagnostic, entropy logprob capture, the `thoughtResponse`
 * shape, max_output_tokens recovery (Stage 1/2/exhausted), token
 * bookkeeping, thinking extraction + rescue, the single-parse rationale
 * invariant, HS-128 usage window, the W-Q tool-surface intervention stamp,
 * the thought step + fabricated-observation strip, assumption surfacing,
 * and the logModelIO thought event. Early exits (max_tokens recovery
 * paths) return `_tag: "handled"` with the final state; otherwise the
 * normalized thought bundle rides to the dispatch/oracle stages.
 */
import { Effect } from "effect";
import { parseRationaleBlocks, stripRationaleBlocks } from "@reactive-agents/tools";
import type { LLMMessage, StopReason } from "@reactive-agents/llm-provider";
import { sanitizeToolName, buildSanitizedReverseMap } from "../attend/context-utils.js";
import { extractThinking, isTruncatingStopReason, rescueFromThinking } from "../../utils/stream-parser.js";
import { makeStep } from "../sense/step-utils.js";
import { resolveToolSurface } from "./tool-surface.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import type { KernelState, KernelContext, KernelMessage } from "../../../kernel/state/kernel-state.js";
import { transitionState } from "../../../kernel/state/kernel-state.js";
import { authorityOf } from "../decide/authority.js";
import { surfaceAssumptions } from "./assumption-surfacing.js";

/** Locals the normalization stage reads from the request + stream stages. */
export interface NormalizeThinkResponseParams {
  readonly state: KernelState
  readonly context: KernelContext
  readonly toolSurface: ReturnType<typeof resolveToolSurface>
  readonly gatedToolSchemas: readonly ToolSchema[]
  readonly llmTools: { readonly name: string; readonly description: string; readonly inputSchema: Record<string, unknown> }[]
  readonly systemPromptWithDriver: string
  readonly conversationMessages: LLMMessage[]
  readonly missingRequiredForPressure: readonly string[]
  readonly surfaceDeniedTool: boolean
  readonly surfaceGateNarrowed: boolean
  readonly deniedToolNames: readonly string[]
  readonly accumulatedContent: string
  readonly accumulatedThinking: string
  readonly accumulatedUsage: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number; readonly estimatedCost: number }
  readonly accumulatedLogprobs: readonly { readonly token: string; readonly logprob: number; readonly topLogprobs?: readonly { readonly token: string; readonly logprob: number }[] }[]
  readonly accumulatedToolCalls: { id: string; name: string; input: string }[]
  readonly accumulatedStopReason: string
}

/**
 * Normalize the consumed stream into the thought bundle. `_tag: "handled"`
 * arms (max_output_tokens recovery Stage 1/2/exhausted) carry the final
 * `KernelState` — identical transitions to the original inline returns.
 */
export function normalizeThinkResponse(params: NormalizeThinkResponseParams) {
  return Effect.gen(function* () {
    const {
      context,
      toolSurface,
      gatedToolSchemas,
      llmTools,
      systemPromptWithDriver,
      conversationMessages,
      missingRequiredForPressure,
      surfaceDeniedTool,
      surfaceGateNarrowed,
      deniedToolNames,
      accumulatedContent,
      accumulatedThinking,
      accumulatedUsage,
      accumulatedLogprobs,
      accumulatedToolCalls,
      accumulatedStopReason,
    } = params;
    let { state } = params;
    const { input, hooks } = context;
    // ── Native-FC name de-sanitization ───────────────────────────────────────
    // Outbound, tool schemas were sanitized to satisfy the provider regex
    // (e.g. MCP `github/list_commits` → `github_list_commits`). Map the returned
    // tool-call names BACK to the canonical registered names BEFORE either
    // consumer (the toolCallResolver path and the no-resolver native-FC
    // fallback) so registry lookup/execution is unchanged. The reverse map is
    // built from the EXACT schemas offered this turn. accumulatedToolCalls is a
    // mutable list of objects, so in-place name reassignment is safe.
    const { map: canonicalBySanitized, collisions } = buildSanitizedReverseMap(
      gatedToolSchemas.map((ts) => ts.name),
    );
    if (collisions.length > 0) {
      yield* Effect.logWarning(
        `[think] tool-name sanitization collision — inbound de-sanitization may ` +
        `dispatch the wrong tool: ${collisions
          .map(([a, b]) => `"${a}" ~ "${b}" → "${sanitizeToolName(a)}"`)
          .join("; ")}. Rename the tools to disambiguate.`,
      );
    }
    for (const tc of accumulatedToolCalls) {
      const canon = canonicalBySanitized.get(tc.name);
      if (canon !== undefined) tc.name = canon;
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
      state = transitionState(state, { meta: { ...state.meta, entropy: { ...entropyMeta, lastLogprobs: accumulatedLogprobs, providerName: input.providerName } } });
    }

    // Build response shape matching original llm.complete() return
    const thoughtResponse = {
      content: accumulatedContent,
      stopReason: accumulatedStopReason as StopReason,
      usage: accumulatedUsage,
      model: input.modelId ?? "unknown",
      // W1.3 — mirror CompletionResponse.thinking (llm-provider types.ts): the
      // provider's internal reasoning, when the model produced any. Set ONLY
      // when non-empty so the no-thinking object shape is byte-identical to
      // HEAD (arm-2 regression pin). Consumed below by the pre-existing
      // providerThinking → rescueFromThinking → lastThinking machinery.
      ...(accumulatedThinking.length > 0 ? { thinking: accumulatedThinking } : {}),
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
        return { _tag: "handled" as const, state: transitionState(state, {
          maxOutputTokensOverride: 64_000,
        }) };
      } else if (recoveryCount < 3) {
        // Stage 2: inject recovery message, continue conversation (no iteration bump)
        const recoveryMessage: KernelMessage = {
          role: "user",
          content: "[Harness] Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.",
        };
        return { _tag: "handled" as const, state: transitionState(state, {
          messages: [...state.messages, recoveryMessage],
          maxOutputTokensRecoveryCount: recoveryCount + 1,
        }) };
      } else {
        // Exhausted all recovery attempts — surface error
        return { _tag: "handled" as const, state: transitionState(state, {
          status: "failed",
          error: "max_output_tokens limit reached after recovery attempts",
        }) };
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
    const newInputTokens = state.inputTokens + (thoughtResponse.usage.inputTokens ?? 0);
    const newOutputTokens = state.outputTokens + (thoughtResponse.usage.outputTokens ?? 0);
    const newCost = state.cost + thoughtResponse.usage.estimatedCost;

    // HS-128 — Per-iteration token snapshot for the verbosity detector.
    // Append `usage.totalTokens` (NOT the running total) to a rolling window
    // capped at 5 entries on state.meta.lastIterationTokens. Guarded by a
    // truthy check: undefined `usage` (test providers that don't emit usage)
    // AND zero-token usage both skip the append so the window only contains
    // real-LLM measurements. Downstream transitionState calls in this turn
    // pick up the updated meta via their `...state.meta` spreads.
    // See kernel/capabilities/reflect/verbosity-detector.ts.
    if (thoughtResponse.usage?.totalTokens) {
      const priorWindow = state.meta.lastIterationTokens ?? [];
      const nextWindow = [...priorWindow, thoughtResponse.usage.totalTokens].slice(-5);
      // ContextPressure is now emitted from the observable-llm chokepoint, so the
      // lastContextTokens/lastContextWindow meta is no longer computed here — only
      // the rolling lastIterationTokens window (consumed by verbosity-detector).
      state = transitionState(state, {
        meta: { ...state.meta, lastIterationTokens: nextWindow },
      });
    }

    // Strip <think>...</think> blocks before parsing
    const { thinking: extractedThinking, content: cleanContent } = extractThinking(rawThought);
    const providerThinking = thoughtResponse.thinking;
    const thinking = extractedThinking || providerThinking || null;
    let thought = cleanContent || providerThinking || rawThought;
    // Thinking models (e.g. cogito) may put the full answer in the thinking field
    // with only a tiny fragment in content. When content is deficient, extract
    // structured value (final answer, code, tool calls) from thinking.
    // W1.5-defect gate: the UNLABELED-PROSE fallback inside rescueFromThinking
    // may only overwrite a non-empty visible answer when generation was CUT
    // before the model finished. Computed deterministically from the exchange
    // stop reason (Golden Rule 5 — the provider reported it; no LLM judgment).
    // Natural-stop exchanges (end_turn) keep their terse visible answer — the
    // post-w1 S2 capture (909a1b98) proved the un-gated guard shipped a
    // reasoning tail over the correct '3052' on 5/5 terse-answer runs.
    if (thought.trim().length < 50 && thinking && thinking.length > 100) {
      const rescued = rescueFromThinking(thinking, thought.trim(), {
        exchangeTruncated: isTruncatingStopReason(thoughtResponse.stopReason),
      });
      if (rescued) thought = rescued;
    }

    // HS-cleanup-1 root fix: parse rationale blocks ONCE from the raw text,
    // then strip the wrapper XML from the thought before storing. Native-FC
    // attachment (lines below) reuses these pre-parsed blocks via the
    // `prerasedRationaleBlocks` snapshot — see act/text-parse branches.
    //
    // Invariant: framework markup (`<rationale call="N">{...}</rationale>`)
    // never enters `state.steps[].content`, so it cannot re-enter the model
    // context next iteration nor surface as user-facing output.
    const preparsedRationaleBlocks = parseRationaleBlocks(
      `${thought ?? ""}\n${thinking ?? ""}`,
    );
    thought = stripRationaleBlocks(thought);

    // W-Q tool-surface intervention — stamp the highest-authority not-yet-seen
    // hard narrowing onto this thought step (dedup: once per run per actor).
    // Only ONE intervention rides a step; deny (constant) takes priority over
    // the transient gate-narrow, which then lands on a later iteration's step.
    const priorSurfaceActors = new Set(
      state.steps
        .map((s) => s.metadata?.intervention?.actor)
        .filter((a): a is string => a !== undefined),
    );
    const surfaceIntervention =
      surfaceDeniedTool && !priorSurfaceActors.has("tool-surface:forbidden-deny")
        ? {
            actor: "tool-surface:forbidden-deny",
            authorityClass: authorityOf("tool-surface:forbidden-deny"),
            evidence: `contract deny-list removed: ${deniedToolNames.join(", ")}`,
            whatChanged: "tool-surface: forbidden-by-contract tool(s) hidden from the surface",
            iter: state.iteration,
          }
        : surfaceGateNarrowed && !priorSurfaceActors.has("tool-surface:gate-narrow")
          ? {
              actor: "tool-surface:gate-narrow",
              authorityClass: authorityOf("tool-surface:gate-narrow"),
              evidence: `required-tools gate narrowed FC surface (${toolSurface.visible.length}→${toolSurface.callable.length}); pending: ${missingRequiredForPressure.join(", ")}`,
              whatChanged: "tool-surface: gate narrowed callable tools while required tools pending",
              iter: state.iteration,
            }
          : undefined;
    const thoughtMeta =
      thinking || surfaceIntervention !== undefined
        ? {
            ...(thinking ? { thinking } : {}),
            ...(surfaceIntervention !== undefined ? { intervention: surfaceIntervention } : {}),
          }
        : undefined;
    const thoughtStep = makeStep("thought", thought, thoughtMeta);
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

    // ── v0.11.x: surface model-stated assumptions as AssumptionRecordedEvents.
    // Best-effort; failure is swallowed inside the emitter so think never breaks.
    yield* surfaceAssumptions({
      thought,
      thinking,
      taskId: state.taskId,
      iteration: state.iteration,
    });

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

    // Payload seam — the normalized response bundle for dispatch/oracle.
    return {
      _tag: "continue" as const,
      state,
      thought,
      thinking,
      thoughtResponse,
      newSteps,
      newTokens,
      newInputTokens,
      newOutputTokens,
      newCost,
      preparsedRationaleBlocks,
    };
  });
}
