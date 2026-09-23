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
 *
 * Fix-round-1 correction (2026-09-23): tool-result truncation does NOT reuse
 * compressToolResult (@reactive-agents/reasoning), even though that helper is
 * now exported and reachable. compressToolResult's over-budget output embeds
 * a "[STORED: <key> | <tool>] ... use recall(\"<key>\", ...)" instruction
 * (tool-formatting.ts) that is only true at its native call site
 * (kernel/capabilities/act/tool-execution.ts), which also calls
 * setScratchpadBounded so a later recall() by the SAME agent's own reasoning
 * loop can act on it. The judgment backend has no scratchpad and no recall
 * tool - folding that instruction into a judgment prompt would be a false
 * capability claim ("this is stored, ask for more" when nothing is stored
 * and nothing can ask). truncateToolResult below is a plain byte-budget
 * truncation with an honest "(truncated, N chars)" marker instead - it never
 * claims a capability the judgment backend doesn't have.
 *
 * Nested `includeContext` shape (fix-round-2, 2026-09-23): the first cut of
 * this feature added `includeReasoningSteps` as a flat sibling of
 * `includeContext`, alongside `messageWindow` / `includeToolResults` /
 * `reasoningStepsWindow` / `reasoningStepTypes` - five loose top-level
 * options that don't namespace and don't read well at call sites
 * (`agent.judge({ includeContext: true, includeReasoningSteps: true,
 * reasoningStepsWindow: 10 })`). This was reshaped before it ever shipped:
 * `includeContext` now accepts `boolean | JudgeContextConfig`, where
 * `JudgeContextConfig` is `{ messages?, toolResults?, reasoningSteps? }` -
 * each key itself `boolean | { window?, ... }`. The five flat sibling
 * fields are gone; there is no back-compat burden because they were never
 * released.
 *
 * The two `includeContext` forms are deliberately asymmetric:
 *   - `includeContext: true` -> every layer on, every layer's own default
 *     (messages: DEFAULT_MESSAGE_WINDOW turns, toolResults: on,
 *     reasoningSteps: on with DEFAULT_REASONING_STEPS_WINDOW). "true means
 *     true" - the whole point of a bare boolean shorthand is "give me
 *     everything", so reasoningSteps is NOT held back to an opt-in-only
 *     status under bare `true` the way the flat-field design did.
 *   - `includeContext: { ... }` (object form) -> exclusive/opt-in per
 *     layer. A key absent from the object means that layer is OFF, not
 *     defaulted-on. `includeContext: { reasoningSteps: true }` folds in
 *     ONLY `context.reasoningSteps` - `recentMessages` and `context.toolResults`
 *     are both absent from the result, even though they're on by default
 *     under bare `true`. This is what "granularly opt into layers" means:
 *     naming the object form is exclusive, not additive-with-defaults.
 */
import { Schema } from "effect";
import type { ReasoningStep, StepType } from "@reactive-agents/reasoning";
import type { ChatMessage } from "./chat.js";
import { applyHistoryWindow, formatHistoryBlock } from "./gateway-context-formatting.js";

// --- Options ---

/** Per-layer message-window override for the object form of `includeContext.messages`. */
const MessagesConfigSchema = Schema.Struct({
  /**
   * Max turns of chat history to include. Defaults to the same window
   * applyHistoryWindow already uses for gateway chat context (40 turns /
   * 8,000 chars, oldest-first trim).
   */
  window: Schema.optional(Schema.Number),
});

/** Per-layer window/type-filter override for the object form of `includeContext.reasoningSteps`. */
const ReasoningStepsConfigSchema = Schema.Struct({
  /**
   * Max number of most-recent reasoning steps to include. Defaults to
   * DEFAULT_REASONING_STEPS_WINDOW (20).
   */
  window: Schema.optional(Schema.Number),
  /**
   * Restrict which step types are folded in. Defaults to undefined (no
   * filtering - every step type present in the trace is included).
   */
  types: Schema.optional(Schema.Array(Schema.String)),
});

/**
 * Nested, per-layer shape for `agent.judge()`'s `includeContext` object
 * form. Each layer is independently `boolean | { ...tuning }` - a key
 * absent from this object means that layer is OFF (see file header for the
 * true-vs-object asymmetry).
 */
export const JudgeContextConfigSchema = Schema.Struct({
  /** Fold recent chat history into `context.recentMessages`. */
  messages: Schema.optional(Schema.Union(Schema.Boolean, MessagesConfigSchema)),
  /** Fold recent tool observations into `context.toolResults`. */
  toolResults: Schema.optional(Schema.Boolean),
  /**
   * Fold the agent's full last-run reasoning-step trace (thought/action/
   * observation/plan/reflection/critique - not just observation-type steps)
   * into `context.reasoningSteps` as a JSON string.
   */
  reasoningSteps: Schema.optional(Schema.Union(Schema.Boolean, ReasoningStepsConfigSchema)),
});
export type JudgeContextConfig = Omit<typeof JudgeContextConfigSchema.Type, "reasoningSteps"> & {
  readonly reasoningSteps?:
    | boolean
    | {
        readonly window?: number;
        readonly types?: readonly StepType[];
      };
};

/**
 * Options controlling agent.judge()'s opt-in auto-context merge.
 *
 * `includeContext: true` folds in every layer with its own default; passing
 * a `JudgeContextConfig` object instead opts into only the named layers
 * (see file header for the full contract).
 */
export const JudgeContextOptionsSchema = Schema.Struct({
  includeContext: Schema.optional(Schema.Union(Schema.Boolean, JudgeContextConfigSchema)),
});
export type JudgeContextOptions = Omit<typeof JudgeContextOptionsSchema.Type, "includeContext"> & {
  readonly includeContext?: boolean | JudgeContextConfig;
};

// --- Constants ---

/**
 * Matches gateway-context-formatting.ts's MAX_TURNS default. Not imported
 * from there because that constant isn't exported (module-private); mirrored
 * here rather than exporting a single constant across a package boundary for
 * one call site. If gateway-context-formatting.ts's MAX_TURNS ever changes,
 * this default silently drifts from it - low risk (both are "40 turns of
 * chat history", a documented default rather than a correctness-critical
 * value) but worth a second look if that constant moves.
 */
const DEFAULT_MESSAGE_WINDOW = 40;
/** Most-recent N tool observations folded in when the toolResults layer is on. */
const DEFAULT_TOOL_RESULT_COUNT = 5;
/**
 * Per-observation char budget for truncateToolResult. Deliberately smaller
 * than the kernel's own tier-dependent tool-result budget
 * (`toolResultMaxChars`, packages/reasoning/src/context/context-profile.ts -
 * 600 to 4000 depending on tier, 800 for "large"): the toolResults layer
 * folds up to DEFAULT_TOOL_RESULT_COUNT (5) observations into ONE judgment
 * prompt alongside recentMessages, not a single tool result into a full
 * reasoning context window, so each one gets a tighter slice.
 */
const DEFAULT_TOOL_RESULT_BUDGET = 400;
/**
 * Most-recent N reasoning steps folded into `context.reasoningSteps` when
 * the reasoningSteps layer is on. Windowed by step COUNT rather than the
 * per-item char truncation the toolResults layer uses - reasoningSteps is
 * folded as one JSON blob covering multiple step types, not one truncated
 * string per observation, so a count window keeps the blob's overall size
 * predictable without mangling any individual step's content.
 */
const DEFAULT_REASONING_STEPS_WINDOW = 20;

// --- Tool-result truncation ---

/**
 * Minimal, honest byte-budget truncation for a tool observation's content.
 * Deliberately does NOT delegate to compressToolResult (see file header for
 * why: that helper's over-budget output claims the full result is "stored"
 * and tells the reader to "recall(...)" it, which is only true at its native
 * kernel call site with a live scratchpad + recall tool - neither of which
 * exists on the judgment-backend side of includeContext).
 */
export function truncateToolResult(
  content: string,
  budget: number = DEFAULT_TOOL_RESULT_BUDGET,
): string {
  if (content.length <= budget) return content;
  const suffix = ` (truncated, ${content.length} chars total)`;
  return content.slice(0, budget) + suffix;
}

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
 * Returns {} (no-op) when includeContext is falsy - callers should skip
 * calling this entirely on the hot path when the option is absent, since
 * even {} construction has a small allocation cost.
 *
 * `includeContext === true` resolves to every layer on with its own
 * default. `includeContext` as a `JudgeContextConfig` object resolves each
 * named layer only - an absent key is OFF, not defaulted-on (see file
 * header for the full true-vs-object contract).
 */
export function buildAutoContext(
  sources: JudgeContextSources,
  includeContext: boolean | JudgeContextConfig | undefined,
): AutoContext {
  if (!includeContext) return {};

  const cfg: JudgeContextConfig =
    includeContext === true
      ? { messages: true, toolResults: true, reasoningSteps: true }
      : includeContext;

  const context: Record<string, unknown> = {};

  if (cfg.messages) {
    const messagesCfg = cfg.messages === true ? {} : cfg.messages;
    const messageWindow = messagesCfg.window ?? DEFAULT_MESSAGE_WINDOW;
    const windowedHistory = applyHistoryWindow(sources.chatHistory, messageWindow);
    const recentMessages = formatHistoryBlock(windowedHistory);
    if (recentMessages) context.recentMessages = recentMessages;
  }

  if (cfg.toolResults) {
    const observations = sources.reasoningSteps.filter((s) => s.type === "observation");
    const recent = observations.slice(-DEFAULT_TOOL_RESULT_COUNT);
    if (recent.length > 0) {
      context.toolResults = recent.map((s) => truncateToolResult(s.content));
    }
  }

  if (cfg.reasoningSteps) {
    const reasoningStepsCfg = cfg.reasoningSteps === true ? {} : cfg.reasoningSteps;
    const typeFilter = reasoningStepsCfg.types;
    const filtered = typeFilter
      ? sources.reasoningSteps.filter((s) => (typeFilter as readonly string[]).includes(s.type))
      : sources.reasoningSteps;
    const window = reasoningStepsCfg.window ?? DEFAULT_REASONING_STEPS_WINDOW;
    const windowed = filtered.slice(-window);
    if (windowed.length > 0) {
      context.reasoningSteps = JSON.stringify(
        windowed.map((s) => ({
          type: s.type,
          content: s.content,
          ...(s.metadata?.toolUsed ? { toolUsed: s.metadata.toolUsed } : {}),
        }))
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
