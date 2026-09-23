/**
 * Judgment Phase D - includeContext auto-merge for agent.judge().
 *
 * DX gap this closes: before this file, agent.judge({ state, questions })
 * required the caller to hand-assemble state from whatever context they
 * wanted judged. includeContext: true instead folds the agent's own
 * recently-observed context (windowed chat history + recent tool
 * observations) into state automatically - zero cost when omitted (no
 * existing Phase C call site passes it, so behavior there is unchanged byte
 * for byte).
 *
 * Two already-computed state sources are reused here rather than
 * re-derived:
 *   - Message windowing reuses applyHistoryWindow (this package,
 *     gateway-context-formatting.ts) - the same oldest-first trim
 *     algorithm the gateway chat path already uses for the identical
 *     purpose (folding recent conversation into a bounded context block).
 *   - Tool-observation content comes from ReactiveAgent's own
 *     _lastReasoningSteps cache (raw ReasoningStep[] from the last run()),
 *     the same source _lastRunObservations derives from for chat() context.
 *   - Tool-result truncation reuses compressToolResult
 *     (@reactive-agents/reasoning), the same structured preview +
 *     scratchpad-storage compressor the kernel's own act/attend phases use
 *     for tool output - not a second, weaker truncation implementation.
 */
import { Schema } from "effect";
import { compressToolResult, type ReasoningStep } from "@reactive-agents/reasoning";
import type { ChatMessage } from "./chat.js";
import { applyHistoryWindow, formatHistoryBlock } from "./gateway-context-formatting.js";

// --- Options ---

/**
 * Options controlling agent.judge()'s opt-in auto-context merge.
 *
 * All fields optional; includeContext is the gate - every other field is
 * inert unless it's true.
 */
export const JudgeContextOptionsSchema = Schema.Struct({
  /** Fold recent message history + tool observations into state. Default: off. */
  includeContext: Schema.optional(Schema.Boolean),
  /**
   * Max turns of chat history to include. Defaults to the same window
   * applyHistoryWindow already uses for gateway chat context (40 turns /
   * 8,000 chars, oldest-first trim).
   */
  messageWindow: Schema.optional(Schema.Number),
  /** Include recent tool observations. Defaults to true when includeContext is true. */
  includeToolResults: Schema.optional(Schema.Boolean),
});
export type JudgeContextOptions = typeof JudgeContextOptionsSchema.Type;

// --- Constants ---

/** Matches gateway-context-formatting.ts's MAX_TURNS default - not exported there, mirrored here. */
const DEFAULT_MESSAGE_WINDOW = 40;
/** Most-recent N tool observations folded in when includeToolResults is on. */
const DEFAULT_TOOL_RESULT_COUNT = 5;
/** Per-observation char budget passed to compressToolResult. */
const DEFAULT_TOOL_RESULT_BUDGET = 400;
/** Array-preview item count passed to compressToolResult. */
const DEFAULT_TOOL_RESULT_PREVIEW_ITEMS = 3;

// --- Context sources ---

/** The already-computed ReactiveAgent state buildAutoContext reads from. */
export interface JudgeContextSources {
  readonly chatHistory: readonly ChatMessage[];
  readonly reasoningSteps: readonly ReasoningStep[];
}

/** A plain JSON-shaped auto-context bag, ready to merge into a JudgmentEntry object. */
export type AutoContext = Readonly<Record<string, unknown>>;

/**
 * Assemble the auto-context bag from already-computed ReactiveAgent state.
 * Returns {} (no-op) when options.includeContext is falsy - callers should
 * skip calling this entirely on the hot path when the option is absent,
 * since even {} construction has a small allocation cost.
 */
export function buildAutoContext(
  sources: JudgeContextSources,
  options: JudgeContextOptions,
): AutoContext {
  if (!options.includeContext) return {};

  const context: Record<string, unknown> = {};

  const messageWindow = options.messageWindow ?? DEFAULT_MESSAGE_WINDOW;
  const windowedHistory = applyHistoryWindow(sources.chatHistory, messageWindow);
  const recentMessages = formatHistoryBlock(windowedHistory);
  if (recentMessages) context.recentMessages = recentMessages;

  const includeToolResults = options.includeToolResults ?? true;
  if (includeToolResults) {
    const observations = sources.reasoningSteps.filter((s) => s.type === "observation");
    const recent = observations.slice(-DEFAULT_TOOL_RESULT_COUNT);
    if (recent.length > 0) {
      context.toolResults = recent.map(
        (s) =>
          compressToolResult(
            s.content,
            s.metadata?.toolUsed ?? "unknown",
            DEFAULT_TOOL_RESULT_BUDGET,
            DEFAULT_TOOL_RESULT_PREVIEW_ITEMS,
          ).content,
      );
    }
  }

  return context;
}

// --- Merge ---

const isPlainObject = (
  value: unknown,
): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Merge caller-supplied state with the auto-assembled context bag.
 *
 * Precedence: the caller's manually-passed state ALWAYS wins on key
 * collision - auto-context only fills gaps, it never overwrites an explicit
 * field. This is the one surprising behavior in includeContext: passing
 * state: { recentMessages: "..." } alongside includeContext: true keeps
 * your recentMessages, not the auto-assembled one.
 *
 * - No manual state + non-empty auto-context -> the auto-context bag.
 * - No manual state + empty auto-context -> {}.
 * - Manual state is a plain object -> shallow-merged, manual keys win.
 * - Manual state is a string/array/null (not a plain object) -> returned
 *   unchanged; a non-object value can't be shallow-merged with an object
 *   bag, so the caller's explicit whole value wins outright.
 */
export function mergeJudgmentState(
  manualState: unknown,
  autoContext: AutoContext,
): unknown {
  const hasAutoContext = Object.keys(autoContext).length > 0;
  if (manualState === undefined) {
    return hasAutoContext ? autoContext : {};
  }
  if (!hasAutoContext) return manualState;
  if (!isPlainObject(manualState)) return manualState;
  return { ...autoContext, ...manualState };
}
