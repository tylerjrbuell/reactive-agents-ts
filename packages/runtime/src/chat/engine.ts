import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { validateCitations } from "@reactive-agents/reasoning";
import type { ReasoningStep } from "@reactive-agents/reasoning";
import type { AgentResult } from "../builder/types.js";
import type { ChatTurnEvent } from "@reactive-agents/core";
import type { ChatMessage, ChatOptions, ChatReply } from "../chat.js";
import type { RunHandle } from "../run-controller.js";
import type { AgentStreamEvent, StreamDensity } from "../stream-types.js";
import type { HistoryOverflowHandler } from "../gateway-context-formatting.js";
import {
  applyHistoryWindow,
  applyHistoryWindowWithOverflow,
} from "../gateway-context-formatting.js";
import { ChatEngineCapabilityError } from "./engine-errors.js";

// ─── Engine defaults (spec A7: engine-optional capabilities carry engine defaults) ──

/** Default high-water turn cap for the window handed to path calls (Task 3 wires the math). */
const DEFAULT_MAX_WINDOW_TURNS = 40;
/** Default high-water character cap for the window handed to path calls (Task 3 wires the math). */
const DEFAULT_MAX_WINDOW_CHARS = 8000;
/**
 * Direct-path reply budget default. Replaces the hardcoded `budgetTokens: 1024` that
 * `chat.ts:direct path` passes today; raised per the canonical-chat-engine spec so a
 * conversational reply is not clipped to legacy constants.
 */
const DEFAULT_MAX_DIRECT_TOKENS = 4096;

/** Separator used when composing direct-path system-prompt fragments (parity with `direct path`). */
const DIRECT_PROMPT_SEPARATOR = "\n\n---\n\n";

/**
 * Separator used when composing the tool-path runTask input from the host's
 * `contextSummary` fragment and the raw message (Task 2). The engine owns the
 * joining mechanic; the fragment WORDINGS ("Context from prior run", "New
 * request") stay at the host's `contextSummary` composition point.
 */
const TURN_INPUT_SEPARATOR = "\n\n---\n\n";

/**
 * Engine-default direct-path persona, byte-for-byte the generic conversational prompt
 * `chat.ts:direct path` hardcodes for the no-context case. Used only when no
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
  readonly runTask?: (input: string, opts: {
    history: readonly ChatMessage[];
    maxIterations?: number;
  }) => Promise<AgentResult>;
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
   * `gatewayComplete` at the host edge (the engine folds `direct path`'s mechanics into
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
    /**
     * Direct-path reply budget, resolved ENGINE-side from `maxDirectTokens`
     * (engine default when unset). The mechanic lives engine-side (Task-1
     * ruling): the host's `complete` capability consumes this value in the same
     * role `budgetTokens: 1024` played inside `direct path` before the fold.
     */
    budgetTokens?: number;
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
  readonly scratchpadEntries?: () => Readonly<Record<string, string>>;
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
   * `direct path`'s hardcoded 1024). Resolved once at construction and handed to the
   * `complete` capability as the direct-path budget (spec §3: "budget from
   * `maxDirectTokens`").
   */
  readonly maxDirectTokens?: number;
  /**
   * Pre-seed the engine's session state with an existing conversation (oldest
   * first, symmetric user/assistant turns) instead of wiring `loadHistory`.
   * Intended for hosts that own their own persistence and seed each rebuilt
   * engine from their store (e.g. cortex).
   *
   * Precedence ruling: a NON-EMPTY `initialHistory` takes precedence over
   * `loadHistory` — the loader is NEVER called (the load-once latch is marked
   * satisfied at construction). An EMPTY array does NOT latch: a wired loader
   * still resolves on the first turn exactly as when the option is omitted.
   */
  readonly initialHistory?: readonly ChatMessage[];
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
 * Join non-empty prompt fragments with the `---` separator `direct path` uses today
 * (parity: `"\n\n---\n\n"`), skipping empty fragments.
 */
function composeDirectPrompt(...parts: (string | undefined)[]): string {
  return parts.filter(isNonEmpty).join(DIRECT_PROMPT_SEPARATOR);
}

/**
 * Report one swallowed (telemetry-quality) engine-side failure: publish and
 * persist failures never fail the turn, but must still be audible. Runs
 * {@link emitErrorSwallowed} (which no-ops when no `EventBus` is in scope) as a
 * detached effect so failure emission cannot throw back into plain-async engine
 * code; emission failure itself is likewise swallowed — the turn already owns
 * the decision that the original error is non-fatal.
 *
 * All engine swallow-sites carry a site tag naming `chat/engine.ts` so trace
 * consumers can attribute the swallow (`runtime/src/chat/engine.ts` file family).
 */
function swallowError(err: unknown, site: string): void {
  void Effect.runPromise(emitErrorSwallowed({ site, tag: errorTag(err) })).catch(() => {});
}

/**
 * Generate a canonical session id: `sess_<scope>_<parts joined by _>-<unique>`.
 *
 * Scopes (spec §1 fix 4): `"agent"` for `agent.chat`'s agent-scoped engine,
 * `"session"` for `agent.session()` ids, `"gateway"` for per-sender gateway
 * engines. The unique suffix is a compressed `crypto.randomUUID()` — dashes
 * stripped, first 12 hex characters — attached after a `-` separator (the pinned
 * `sess_agent_agent-1-…` shape) so ids are collision-safe without extra state.
 * Host facades generate ids through this helper instead of pinning legacy literal
 * formats (`gateway-chat-<agentId>-<sender>`, `chat_<ts>`): those keys remain
 * READABLE through load fallbacks (Tasks 6/7) but are never written.
 *
 * @param scope canonical id scope.
 * @param parts scope-qualifying segments, joined with `_` (e.g. agentId,
 *   gateway agentId + sender). Empty/blank parts are skipped; a session-scope id
 *   with no parts is `sess_session_<unique>`.
 * @returns canonical session id, `sess_<scope>_<parts>-<unique>`.
 */
export function nextSessionId(scope: "agent" | "session" | "gateway", parts: readonly string[]): string {
  const unique = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const joined = parts.filter((part) => part.length > 0).join("_");
  return joined.length > 0 ? `sess_${scope}_${joined}-${unique}` : `sess_${scope}_${unique}`;
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
   * Load-once latch (Task 3): set after the first turn resolves `loadHistory` —
   * including when the loader resolves empty — so the loader is ever called
   * exactly once per engine lifetime.
   */
  #loaded = false;

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
    const initialHistory = options?.initialHistory ?? [];
    this.#history = [...initialHistory];
    // Load-once latch seeds with the option: a non-empty seed means the loader
    // must NEVER run; empty seeds keep the loader's first-turn resolution.
    this.#loaded = initialHistory.length > 0;
  }

  /**
   * Buffered conversational turn — the single entry point for `agent.chat`,
   * `session.chat`, and the gateway chat surface.
   *
   * Routing: `options.useTools ?? false`. Hosts that own a tool-intent
   * classifier (e.g. `agent.chat`'s `toolIntentClassifier` / `requiresTools`)
   * resolve it FIRST and pass the resolved boolean; the engine itself never
   * classifies (no classification capability exists in the locked shape, and
   * the engine must not depend on the reasoning package's heuristics).
   *
   * Direct path (Task 1 shape): composes the system prompt from the host's
   * `systemPrompt` / `contextSummary` capabilities plus the turn's `extraContext`
   * (persona, then context summary, then extra context; empty fragments skipped, joined
   * by `---` separators); when no `systemPrompt` capability is wired, falls back to the
   * same generic conversational prompt `direct path` hardcodes today (parity, never a
   * blank system prompt). Sends full history + the incoming message to `complete`
   * together with the engine-resolved `budgetTokens` (Task-1 ruling: the direct-budget
   * mechanic lives engine-side), then records the user turn (`recordUserText ??
   * message`) and the assistant turn.
   *
   * Tool path (Task 2): requires `runTask` — typed {@link ChatEngineCapabilityError}
   * rejection otherwise, never a silent fallback onto the direct path. The input
   * handed to `runTask` composes the host's `contextSummary(message)` fragment with
   * the raw message (`[summary, message].filter(Boolean).join("\n\n---\n\n")` — the
   * "Context from prior run" / "New request" word strings belong to the host's
   * contextSummary composition point, not the engine); the RAW prior turn list rides
   * `opts.history` (run's own `withHistoryBlock` renders turn text). The reply is
   * assembled with the exact field mapping `agent.chat()`'s tool path used
   * (`toolsUsed` from `metadata.toolCalls` with debrief fallback, `tokens`, `steps`,
   * `cost`, `reasoningSteps`, `scratchpad`, `citationCheck`).
   *
   * Both paths record symmetric turns, publish a user+assistant `ChatTurn` pair
   * via `publishTurn` when wired (`routedVia` reflects the path), and persist the
   * full post-turn state via `saveHistory` when wired. Publish and persist are
   * swallow-sites (telemetry-quality): a failure there never fails the turn and
   * surfaces as an `ErrorSwallowed` event tagged `chat/engine.ts`.
   *
   * History resolution (Task 3) precedes routing: the first turn with empty
   * in-memory state loads the persisted session exactly once via `loadHistory`
   * (even when the loader resolves empty) and seeds the engine's state. What is
   * HANDED to the path calls is the windowed copy ({@link #historyForPath});
   * recording, publishing payloads, and persistence always run on the FULL
   * unwindowed state.
   */
  async turn(message: string, options?: TurnOptions): Promise<ChatReply> {
    await this.#resolveLoadedHistory();
    if (options?.useTools === true) {
      if (!this.#deps.runTask) {
        throw new ChatEngineCapabilityError({
          message:
            "ChatEngine.turn() requested the tool path (`useTools: true`) but no `runTask` capability is wired on this engine — wire `runTask` (e.g. backed by `ReactiveAgent.run()`) to enable tool-capable chat.",
          capability: "runTask",
        });
      }
      const contextSummary = this.#deps.contextSummary?.(message);
      const input = [contextSummary ?? "", message].filter(isNonEmpty).join(TURN_INPUT_SEPARATOR);
      const history = await this.#historyForPath();
      const result = await this.#deps.runTask(input, {
        history,
        maxIterations: options?.maxIterations,
      });
      const reply = this.#assembleToolReply(result, options);
      const userText = options.recordUserText ?? message;
      this.#recordBothTurns(userText, reply.message);
      await this.#publishTurns(result.taskId, "react-loop", userText, reply.message, result.metadata.tokensUsed);
      await this.#persistHistory();
      return reply;
    }

    const history = await this.#historyForPath();
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: message },
    ];
    const systemPrompt = this.#directSystemPrompt(message, options?.extraContext);
    const reply = await this.#deps.complete({
      messages,
      systemPrompt,
      budgetTokens: this.#maxDirectTokens,
    });
    // Symmetric recording: user turn first (recordUserText ?? message), then the
    // assistant turn after the reply resolves.
    const userText = options?.recordUserText ?? message;
    this.#recordBothTurns(userText, reply.message);
    await this.#publishTurns("chat", "direct-llm", userText, reply.message, reply.tokens);
    await this.#persistHistory();
    return reply;
  }

  /**
   * Streaming conversational turn — the single entry point for streaming chat
   * surfaces (`agent.runStream`, `session.runStream`, gateway streaming chat).
   *
   * Requires the `runStreamTask` capability: when absent the call throws a typed
   * {@link ChatEngineCapabilityError} naming the missing capability, synchronously,
   * before any stream is created. Streaming IS the streaming request (`useTools`
   * and density options ride `TurnOptions`); there is no direct-path fallback.
   *
   * History resolution mirrors {@link turn()}: load-once seeding via
   * {@link #resolveLoadedHistory}, then the windowed copy via {@link #historyForPath}
   * is handed to `runStreamTask`; the engine's FULL unwindowed state owns recording,
   * publishing payloads, and persistence.
   *
   * Returns a wrapper {@link RunHandle} whose generator tees the inner handle's
   * {@link AgentStreamEvent}s unaltered while capturing the terminal event. Recording
   * happens at TERMINAL-EVENT OBSERVATION, inside the tee loop and BEFORE the terminal
   * event is yielded: when `StreamCompleted` is observed the symmetric user
   * (`recordUserText ?? message`) + assistant turns are recorded, the `ChatTurn` pair
   * is published (`routedVia: "react-loop"`, same publish + observability mechanics
   * as the tool path), and the FULL state is persisted — publish and persist are
   * swallow-sites exactly as in `turn()`. Because recording precedes the yield, a
   * consumer that closes the stream right after receiving `StreamCompleted` (tee-turn
   * `return()` at the yield point, e.g. an SSE route) cannot drop the turn, and a
   * consumer iterating past the terminal records exactly once. On `StreamError` (or
   * a cancelled/aborted stream that never reaches `StreamCompleted`) NOTHING is
   * recorded, published, or persisted — a failed stream leaves no trace in session
   * history.
   *
   * The `RunHandle` verbs (`pause/resume/stop/terminate/status/inspect`) delegate to
   * the inner handle returned by `runStreamTask`. They are lazily bound: the inner
   * handle is created when the stream is first iterated (the engine resolves
   * `loadHistory`/windowing before calling `runStreamTask`), so verbs called before
   * the first iteration no-op (`status()` reports `"running"`, `inspect()` reports
   * `undefined`).
   *
   * @param message the incoming user message.
   * @param options per-turn options; `recordUserText`, `density` and `signal` are
   *   forwarded as in `turn()` / to `runStreamTask`.
   * @returns a wrapper RunHandle streaming `AgentStreamEvent`s unaltered, with the
   *   recording/persistence side effects captured at the terminal event.
   * @throws ChatEngineCapabilityError when `runStreamTask` is not wired.
   */
  streamTurn(message: string, options?: TurnOptions): RunHandle {
    /**
     * `runStreamTask` re-bound to the narrowed (required) capability shape after
     * the guard: TypeScript does not carry union narrowing of an optional
     * capability into the nested generator closure below, so the closure reads
     * this explicitly-typed binding instead.
     */
    const runStreamTask: NonNullable<ChatEngineCapabilities["runStreamTask"]> | undefined =
      this.#deps.runStreamTask;
    if (!runStreamTask) {
      throw new ChatEngineCapabilityError({
        message:
          "ChatEngine.streamTurn() requested the streaming path but no `runStreamTask` capability is wired on this engine — wire `runStreamTask` (e.g. backed by `ReactiveAgent.runStream()`) to enable streaming chat.",
        capability: "runStreamTask",
      });
    }
    const streamTask = runStreamTask;
    const engine = this;
    const userText = options?.recordUserText ?? message;
    /**
     * Lazily-bound inner handle. Created when the wrapper generator starts
     * iterating (history resolution is async, so `runStreamTask` cannot be
     * called synchronously); verbs consult it through this holder.
     */
    const inner: { handle?: RunHandle } = {};
    async function* teeTurn(): AsyncGenerator<AgentStreamEvent> {
      await engine.#resolveLoadedHistory();
      const history = await engine.#historyForPath();
      const handle = streamTask(message, {
        history,
        density: options?.density,
        signal: options?.signal,
      });
      inner.handle = handle;
      /**
       * Recording happens at terminal-event OBSERVATION, inside the tee loop
       * and before the terminal event is yielded, so a consumer that closes
       * the stream right after receiving `StreamCompleted` (the tee-turn
       * `return()`-at-yield-point case) cannot drop the turn. `recorded`
       * guards a consumer that iterates past the terminal from recording a
       * second time; a `StreamError` or an early-aborted stream that never
       * reaches `StreamCompleted` records nothing, exactly as before.
       */
      let recorded = false;
      for await (const event of handle) {
        if (event._tag === "StreamCompleted" && !recorded) {
          recorded = true;
          engine.#recordBothTurns(userText, event.output);
          await engine.#publishTurns(
            event.taskId ?? "stream",
            "react-loop",
            userText,
            event.output,
            event.metadata?.tokensUsed,
          );
          await engine.#persistHistory();
        }
        yield event;
      }
    }
    return Object.assign(teeTurn(), {
      pause: () => inner.handle?.pause(),
      resume: () => inner.handle?.resume(),
      stop: (opts?: { reason?: string }) => inner.handle?.stop(opts),
      terminate: (opts?: { reason?: string }) => inner.handle?.terminate(opts),
      status: () => inner.handle?.status() ?? ("running" as const),
      inspect: () => inner.handle?.inspect(),
    });
  }

  /**
   * Load-once seeded session state. The FIRST turn that runs with empty in-memory
   * history calls `loadHistory(sessionId)` exactly once — including when the loader
   * resolves empty (the latch latches on resolution, not on content) — and the
   * result seeds the engine's full state. Later turns never reload: after the first
   * resolution the engine's in-memory state is authoritative.
   *
   * Load failures are NOT a swallow-site (only persist/publish are): a rejecting
   * loader propagates to the turn caller.
   */
  async #resolveLoadedHistory(): Promise<void> {
    const load = this.#deps.loadHistory;
    if (!load || this.#loaded || this.#history.length > 0) return;
    const loaded = await load(this.#sessionId);
    this.#loaded = true;
    this.#history = [...loaded];
  }

  /**
   * Resolve the windowed history copy handed to the path calls (`complete` /
   * `runTask`). Composes the existing `gateway-context-formatting` helpers — the
   * engine never re-derives the trim math on its own.
   *
   * Plain path: {@link applyHistoryWindow} drop-oldest result under the engine's
   * caps (default 40 turns / 8k chars). Splice path: when `onOverflow` is wired AND
   * turns would drop, {@link applyHistoryWindowWithOverflow} folds the dropped
   * prefix into ONE synthetic assistant "Summary of earlier conversation:" turn
   * leading the copy. The handler owns summary content; a rejecting or throwing
   * handler propagates to the turn caller (Review Focus #3 — swallowing would
   * silently discard conversation context).
   *
   * Engine state is NEVER modified here: recording, publish payloads, and
   * persistence always run on the FULL unwindowed state. Note: the splice helper
   * re-trims at the module-default 40/8k internally, which is byte-identical under
   * the engine's default caps; a custom-caps + `onOverflow` host gets the default
   * trim over that splice copy (documented divergence; no current host pins both).
   */
  async #historyForPath(): Promise<ChatMessage[]> {
    const windowed = applyHistoryWindow(this.#history, this.#maxWindowTurns, this.#maxWindowChars);
    const overflow = this.#onOverflow;
    if (!overflow || windowed.length >= this.#history.length) return windowed;
    return applyHistoryWindowWithOverflow(this.#history, overflow);
  }

  /**
   * Record the symmetric user + assistant turns for one completed path call.
   * User content is `recordUserText ?? message` (gateway enriched-instruction
   * case records the raw user text, not the sent instruction).
   */
  #recordBothTurns(userContent: string, assistantContent: string): void {
    this.#history.push({ role: "user", content: userContent, timestamp: Date.now() });
    this.#history.push({ role: "assistant", content: assistantContent, timestamp: Date.now() });
  }

  /**
   * Assemble the {@link ChatReply} for a tool-path result, byte-parity with the
   * mapping `agent.chat()`'s tool path uses today (reactive-agent.ts `chat()`):
   * `toolsUsed` from `metadata.toolCalls` with `debrief.toolsUsed` fallback,
   * `tokens`, `steps`, `cost`, `reasoningSteps`, `scratchpad`, and
   * `citationCheck` when `verifyCitations` is requested.
   */
  #assembleToolReply(result: AgentResult, options: TurnOptions): ChatReply {
    // toolsUsed is memory-gated on `result.debrief` (only populated when
    // `.withMemory()` is on — see debrief-synthesis.ts `shouldFinalize`).
    // `metadata.toolCalls` is derived from reasoningSteps unconditionally,
    // so it stays the primary source; debrief is only a fallback for any
    // path that doesn't populate it.
    const toolNamesFromMetadata = result.metadata.toolCalls?.map((t) => t.name);
    const toolsUsed =
      toolNamesFromMetadata && toolNamesFromMetadata.length > 0
        ? [...new Set(toolNamesFromMetadata)]
        : result.debrief?.toolsUsed.map((t) => t.name);
    const hostScratchpad = this.#deps.scratchpadEntries?.() ?? {};
    const scratchpad = { ...(result.metadata.scratchpad ?? {}), ...hostScratchpad };
    const citationCheck = options.verifyCitations
      ? validateCitations(
          result.output,
          (result.metadata.reasoningSteps ?? []) as readonly ReasoningStep[],
          new Map(Object.entries(scratchpad)),
        )
      : undefined;
    return {
      message: result.output,
      toolsUsed,
      tokens: result.metadata.tokensUsed,
      steps: result.metadata.stepsCount,
      cost: result.metadata.cost,
      reasoningSteps: result.metadata.reasoningSteps,
      scratchpad,
      ...(citationCheck ? { citationCheck } : {}),
    };
  }

  /**
   * Publish one user + one assistant {@link ChatTurnEvent} through the host's
   * `publishTurn` capability. Event shape mirrors `chat.ts:buildChatTurnEvents`
   * (the current publish closure contents): `_tag`, `taskId`, `sessionId`
   * (canonical engine session id), `routedVia` naming the path, role-tagged
   * pair, and `tokensUsed` on the assistant turn when known.
   *
   * Swallow-site: publish failures are telemetry-quality — never turn-fatal.
   * Errors surface as an `ErrorSwallowed` event with site tag
   * `chat/engine.ts:publishTurn`.
   */
  async #publishTurns(
    taskId: string,
    routedVia: "direct-llm" | "react-loop",
    userMessage: string,
    assistantMessage: string,
    tokensUsed?: number,
  ): Promise<void> {
    const publish = this.#deps.publishTurn;
    if (!publish) return;
    const base = {
      _tag: "ChatTurn" as const,
      taskId,
      sessionId: this.#sessionId,
      routedVia,
    };
    const events: ChatTurnEvent[] = [
      { ...base, role: "user", content: userMessage },
      {
        ...base,
        role: "assistant",
        content: assistantMessage,
        ...(tokensUsed !== undefined ? { tokensUsed } : {}),
      },
    ];
    for (const event of events) {
      try {
        await publish(event);
      } catch (err) {
        swallowError(err, "chat/engine.ts:publishTurn");
      }
    }
  }

  /**
   * Persist the FULL post-turn history through the host's `saveHistory`
   * capability. Swallow-site: persistence failures are telemetry-quality and
   * never fail the turn — they surface as an `ErrorSwallowed` event with site
   * tag `chat/engine.ts:saveHistory`.
   */
  async #persistHistory(): Promise<void> {
    const save = this.#deps.saveHistory;
    if (!save) return;
    try {
      await save(this.#sessionId, [...this.#history]);
    } catch (err) {
      swallowError(err, "chat/engine.ts:saveHistory");
    }
  }

  /**
   * Compose the direct-path system prompt for one turn.
   *
   * Wired persona: `[systemPrompt(message), contextSummary(message), extraContext]`
   * joined by `---` separators, empty fragments skipped, in that order. No
   * `systemPrompt` capability: the engine falls back to the exact generic
   * conversational prompt `direct path` composes today (with-context vs bare variants),
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
 * same role `budgetTokens: 1024` played inside `direct path` before the fold.
 */
export function resolveDirectBudget(options?: Pick<ChatEngineOptions, "maxDirectTokens">): number {
  return options?.maxDirectTokens ?? DEFAULT_MAX_DIRECT_TOKENS;
}
