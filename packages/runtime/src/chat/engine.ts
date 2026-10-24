import type { AgentResult } from "../builder/types.js";
import type { ChatTurnEvent } from "@reactive-agents/core";
import type { ChatMessage, ChatOptions, ChatReply } from "../chat.js";
import type { RunHandle } from "../run-controller.js";
import type { StreamDensity } from "../stream-types.js";
import type { HistoryOverflowHandler } from "../gateway-context-formatting.js";

// ─── Engine defaults (spec A7: engine-optional capabilities carry engine defaults) ──

/** Default high-water turn cap for the window handed to path calls (Task 3 wires the math). */
const DEFAULT_MAX_WINDOW_TURNS = 40;
/** Default high-water character cap for the window handed to path calls (Task 3 wires the math). */
const DEFAULT_MAX_WINDOW_CHARS = 8000;
/**
 * Direct-path reply budget default. Replaces the hardcoded `budgetTokens: 1024` that
 * `chat.ts:directChat` passes today; raised per the canonical-chat-engine spec so a
 * conversational reply is not clipped to legacy constants.
 */
const DEFAULT_MAX_DIRECT_TOKENS = 4096;

/** Separator used when composing direct-path system-prompt fragments (parity with `directChat`). */
const DIRECT_PROMPT_SEPARATOR = "\n\n---\n\n";

/**
 * Engine-default direct-path persona, byte-for-byte the generic conversational prompt
 * `chat.ts:directChat` hardcodes for the no-context case. Used only when no
 * `systemPrompt` capability is wired — never a blank system prompt.
 */
const GENERIC_DIRECT_PROMPT = "You are a helpful AI assistant. Answer conversationally and concisely.";

/** Wrapper template for the parity fallback when prior-run context exists. */
const CONTEXT_DIRECT_PROMPT_PREFIX = "You are a helpful AI assistant. Here is context from a recent agent run:";
const CONTEXT_DIRECT_PROMPT_SUFFIX = "Answer conversationally and concisely.";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * The complete set of host-injected capabilities the canonical {@link ChatEngine}
 * turns over. Two families:
 *
 * - Conversation producers: `runTask` / `runStreamTask` (agentic react-loop paths) and
 *   `complete` (plain conversational completion, no tools).
 * - Optional infrastructure ports: `publishTurn` (EventBus ChatTurn emission),
 *   `saveHistory` / `loadHistory` (SessionStoreService persistence), `systemPrompt`
 *   (persona resolution) and `contextSummary` (prior-run context block).
 *
 * The engine is a pure plain-async orchestrator (the `GatewayChatManager` shape
 * generalized): Effect lives at the host's edge exactly as the facades do today. Every
 * optional port carries an engine default (see {@link ChatEngineOptions} and the
 * direct-path parity prompt) so facades wire only what they genuinely own.
 */
export interface ChatEngineCapabilities {
  /**
   * Agentic execution (tools + reasoning loop). Backed by the host's
   * `ReactiveAgent.run()`. Absent plus a tool request ⇒ typed capability rejection
   * (Task 2 pins the rejection; never a silent fallback to the direct path).
   */
  readonly runTask?: (input: string, opts: { history: readonly ChatMessage[] }) => Promise<AgentResult>;
  /**
   * Agentic streaming. Backed by the host's `ReactiveAgent.runStream()`. Required by
   * `streamTurn()`; absent ⇒ typed capability rejection (Task 4).
   */
  readonly runStreamTask?: (input: string, opts: {
    history: readonly ChatMessage[];
    density?: StreamDensity;
    signal?: AbortSignal;
  }) => RunHandle;
  /**
   * Plain conversational completion, no tools. Backed by LLMService via
   * `gatewayComplete` at the host edge (the engine folds `directChat`'s mechanics into
   * its direct path; the free function itself is deleted under the Task 8 ledger).
   */
  readonly complete: (params: {
    /** Conversation so far, oldest first, newest turn = the incoming user message. */
    messages: readonly { role: "user" | "assistant"; content: string }[];
    /**
     * Composed direct-path prompt. When a `systemPrompt` capability is wired:
     * `[systemPrompt(message), contextSummary(message), extraContext]` joined by
     * `---` separators, empty fragments skipped (persona, then context, then extra).
     * When it is not wired: the engine's generic conversational parity prompt.
     */
    systemPrompt: string;
  }) => Promise<{ message: string; tokens?: number; cost?: number }>;
  /**
   * ChatTurn event publication port. Backed by EventBus. Optional — hosts without an
   * observable surface omit it and the engine skips emission (publish is a
   * swallow-site: emission failure never fails the turn).
   */
  readonly publishTurn?: (turn: ChatTurnEvent) => Promise<void>;
  /**
   * Session-history persistence sink. Backed by SessionStoreService. Optional — when
   * absent the engine keeps history in memory only and `end()` skips the save.
   */
  readonly saveHistory?: (sessionId: string, messages: readonly ChatMessage[]) => Promise<void>;
  /**
   * Session-history loader. Backed by SessionStoreService. Optional — when absent the
   * engine starts from empty in-memory state. Resolved once per engine lifetime on the
   * first turn that needs it (Task 3 wires load-once semantics).
   */
  readonly loadHistory?: (sessionId: string) => Promise<readonly ChatMessage[]>;
  /**
   * Persona/identity resolution for the direct path; the host supplies the binding
   * (e.g. the builder's persona). When unwired the engine falls back to its generic
   * conversational prompt — direct-path parity, never a blank system prompt.
   */
  readonly systemPrompt?: (message: string) => string;
  /**
   * "Context from prior run" block (debrief + observations + taskContext). The host
   * supplies the composition (e.g. a `buildChatSystemContext` closure); the engine
   * renders it as a fragment of the direct-path prompt.
   */
  readonly contextSummary?: (message: string) => string;
}

/**
 * Engine options. Every field a host may pin (canonically all optional); every omitted
 * field falls back to the engine's own default (spec A7 inheritance law).
 */
export interface ChatEngineOptions {
  /**
   * Canonical session id, `sess_<scope>_<unique>` (`agent | session | gateway` scope).
   * Hosts generate via the engine module's id helper (Task 3) rather than pinning
   * legacy literal formats.
   */
  readonly sessionId: string;
  /**
   * High-water turn cap for the window passed to path calls. Default: {@link
   * DEFAULT_MAX_WINDOW_TURNS}. The engine records and persists the FULL unwindowed
   * state; only what is handed to `complete` / `runTask` is windowed (Task 3).
   */
  readonly maxWindowTurns?: number;
  /**
   * High-water character cap for the same window. Default: {@link DEFAULT_MAX_WINDOW_CHARS}.
   */
  readonly maxWindowChars?: number;
  /**
   * Overflow handler (existing type, unchanged semantics). When supplied, turns dropped
   * by the window are spliced back as ONE synthetic assistant summary turn on the copy
   * handed to path calls. Summary content is owned by the host handler; a rejecting or
   * throwing handler propagates to the caller (Task 3 / Review Focus #3).
   */
  readonly onOverflow?: HistoryOverflowHandler;
  /**
   * Direct-path reply budget. Default: {@link DEFAULT_MAX_DIRECT_TOKENS} (raised above
   * `directChat`'s hardcoded 1024). Resolved once at construction and handed to the
   * `complete` capability as the direct-path budget (spec §3: "budget from
   * `maxDirectTokens`").
   */
  readonly maxDirectTokens?: number;
}

/**
 * Per-turn options extending {@link ChatOptions} with engine-internal controls.
 */
export interface TurnOptions extends ChatOptions {
  /**
   * Record DIFFERENT user-turn content than what is sent — the gateway's
   * enriched-instruction case: the raw user message is recorded, the enriched
   * instruction is sent to the model.
   */
  readonly recordUserText?: string;
  /** Stream density forwarded to `runStreamTask` by `streamTurn()` (Task 4). */
  readonly density?: StreamDensity;
  /** Abort signal forwarded to `runStreamTask` by `streamTurn()` (Task 4). */
  readonly signal?: AbortSignal;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Keep only non-empty prompt fragments (empty parts are skipped when composing the
 * direct-path system prompt).
 */
const isNonEmpty = (part: string | undefined): part is string =>
  typeof part === "string" && part.length > 0;

/**
 * Join non-empty prompt fragments with the `---` separator `directChat` uses today
 * (parity: `"\n\n---\n\n"`), skipping empty fragments.
 */
function composeDirectPrompt(...parts: (string | undefined)[]): string {
  return parts.filter(isNonEmpty).join(DIRECT_PROMPT_SEPARATOR);
}

// ─── ChatEngine ───────────────────────────────────────────────────────────────

/**
 * Canonical chat engine: the ONE owner of chat mechanics (routing state, symmetric
 * user/assistant turn recording, direct-path prompt composition, persistence and end
 * semantics). All five chat surfaces (`agent.chat`, `agent.session`, `agent.run` history
 * semantics, `agent.runStream` history semantics, `GatewayChatManager`) delegate onto
 * instances of this class instead of each carrying their own copy (spec A4/A7).
 *
 * Plain-async class with host-injected capabilities (the `GatewayChatManager` shape
 * generalized): Effect stays at the host's boundary; the engine body is ordinary
 * TypeScript. Optional capabilities carry engine defaults so facades wire only what
 * they own and inherit engine improvements by default.
 */
export class ChatEngine {
  #deps: ChatEngineCapabilities;
  #sessionId: string;
  #maxWindowTurns: number;
  #maxWindowChars: number;
  #onOverflow?: HistoryOverflowHandler;
  #maxDirectTokens: number;
  /** In-memory session state, oldest first, symmetric user + assistant turns. */
  #history: ChatMessage[] = [];

  /**
   * @param deps host-injected capabilities.
   * @param options engine options; omitted fields fall back to engine defaults
   *   (40 turns / 8k chars window caps, 4096 direct-path budget).
   */
  constructor(deps: ChatEngineCapabilities, options?: ChatEngineOptions) {
    this.#deps = deps;
    this.#sessionId = options?.sessionId ?? "";
    this.#maxWindowTurns = options?.maxWindowTurns ?? DEFAULT_MAX_WINDOW_TURNS;
    this.#maxWindowChars = options?.maxWindowChars ?? DEFAULT_MAX_WINDOW_CHARS;
    this.#onOverflow = options?.onOverflow;
    this.#maxDirectTokens = options?.maxDirectTokens ?? DEFAULT_MAX_DIRECT_TOKENS;
  }

  /**
   * Buffered conversational turn — the single entry point for `agent.chat`,
   * `session.chat`, and the gateway chat surface.
   *
   * Direct path (Task 1 shape): composes the system prompt from the host's
   * `systemPrompt` / `contextSummary` capabilities plus the turn's `extraContext`
   * (persona, then context summary, then extra context; empty fragments skipped, joined
   * by `---` separators); when no `systemPrompt` capability is wired, falls back to the
   * same generic conversational prompt `directChat` hardcodes today (parity, never a
   * blank system prompt). Sends full history + the incoming message to `complete`, then
   * records the user turn (`recordUserText ?? message`) and the assistant turn.
   *
   * Tool path (`runTask` routing + full reply assembly + `publishTurn`) and history
   * resolution/persistence/windowing land in Tasks 2-3 under the same signature.
   */
  async turn(message: string, options?: TurnOptions): Promise<ChatReply> {
    const messages = [
      ...this.#history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: message },
    ];
    const systemPrompt = this.#directSystemPrompt(message, options?.extraContext);
    const reply = await this.#deps.complete({
      messages,
      systemPrompt,
    });
    // Symmetric recording: user turn first (recordUserText ?? message), then the
    // assistant turn after the reply resolves.
    this.#history.push({
      role: "user",
      content: options?.recordUserText ?? message,
      timestamp: Date.now(),
    });
    this.#history.push({ role: "assistant", content: reply.message, timestamp: Date.now() });
    return reply;
  }

  /**
   * Compose the direct-path system prompt for one turn.
   *
   * Wired persona: `[systemPrompt(message), contextSummary(message), extraContext]`
   * joined by `---` separators, empty fragments skipped, in that order. No
   * `systemPrompt` capability: the engine falls back to the exact generic
   * conversational prompt `directChat` composes today (with-context vs bare variants),
   * so the persona-less direct path keeps byte parity with pre-engine behavior.
   */
  #directSystemPrompt(message: string, extraContext?: string): string {
    const systemPromptCapability = this.#deps.systemPrompt;
    const contextSummary = this.#deps.contextSummary?.(message);
    if (systemPromptCapability) {
      return composeDirectPrompt(
        systemPromptCapability(message),
        contextSummary,
        extraContext,
      );
    }
    const fullContext = [contextSummary, extraContext].filter(isNonEmpty).join(DIRECT_PROMPT_SEPARATOR);
    return fullContext
      ? `${CONTEXT_DIRECT_PROMPT_PREFIX}\n\n${fullContext}\n\n${CONTEXT_DIRECT_PROMPT_SUFFIX}`
      : GENERIC_DIRECT_PROMPT;
  }

  /**
   * Snapshot of the engine's full session history, oldest first, both roles symmetric.
   * Returns a defensive copy — mutating the returned array does not affect engine state.
   */
  history(): ChatMessage[] {
    return [...this.#history];
  }

  /**
   * Flush and clear the session. When a `saveHistory` capability is present, the save
   * captures the FULL pre-clear history and the return is that save's promise (same
   * contract as `AgentSession.end()`); it is always awaited before this method resolves.
   */
  async end(): Promise<void> {
    const save = this.#deps.saveHistory?.(this.#sessionId, this.#history);
    this.#history = [];
    if (save) await save;
  }
}

/**
 * Resolution of the engine's direct-path budget for a given options bag. Exposed for
 * host facade wiring (Task 5 onward): the host's `complete` capability wraps
 * `gatewayComplete` and consumes this value as its `budgetTokens` request option, the
 * same role `budgetTokens: 1024` played inside `directChat` before the fold.
 */
export function resolveDirectBudget(options?: Pick<ChatEngineOptions, "maxDirectTokens">): number {
  return options?.maxDirectTokens ?? DEFAULT_MAX_DIRECT_TOKENS;
}
