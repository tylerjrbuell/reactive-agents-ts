/**
 * W2e (plan 2.5) — head-truncation guard.
 *
 * Live-verified failure class: Ollama silently head-truncates the SYSTEM
 * PROMPT when the real prompt + output allocation exceed `num_ctx`. Every
 * budget gate stayed green while the agent ran lobotomized because (a) the
 * chars/4-family estimator undercounts dense content by ~35% against the
 * corrected (W2c, tokenizer-family) cost, and (b) the FC `tools:` array —
 * ~49% of an 8K local window before W2d — was never in ANY estimate.
 *
 * This module is the enforcement half: a deterministic PRE-REQUEST preflight
 * computing `corrected prompt tokens (system + history + schema term) +
 * output budget` against the model's num_ctx ceiling, and on overflow
 * shrinking the request in the plan's fixed ORDER:
 *
 *   1. TOOL SURFACE first, least-relevant-first. Protection = the run's
 *      `requiredTools` always, plus the classifier's `relevantTools` when it
 *      ran (2.6 may have skipped it — when rankings are absent the drop
 *      order is deterministic: registration order drops from the TAIL, i.e.
 *      the most-recently-registered non-required tool goes first, mirroring
 *      the caller convention that primary tools are listed first).
 *   2. HISTORY second — oldest messages first, always keeping the newest
 *      turn (existing compaction/windowing seams live in `assembly/`; this
 *      ladder is the last-resort wire-fit trim, not a replacement).
 *   3. NEVER the system-prompt head — that is the entire point. If the
 *      request still overflows after 1+2, the guard reports
 *      `stillOverflowing` (the harness-signal/ledger fact says so honestly)
 *      and ships anyway; truncation, if it comes, is Ollama's visible
 *      failure, not a silent identity wipe by construction.
 *
 * W2c reconciliation (binding, w2e-report §reconciliation): the shipped
 * llama-dense 1.25 factor ABSORBS the FC-template-wrap residual measured on
 * traffic whose estimate carried NO schema term. Feeding the schema term
 * through the same factor double-counts that residual — ~8-21% of the
 * schema term only (≤ ~4% of a whole prompt), in the OVER-FIRE direction:
 * the guard trims one schema more than strictly necessary. That is the
 * deliberate conservative headroom (ruling #1: conservative direction =
 * fire): an over-trim costs a tool the model would have survived; an
 * under-trim loses the system prompt. The factor is NOT re-tuned here;
 * a precise factor-vs-template split needs per-dialect control-token
 * measurements the Capability registry does not carry.
 *
 * Pure arithmetic — no LLM call, no I/O. `estimateTokenCount` is Effect.sync.
 */
import { Effect } from "effect";
import {
  estimateTokenCount,
  type LLMMessage,
  type TokenizerFamily,
} from "@reactive-agents/llm-provider";

/** The FC wire-array element shape as built by think.ts `llmTools`. */
export interface WireToolPayload {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface HeadTruncationGuardInput<T extends WireToolPayload = WireToolPayload> {
  readonly systemPrompt: string;
  readonly messages: readonly LLMMessage[];
  readonly wireTools: readonly T[];
  /** The gateway's resolved output allocation for this call (reserve). */
  readonly outputBudget: number;
  /** The model's context ceiling (profile.maxTokens — bound to
   * recommendedNumCtx by resolveProfileWithWindow). */
  readonly numCtx: number;
  readonly tokenizerFamily?: TokenizerFamily;
  readonly requiredTools: readonly string[];
  /** The classifier's relevant set when classification RAN; empty otherwise
   * (2.6 skip ⇒ absent rankings ⇒ documented tail-of-registration drop order). */
  readonly relevantTools: readonly string[];
}

export interface HeadTruncationGuardResult<T extends WireToolPayload = WireToolPayload> {
  /** True when the pre-flight measurement overflowed and a shrink ran. */
  readonly fired: boolean;
  readonly messages: readonly LLMMessage[];
  /** SAME element type as the input array (generic) — the seam hands the
   * result straight back into the provider request without any cast. */
  readonly wireTools: readonly T[];
  readonly droppedToolNames: readonly string[];
  readonly droppedMessageCount: number;
  readonly correctedTokensBefore: number;
  readonly correctedTokensAfter: number;
  /** True when even schemas+history exhausted could not reach the ceiling —
   * the harness-signal says so; the head is STILL never the sacrifice. */
  readonly stillOverflowing: boolean;
}

/**
 * Corrected wire cost of a (system, history, schema) triple:
 * prompt term + schema term, both through the W2c tokenizer-corrected
 * estimator. The schema term rides the estimator as its own dense-JSON
 * message — this is "feeding the schema term in" (the term no estimate ever
 * carried before 2.5). Exported so tests assert against the SAME arithmetic
 * the guard runs (one definition, no drift).
 */
export function estimateWireTokens(
  systemPrompt: string,
  messages: readonly LLMMessage[],
  wireTools: readonly WireToolPayload[],
  tokenizerFamily?: TokenizerFamily,
): Effect.Effect<number, never> {
  return Effect.gen(function* () {
    const promptTerm = yield* estimateTokenCount(
      [{ role: "system" as const, content: systemPrompt }, ...messages],
      tokenizerFamily,
    );
    const schemaTerm =
      wireTools.length === 0
        ? 0
        : yield* estimateTokenCount(
            [{ role: "user" as const, content: JSON.stringify(wireTools) }],
            tokenizerFamily,
          );
    return promptTerm + schemaTerm;
  });
}

/**
 * Deterministic pre-request preflight + shrink ladder (module docblock owns
 * the semantics). Identity-preserving on fit: when the corrected total
 * already fits, the SAME array references come back and `fired` is false —
 * every non-overflow request is byte-identical to the pre-guard path.
 */
export function preflightHeadTruncation<T extends WireToolPayload>(
  input: HeadTruncationGuardInput<T>,
): Effect.Effect<HeadTruncationGuardResult<T>, never> {
  return Effect.gen(function* () {
    const capacity = input.numCtx - input.outputBudget;
    const before = yield* estimateWireTokens(
      input.systemPrompt,
      input.messages,
      input.wireTools,
      input.tokenizerFamily,
    );

    if (before <= capacity) {
      return {
        fired: false,
        messages: input.messages,
        wireTools: input.wireTools,
        droppedToolNames: [],
        droppedMessageCount: 0,
        correctedTokensBefore: before,
        correctedTokensAfter: before,
        stillOverflowing: false,
      };
    }

    // ── Ladder 1: tool surface, least-relevant-first ─────────────────────
    const protectedNames = new Set<string>([
      ...input.requiredTools,
      // When the classifier ran, its relevant set joins the protection —
      // ranked-relevant tools are exactly the ones the surface kept FOR.
      ...(input.relevantTools.length > 0 ? input.relevantTools : []),
    ]);
    // Drop queue: non-protected tools, tail-of-registration first (documented
    // deterministic order for the classifier-absent case). LAZY copy so the
    // untouched array reference survives until the first actual drop.
    let tools: readonly T[] = input.wireTools;
    const dropped: string[] = [];
    let current = before;

    const candidates = tools.filter((t) => !protectedNames.has(t.name));
    for (const candidate of candidates.slice().reverse()) {
      if (current <= capacity) break;
      tools = tools.filter((t) => t.name !== candidate.name);
      dropped.push(candidate.name);
      current = yield* estimateWireTokens(
        input.systemPrompt,
        input.messages,
        tools,
        input.tokenizerFamily,
      );
    }

    // ── Ladder 2: history, oldest-first, newest turn always kept ─────────
    // LAZY copy: identity of the untouched arrays is preserved until a drop
    // actually happens (fit paths return the input references verbatim).
    let messages: readonly LLMMessage[] = input.messages;
    let droppedMessages = 0;
    while (current > capacity && messages.length > 1) {
      messages = messages.slice(1);
      droppedMessages++;
      current = yield* estimateWireTokens(
        input.systemPrompt,
        messages,
        tools,
        input.tokenizerFamily,
      );
    }

    return {
      fired: true,
      messages,
      wireTools: tools,
      droppedToolNames: dropped,
      droppedMessageCount: droppedMessages,
      correctedTokensBefore: before,
      correctedTokensAfter: current,
      stillOverflowing: current > capacity,
    };
  });
}
