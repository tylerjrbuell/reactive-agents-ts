/**
 * Context Builder — builds conversation messages, tool schemas, and base system
 * prompt for each LLM turn.
 *
 * Pure data transformation: no LLM calls, no Effect services.
 * Fully unit-testable in isolation.
 *
 * Note: the full system prompt (with guidance, ICS, progress sections) is
 * assembled by think.ts using buildStaticContext + buildGuidanceSection.
 */
import type { LLMMessage, ProviderAdapter } from "@reactive-agents/llm-provider";
import type { ContextProfile } from "../../../context/context-profile.js";
import { applyMessageWindowWithCompact } from "../../../context/message-window.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { applyAgeAwareCuration, curationAgeAware } from "../attend/tool-formatting.js";
import type { KernelState, KernelMessage, KernelInput } from "../../../kernel/state/kernel-state.js";
import { getMissingRequiredToolsFromSteps } from "../verify/requirement-state.js";
import { META_TOOLS as META_TOOL_NAMES } from "../../../kernel/state/kernel-constants.js";

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

/**
 * Build the system prompt text.
 * Tier-adaptive: frontier/large models get detailed reasoning guidance;
 * mid models get standard guidance; local models get minimal prompt.
 */
export function buildSystemPrompt(
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
  const PARALLEL_HINT = " When a task requires multiple independent lookups or actions, issue all tool calls in the same response — they execute in parallel.";

  if (t === "frontier" || t === "large") {
    return `You are an expert reasoning agent. Think step by step. Use tools precisely and efficiently. Prefer concise, direct answers once you have sufficient information.${PARALLEL_HINT}`;
  }
  // mid tier
  return `You are a reasoning agent. Think step by step and use available tools when needed.${PARALLEL_HINT}`;
}

// ── toProviderMessage ─────────────────────────────────────────────────────────

/** Convert a KernelMessage to provider-native LLMMessage format. */
export function toProviderMessage(msg: KernelMessage): LLMMessage {
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

// ── buildToolSchemas ──────────────────────────────────────────────────────────

/**
 * Filter the available tool schemas based on the gate-blocked tools guard.
 * When required tools haven't been called yet and some tools are gate-blocked,
 * only required (unsatisfied) + meta tools are returned to force the model
 * to select the right tool.
 *
 * Accepts either a pre-augmented schema list (with meta-tools already added)
 * or derives it from `input.availableToolSchemas` when schemas is omitted.
 */
export function buildToolSchemas(
  state: KernelState,
  input: KernelInput,
  _profile: ContextProfile,
  schemas?: readonly ToolSchema[],
): readonly ToolSchema[] {
  const effectiveSchemas = schemas ?? ((input.availableToolSchemas ?? []) as ToolSchema[]);
  const gateBlockedTools = (state.meta.gateBlockedTools as readonly string[] | undefined) ?? [];
  const missingRequired = getMissingRequiredToolsFromSteps(
    state.steps,
    input.requiredTools ?? [],
    input.requiredToolQuantities,
  );

  if (gateBlockedTools.length > 0 && missingRequired.length > 0) {
    return effectiveSchemas.filter((ts) =>
      missingRequired.includes(ts.name) || META_TOOL_NAMES.has(ts.name),
    );
  }
  return effectiveSchemas;
}

// ── buildConversationMessages ─────────────────────────────────────────────────

/**
 * Sidecar carrying the data needed to construct a typed `CompressionApplied`
 * EventBus event at the Effect-context-capable caller (think.ts via
 * defaultContextCurator → ContextManager). Returned by
 * {@link buildConversationMessages} when a fresh CompressionRecommendation
 * was consumed.
 *
 * `taskId` is intentionally NOT carried here — the caller has access to
 * `state.taskId` and supplies it directly when publishing.
 *
 * Issue #119 closure (WS-4 Phase 7) — replaces the prior console.debug
 * fallback path with a typed publish lifted to the curator caller.
 */
export interface CompressionAppliedSidecar {
  readonly iteration: number;
  readonly recommendedAtIteration: number;
  readonly targetTokens: number;
  readonly actualMessageCount: number;
  readonly reason: string;
}

/**
 * Return value of {@link buildConversationMessages}.
 *
 * `compressionApplied` is present iff a fresh `CompressionRecommendation`
 * was consumed on this call. The caller (defaultContextCurator → think.ts)
 * uses the sidecar to publish a typed `CompressionApplied` event via
 * EventBus.
 */
export interface BuildConversationMessagesResult {
  readonly messages: LLMMessage[];
  readonly compressionApplied?: CompressionAppliedSidecar;
}

/**
 * Build the conversation message list for this LLM turn.
 *
 * Applies the sliding message window + task framing on the first iteration.
 * Guidance signals are rendered in the system prompt Guidance: section by
 * think.ts via pendingGuidance — not injected as user messages here.
 *
 * Tool results are never auto-forwarded here — they live in the message thread
 * as-is. Distilled facts (observation extractedFact) are surfaced in the
 * system prompt's Prior work / Observations section, so sliding-window
 * compaction is safe without recall hints.
 *
 * When a fresh CompressionRecommendation is consumed, the return value
 * carries a `compressionApplied` sidecar so the Effect-context-capable
 * caller can publish the typed `CompressionApplied` EventBus event
 * (see `BuildConversationMessagesResult`).
 */
export function buildConversationMessages(
  state: KernelState,
  input: KernelInput,
  profile: ContextProfile,
  adapter: ProviderAdapter,
): BuildConversationMessagesResult {
  // Issue #119 — Curator as sole prompt author. The reactive-observer's
  // compress-messages patch demoted to advisory: it records a
  // CompressionRecommendation on state.meta.pendingCompressionRecommendation.
  // Here we consume that recommendation by clamping the effective budget to
  // min(profile.maxTokens, recommendation.targetTokens) for THIS iteration's
  // render. The recommendation must be fresh (this iteration or last
  // iteration); stale recommendations are ignored.
  const profileBudget = profile.maxTokens ?? Number.MAX_SAFE_INTEGER;
  // state.meta is structurally typed but defensive lookup keeps the curator
  // robust to call sites that synthesize partial states (tests, snapshot
  // restore).
  const rec = state.meta?.pendingCompressionRecommendation;
  const recFresh = rec !== undefined && state.iteration - rec.recommendedAtIteration <= 1;
  const effectiveBudget = recFresh ? Math.min(profileBudget, rec.targetTokens) : profileBudget;

  // Spike 1 (curation ROOT) — age-aware tool-result curation. OPT-IN via
  // RA_CURATION_AGEAWARE=1; default OFF = byte-identical (this block skipped).
  // When ON, the single most-recent tool_result (K=1) is rehydrated FULL from
  // the scratchpad up to a window-scaled ceiling (the synthesis target), and
  // AGED tool_results are recompressed to preview + their existing reversible
  // storedKey pointer. Runs on state.messages (storedKey still intact, before
  // toProviderMessage strips it) and BEFORE windowing so applyMessageWindow-
  // WithCompact keeps its tier-adaptive recent-turns-full guarantee on top.
  const curatedMessages = curationAgeAware()
    ? applyAgeAwareCuration(state.messages, state.scratchpad, profile, 1)
    : state.messages;

  const compactedMessages = applyMessageWindowWithCompact(
    curatedMessages,
    profile.tier ?? "mid",
    effectiveBudget,
  );
  let workingMessages = compactedMessages;

  // taskFraming hook — on first iteration, let adapter annotate the task message
  // to help local models understand the full sequence of steps required.
  if (
    state.iteration === 0 &&
    workingMessages.length === 1 &&
    workingMessages[0]?.role === "user"
  ) {
    const framedTask = adapter.taskFraming?.({
      task: workingMessages[0].content as string,
      requiredTools: input.requiredTools ?? [],
      tier: profile.tier ?? "mid",
    });
    if (framedTask) {
      workingMessages = [{ role: "user" as const, content: framedTask }];
    }
  }

  const messages = (workingMessages as readonly KernelMessage[]).map(toProviderMessage);

  // Issue #119 closure (WS-4 Phase 7) — when a fresh recommendation was
  // consumed, return a sidecar so the Effect-context-capable caller (think.ts
  // via defaultContextCurator → ContextManager) can publish the typed
  // `CompressionApplied` EventBus variant. The prior console.debug fallback
  // is gone: typed events are the sole audit surface. `actualMessageCount`
  // is sampled from the rendered thread length (post-window, post-framing)
  // so observers see the same count the LLM does.
  if (recFresh && rec !== undefined) {
    return {
      messages,
      compressionApplied: {
        iteration: state.iteration,
        recommendedAtIteration: rec.recommendedAtIteration,
        targetTokens: rec.targetTokens,
        actualMessageCount: messages.length,
        reason: rec.reason,
      },
    };
  }
  return { messages };
}
