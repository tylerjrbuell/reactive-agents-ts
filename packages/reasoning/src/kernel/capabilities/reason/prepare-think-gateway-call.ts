/**
 * Think phase — gateway-call preflight stage.
 *
 * `handleThinking`'s third stage, moved verbatim from `think.ts` (#219 /
 * HS-249 decomposition). Covers the W2e head-truncation guard preflight,
 * D-2026-07-30-I demand-driven num_ctx (with its monotone high-water meta
 * write), and the assembled `gatewayStream` call construction (logprobs,
 * budget intent, text-parse tools omission). The LLM service instance and
 * the think temperature are acquired here — the two prologue locals that
 * this stage actually consumes.
 */
import { Effect } from "effect";
import { LLMService, resolveCapability } from "@reactive-agents/llm-provider";
import { gatewayStream, type LlmCallIntent } from "../../llm-gateway.js";
import { downshiftBudgetBand } from "../../assessment/pace-actions.js";
import { nextNumCtx } from "../../../assembly/capability.js";
import { resolveEffectiveNumCtx } from "../../../context/context-profile.js";
import { estimateWireTokens, guardOutputReserve, preflightHeadTruncation } from "./head-truncation-guard.js";
import { makeStep } from "../sense/step-utils.js";
import { transitionState, type KernelState, type KernelContext } from "../../../kernel/state/kernel-state.js";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import { resolveHarnessConfig } from "../../../harness-config.js";
import { shouldNarrowToFinalAnswerOnly } from "./context-pressure.js";
import type { LLMMessage } from "@reactive-agents/llm-provider";

/** Locals {@link prepareThinkGatewayCall} needs from the request core. */
export interface PrepareThinkGatewayCallParams {
  readonly state: KernelState
  readonly context: KernelContext
  readonly h: ReturnType<typeof resolveHarnessConfig>
  readonly llmTools: { readonly name: string; readonly description: string; readonly inputSchema: Record<string, unknown> }[]
  readonly systemPromptWithDriver: string
  readonly messagesForRequest: LLMMessage[]
}

/**
 * Preflight the gateway call (head-truncation ladder, demand num_ctx) and
 * return the mutated state plus the unexecuted stream effect. No I/O.
 */
export function prepareThinkGatewayCall(params: PrepareThinkGatewayCallParams) {
  return Effect.gen(function* () {
    let { state } = params;
    const { input, profile } = params.context;
    const { context, h, llmTools, systemPromptWithDriver, messagesForRequest } = params;
    const llm = yield* LLMService;
    const temp = params.context.input.temperature ?? params.context.profile.temperature ?? 0.7;

    // Request logprobs when entropy sensor may be active (modelId present in meta)
    const wantLogprobs = state.meta.entropy?.modelId !== undefined;

    // Budget resolution moved to the LLM gateway (Phase 1): tier-adaptive
    // think budget + B2 thinking allowance live in resolveOutputBudget; a
    // kernel pressure override (state.maxOutputTokensOverride) rides the
    // explicit budgetTokens escape hatch.
    //
    // E3 economize actuator: under the long-horizon profile, a non-`green` pace
    // band downshifts this NON-synthesis think budget at the gateway (cap at
    // `standard`). OFF, or a `green` band → `paceBand` undefined → the gateway
    // resolves the budget byte-identically to today.
    const economizeBand = downshiftBudgetBand(
      state.meta.horizonProfile === "long",
      state.meta.assessment,
    );

    // ── W2e head-truncation guard (plan 2.5) ────────────────────────────────
    // Deterministic pre-request preflight: corrected prompt tokens (system +
    // history + the schema term — fed for the first time here) + the gateway's
    // own output budget, against the model's num_ctx ceiling. On overflow the
    // ladder shrinks TOOL SURFACE first (required + classifier-relevant
    // protected), then HISTORY oldest-first. The system-prompt HEAD is never
    // the sacrifice: Ollama head-truncates silently when the real prompt
    // overflows (the chars/4 undercount + never-estimated tools array made
    // every gate read green while the agent ran without its identity). Fires
    // only when a window ceiling is resolvable (profile.maxTokens, bound to
    // recommendedNumCtx by resolveProfileWithWindow/applyCapabilityMaxTokens);
    // identity-preserving no-op on fit. Pure arithmetic — no LLM call.
    const thinkIntent: LlmCallIntent = {
      purpose: "think",
      tier: profile.tier,
      thinkingModel: profile.thinkingModel === true,
      ...(economizeBand ? { paceBand: economizeBand } : {}),
      ...(state.maxOutputTokensOverride !== undefined
        ? { budgetTokens: state.maxOutputTokensOverride }
        : {}),
    };
    // Schema term reflects ONLY what actually ships: text-parse mode sends no
    // `tools:` param at all, so charging it would over-fire on a phantom cost.
    const shippedWireTools =
      context.toolCallingDriver.mode !== "text-parse" ? llmTools : [];
    // Fires ONLY on the provider whose wire actually enforces num_ctx by
    // head-truncating (Ollama/local.ts resolveOllamaNumCtx): cloud providers
    // take no numCtx param and reject/handle long prompts server-side, and
    // nominal capability rows (fallback 2048 for unrecognized/test models)
    // would otherwise starve surfaces that never needed the window. Same
    // provider-scoping rationale as the demand-num_ctx policy below
    // (D-2026-07-30-I: `tier: "local"` is the generic fallback and the test
    // stub's row — tier alone would misfire here too).
    // One tokenizer-family resolution shared by the guard bill AND the
    // demand-num_ctx sizing (W2e review #2: both must see the SAME
    // schema-inclusive, family-corrected arithmetic — no drift).
    const wireTokenizerFamily = resolveCapability(
      input.providerName ?? "",
      input.modelId ?? "",
    ).tokenizerFamily;
    // W2e review #3: provider-default budget (resolveOutputBudget → undefined,
    // maxTokens omitted = output bounded only by the window) reserves the
    // documented thinking-safe minimum via the guard module, never 0.
    // GH #241: the ceiling is the EFFECTIVE window (explicit `.withModel`
    // override wins over the capability recommendation, mirroring the
    // Ollama wire precedence) — never bare `profile.maxTokens`.
    const guardNumCtx =
      input.providerName === "ollama" ? resolveEffectiveNumCtx(profile) : undefined;
    const guardWire =
      guardNumCtx !== undefined
        ? yield* preflightHeadTruncation({
            systemPrompt: systemPromptWithDriver,
            messages: messagesForRequest,
            wireTools: shippedWireTools,
            // The reserve is the gateway's OWN arithmetic for this exact
            // intent — one definition of the budget, no drift between the
            // guard and what gatewayStream will allocate.
            outputBudget: guardOutputReserve(thinkIntent),
            numCtx: guardNumCtx,
            tokenizerFamily: wireTokenizerFamily,
            requiredTools: input.requiredTools ?? [],
            relevantTools: input.relevantTools ?? [],
          })
        : null;
    const wireMessages = guardWire?.messages ?? messagesForRequest;
    const wireTools = guardWire?.wireTools ?? shippedWireTools;
    if (guardWire !== null && guardWire.fired) {
      const guardMessage =
        `⚠️ head-truncation-guard: corrected prompt (${guardWire.correctedTokensBefore} tok) ` +
        `+ output budget exceeded num_ctx ${guardNumCtx}; shrank tool surface ` +
        `(dropped ${guardWire.droppedToolNames.length > 0 ? guardWire.droppedToolNames.join(", ") : "none"})` +
        ` then history (${guardWire.droppedMessageCount} oldest message(s)) to ` +
        `${guardWire.correctedTokensAfter} tok. System prompt head untouched` +
        `${guardWire.stillOverflowing ? " — STILL OVERFLOWS after both ladders; provider-side truncation risk remains" : ""}.`;
      // The step is the LEDGER fact: step-projection maps harness_signal
      // steps to the existing `harness-signal` kind through growRunLedger
      // at the pass boundary (no new kinds — wire-or-delete honored by reuse).
      state = transitionState(state, {
        steps: [...state.steps, makeStep("harness_signal", guardMessage)],
      });
      yield* emitHarnessSignalInjected({
        taskId: state.taskId,
        iteration: state.iteration,
        signalKind: "other",
        origin: "head-truncation-guard",
        content: guardMessage,
        metadata: {
          correctedTokensBefore: guardWire.correctedTokensBefore,
          correctedTokensAfter: guardWire.correctedTokensAfter,
          numCtx: guardNumCtx,
          droppedToolNames: guardWire.droppedToolNames,
          droppedMessageCount: guardWire.droppedMessageCount,
          stillOverflowing: guardWire.stillOverflowing,
        },
      });
    }

    // D-2026-07-30-I: demand-driven num_ctx (opt-in). Only the local Ollama
    // provider reads request.numCtx (local.ts resolveOllamaNumCtx — request
    // wins over capability/config defaults), so this is a no-op elsewhere.
    // Gated on `providerName === "ollama"`, NOT `profile.tier === "local"` —
    // verified `tier: "local"` is also the generic capability FALLBACK for any
    // unrecognized provider (capability.ts fallbackCapability) and the "test"
    // stub's static entry, so tier alone would misfire on non-Ollama request
    // paths. Output budget 2000 matches from-kernel-state.ts's resolveCapability
    // call. Monotone within a run (never shrinks — Ollama reloads the model on
    // any num_ctx change): grows from state.meta.numCtxHighWater, capped at
    // the EFFECTIVE ceiling (GH #241: explicit override wins — a demand
    // bucket above the explicit window would ride request.numCtx past what
    // Ollama was told to enforce).
    const demandNumCtx =
      h.numCtxPolicy === "demand" && input.providerName === "ollama"
        ? nextNumCtx(
            // W2e review #2 (demand-policy leak): size from the guard's OWN
            // schema-inclusive, family-corrected arithmetic — a bucket that
            // ignored the FC tools array under-provisioned num_ctx while the
            // guard (capped at the same ceiling) read green.
            yield* estimateWireTokens(
              systemPromptWithDriver,
              wireMessages,
              wireTools,
              wireTokenizerFamily,
            ),
            2000,
            state.meta.numCtxHighWater,
            resolveEffectiveNumCtx(profile),
          )
        : undefined;
    if (demandNumCtx !== undefined) {
      state = transitionState(state, {
        meta: { ...state.meta, numCtxHighWater: demandNumCtx },
      });
    }

    const llmStreamEffect = gatewayStream(llm, thinkIntent, {
      messages: wireMessages,
      ...(input.modelId ? { model: input.modelId } : {}),
      systemPrompt: systemPromptWithDriver,
      temperature: temp,
      // Snapshot run correlation into the request so the observable-LLM wrapper
      // (below the kernel) can key the LLMExchange trace to the real run instead
      // of the 'llm-direct'/0 placeholder. Build-time snapshot, FiberRef-free.
      traceContext: { taskId: state.taskId, iteration: state.iteration },
      ...(demandNumCtx !== undefined ? { numCtx: demandNumCtx } : {}),
      // TextParseDriver: pass empty tools array — constrained providers (Anthropic/OpenAI)
      // enforce FC when tools are present, which breaks text-parse mode for local models.
      // W2e: `wireTools` is the head-truncation-guard output (== llmTools when the
      // request fits — identity-preserving).
      ...(wireTools.length > 0 && context.toolCallingDriver.mode !== "text-parse" ? { tools: wireTools } : {}),
      ...(wantLogprobs ? { logprobs: true, topLogprobs: 5 } : {}),
    });

    // Payload seam — the prepared stream effect for consumeThinkStream.
    return {
      state,
      llmStreamEffect,
    };
  });
}
