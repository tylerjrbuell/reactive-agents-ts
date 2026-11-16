import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { AgentResult } from "../builder/types.js";
import type { ChatModeChangedEvent, ChatTurnEvent, EnvironmentChangedEvent, RunOrigin } from "@reactive-agents/core";
import type { ChatMessage, ChatOptions, ChatReply } from "../chat.js";
import type { RunHandle } from "../run-controller.js";
import type { AgentStreamEvent, StreamDensity } from "../stream-types.js";
import { applyHistoryWindow, applyHistoryWindowWithOverflow, type HistoryOverflowHandler } from "../gateway-context-formatting.js";
import { workspaceCarry, type WorkspaceOption } from "../engine/start-run.js";
import { assistantTurnOf, healShapedAssistantTurns, recordedTurnPair, type AssistantTurn } from "./history-hygiene.js";
import { assembleToolReply } from "./tool-reply.js";
import { taskInputHasMedia, taskInputText, type TaskInput } from "../agent/task-input.js";
import { lastRunContextOf } from "./last-run-context.js";
import { EnvironmentTracker, type EnvironmentSeedOption, type EnvironmentSnapshotInput, type EnvironmentUpdateOption } from "./environment-snapshot.js";
import { ChatEngineCapabilityError } from "./engine-errors.js";
import { TurnGate } from "./turn-gate.js";
import { turnPosture, announceModeChange, DEFAULT_CHAT_MODE, type ChatMode } from "./session-mode.js";
import { TodoCarry, planPosture, originCarry, type OriginOption, type PostureOption, type TodoSeedItem, type TodoSeedOption } from "./todo-seed.js";

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
 *   (persona resolution) and `contextSummary` (static grounding block).
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
  readonly runTask?: (input: TaskInput, opts: {
    history: readonly ChatMessage[];
    maxIterations?: number;
  } & EnvironmentUpdateOption & PostureOption & OriginOption & WorkspaceOption & Pick<ChatOptions, "skills">) => Promise<AgentResult>;
  /**
   * Agentic streaming. Backed by the host's `ReactiveAgent.runStream()`. Required by
   * `streamTurn()`; absent ⇒ typed capability rejection (Task 4).
   */
  readonly runStreamTask?: (input: TaskInput, opts: {
    history: readonly ChatMessage[];
    density?: StreamDensity;
    signal?: AbortSignal;
  } & TodoSeedOption & EnvironmentUpdateOption & PostureOption & OriginOption & WorkspaceOption & Pick<ChatOptions, "skills">) => RunHandle;
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
  }) => Promise<{ message: string; tokens?: number; inputTokens?: number; outputTokens?: number; cost?: number }>;
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
   * Static grounding (build-time taskContext) for the direct-path prompt. Never run
   * results: the engine keeps this session's own last tool-turn results itself.
   */
  readonly contextSummary?: (message: string) => string;
  readonly scratchpadEntries?: () => Readonly<Record<string, string>>;
  /** Default routing when a turn's `useTools` is unset: true takes the tool path. Absent ⇒ direct. */
  readonly toolIntent?: (message: string) => boolean;
  /** Live environment facts (model, tools, skills, docs, goal...). Absent ⇒ no environment updates. */
  readonly environment?: () => EnvironmentSnapshotInput;
  /** `EnvironmentChanged` publication port (swallow-site). */
  readonly publishEnvironment?: (event: EnvironmentChangedEvent) => Promise<void>;
  /** `ChatModeChanged` publication port (swallow-site): one event per actual `setMode` change. */
  readonly publishMode?: (event: ChatModeChangedEvent) => Promise<void>;
}

/**
 * Engine options. Every field a host may pin (canonically all optional); every omitted
 * field falls back to the engine's own default (spec A7 inheritance law).
 */
export interface ChatEngineOptions extends EnvironmentSeedOption {
  /**
   * Canonical session id, `sess_<scope>_<unique>` (`agent | session | gateway` scope).
   * Hosts generate via the engine module's id helper (Task 3) rather than pinning
   * legacy literal formats.
   */
  readonly sessionId: string; readonly origin?: RunOrigin; // origin: session default for run-started.origin; per-turn wins
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
  /** The conversation's persisted to-do list; every `streamTurn()` starts from the latest list. */
  readonly initialTodo?: readonly TodoSeedItem[];
  /** Tell the model what changed since its last turn (needs `environment`). Default true; `false` opts out. */
  readonly environmentUpdates?: boolean;
  /** Mode the session starts in. Default `"execute"`. */
  readonly mode?: ChatMode;
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

/** Keep only non-empty prompt fragments. */
const isNonEmpty = (part: string | undefined): part is string =>
  typeof part === "string" && part.length > 0;

/** Join non-empty prompt fragments with the `---` separator (parity: `"\n\n---\n\n"`). */
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

export { nextSessionId } from "./session-id.js";

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
  #maxDirectTokens: number; readonly #origin: RunOrigin | undefined;
  /** In-memory session state, oldest first, symmetric user + assistant turns. */
  #history: ChatMessage[] = [];
  /** Serializes turns: concurrent turn()/streamTurn() calls queue FIFO instead of interleaving history. */
  readonly #gate = new TurnGate();
  /**
   * Load-once latch (Task 3): set after the first turn resolves `loadHistory` —
   * including when the loader resolves empty — so the loader is ever called
   * exactly once per engine lifetime.
   */
  #loaded = false;
  readonly #todo: TodoCarry;
  /** This session's latest tool-turn results, for its own direct (tools-off) turns only. Never shared across sessions. */
  #lastRunContext = "";
  readonly #env: EnvironmentTracker; #mode: ChatMode;

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
    this.#onOverflow = options?.onOverflow; this.#origin = options?.origin;
    this.#maxDirectTokens = options?.maxDirectTokens ?? DEFAULT_MAX_DIRECT_TOKENS;
    const initialHistory = options?.initialHistory ?? [];
    this.#history = [...healShapedAssistantTurns(initialHistory)];
    // Load-once latch: a non-empty seed means the loader NEVER runs.
    this.#loaded = initialHistory.length > 0;
    this.#todo = new TodoCarry(options?.initialTodo); this.#mode = options?.mode ?? DEFAULT_CHAT_MODE;
    this.#env = new EnvironmentTracker(this.#sessionId, {
      ...deps, onPublishError: (err) => swallowError(err, "chat/engine.ts:publishEnvironment"),
    }, options?.environmentUpdates !== false, options?.initialEnvironment);
  }

  /** The session mode; each turn runs under its posture unless the turn sets one. */
  mode(): ChatMode { return this.#mode; }
  /** Switch the mode for later turns (in-flight turn keeps its mode); publishes `ChatModeChanged` on change. */
  setMode(mode: ChatMode): void { const from = this.#mode; this.#mode = mode; announceModeChange(this.#deps.publishMode, this.#sessionId, from, mode, (e) => swallowError(e, "chat/engine.ts:publishMode")); }

  /** The conversation's latest to-do list, as of the last completed `streamTurn()` event. */
  todo(): readonly TodoSeedItem[] {
    return this.#todo.items;
  }

  /**
   * Buffered conversational turn — the single entry point for `agent.chat`,
   * `session.chat`, and the gateway chat surface.
   *
   * Routing: `options.useTools ?? toolIntent(message) ?? false`; `toolIntent` is the
   * host's capability (the engine itself never classifies).
   *
   * Direct path: composes the system prompt from the host's `systemPrompt` /
   * `contextSummary` capabilities plus the turn's `extraContext` (empty fragments
   * skipped, joined by `---`); with no `systemPrompt` capability it falls back to a
   * generic conversational prompt, never a blank one. Sends history + the message to
   * `complete` with the engine-resolved `budgetTokens`, then records the user turn
   * (`recordUserText ?? message`) and the assistant turn.
   *
   * Tool path: requires `runTask` — typed {@link ChatEngineCapabilityError}
   * rejection otherwise, never a silent fallback onto the direct path. `runTask` gets
   * the raw input (same as `streamTurn`); the RAW prior turn list rides `opts.history`.
   * The reply keeps `agent.chat()`'s tool-path field mapping (`toolsUsed`, `tokens`,
   * `steps`, `cost`, `reasoningSteps`, `scratchpad`, `citationCheck`).
   *
   * Serialized per engine: concurrent calls queue FIFO behind one gate; a failed turn
   * releases it. Both paths record symmetric turns, publish a user+assistant `ChatTurn`
   * pair via `publishTurn` when wired, and persist via `saveHistory` when wired
   * (swallow-sites: a failure never fails the turn; it surfaces as `ErrorSwallowed`).
   *
   * History resolution precedes routing: the first turn with empty in-memory state
   * loads the persisted session exactly once via `loadHistory` (even when it resolves
   * empty). The path calls get the windowed copy ({@link #historyForPath}); recording,
   * publishing and persistence always run on the FULL unwindowed state.
   */
  turn(input: TaskInput, options?: TurnOptions): Promise<ChatReply> {
    return this.#gate.run(() => this.#turn(input, options));
  }

  async #turn(input: TaskInput, options?: TurnOptions): Promise<ChatReply> {
    const message = taskInputText(input);
    await this.#resolveLoadedHistory();
    const environmentUpdate = await this.#env.begin();
    if ((options?.useTools ?? this.#deps.toolIntent?.(message)) === true || taskInputHasMedia(input)) {
      if (!this.#deps.runTask) {
        throw new ChatEngineCapabilityError({
          message:
            "ChatEngine.turn() requested the tool path (`useTools: true`) but no `runTask` capability is wired on this engine — wire `runTask` (e.g. backed by `ReactiveAgent.run()`) to enable tool-capable chat.",
          capability: "runTask",
        });
      }
      const history = await this.#historyForPath();
      // Raw input, exactly what streamTurn sends: no prior-run block rides the task.
      const result = await this.#deps.runTask(input, {
        history,
        maxIterations: options?.maxIterations,
        ...(environmentUpdate ? { environmentUpdate } : {}), ...planPosture(turnPosture(this.#mode, options?.posture)), ...originCarry(options?.origin ?? this.#origin),
        ...workspaceCarry(options?.workspace), ...(options?.skills ? { skills: options.skills } : {}),
      });
      const reply = assembleToolReply(result, options ?? {}, this.#deps.scratchpadEntries?.() ?? {});
      const userText = options?.recordUserText ?? message, assistant = assistantTurnOf(result);
      this.#lastRunContext = lastRunContextOf(result.debrief, result.metadata);
      this.#recordBothTurns(userText, assistant);
      await this.#publishTurns(result.taskId, "react-loop", userText, assistant, result.metadata.tokensUsed);
      await this.#persistHistory();
      this.#env.commit();
      return reply;
    }

    const history = await this.#historyForPath();
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: message },
    ];
    const systemPrompt = this.#directSystemPrompt(message, [options?.extraContext, environmentUpdate].filter(isNonEmpty).join("\n\n"));
    const reply = await this.#deps.complete({
      messages,
      systemPrompt,
      budgetTokens: this.#maxDirectTokens,
    });
    // Symmetric recording: user turn first (recordUserText ?? message), then the
    // assistant turn after the reply resolves.
    const userText = options?.recordUserText ?? message;
    this.#recordBothTurns(userText, reply.message);
    await this.#publishTurns("chat", "direct-llm", userText, { content: reply.message }, reply.tokens);
    await this.#persistHistory();
    this.#env.commit();
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
   * History resolution mirrors {@link turn()}: load-once seeding, then the windowed
   * copy goes to `runStreamTask`; the FULL unwindowed state owns recording and persistence.
   *
   * Returns a wrapper {@link RunHandle} that tees the inner handle's
   * {@link AgentStreamEvent}s unaltered. Recording happens at TERMINAL-EVENT
   * OBSERVATION, BEFORE the terminal event is yielded: on `StreamCompleted` the
   * symmetric user (`recordUserText ?? message`) + assistant turns are recorded, the
   * `ChatTurn` pair is published (`routedVia: "react-loop"`) and the FULL state
   * persisted (swallow-sites as in `turn()`), so a consumer that closes the stream
   * right after `StreamCompleted` cannot drop the turn and one iterating past it
   * records once. On `StreamError` or a cancelled stream NOTHING is recorded. A run
   * that completes FAILED (`success: false`, not paused) is recorded as a failed turn,
   * here and in `turn()`: the assistant row is
   * `[previous run failed: <cause>; no answer was given]` with `failed: true` and
   * `error` (see `ChatMessage.failed`), never the run's output; the published ChatTurn
   * carries the same note plus `failed: true` and `error`.
   *
   * The `RunHandle` verbs delegate to the inner `runStreamTask` handle, lazily bound at
   * first iteration: before that they no-op (`status()` is `"running"`, `inspect()` is
   * `undefined`).
   *
   * Serialized with `turn()` per engine: iteration takes the turn gate and holds it to
   * stream end (or early `return()`), so a concurrent turn queues behind a live stream.
   *
   * @param options per-turn options; `recordUserText`, `density`, `signal` forward as in `turn()`.
   * @returns a wrapper RunHandle streaming `AgentStreamEvent`s unaltered.
   * @throws ChatEngineCapabilityError when `runStreamTask` is not wired.
   */
  streamTurn(input: TaskInput, options?: TurnOptions): RunHandle {
    /** `runStreamTask` re-bound after the guard (TS drops optional-capability narrowing inside the generator closure below). */
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
    const userText = options?.recordUserText ?? taskInputText(input);
    /**
     * Lazily-bound inner handle. Created when the wrapper generator starts
     * iterating (history resolution is async, so `runStreamTask` cannot be
     * called synchronously); verbs consult it through this holder.
     */
    const inner: { handle?: RunHandle } = {};
    async function* teeTurn(): AsyncGenerator<AgentStreamEvent> {
      await engine.#gate.acquire(); // held to stream end: history read .. terminal record is one critical section
      try { yield* locked(); } finally { engine.#gate.release(); }
    }
    async function* locked(): AsyncGenerator<AgentStreamEvent> {
      await engine.#resolveLoadedHistory();
      const history = await engine.#historyForPath();
      const environmentUpdate = await engine.#env.begin();
      const handle = streamTask(input, {
        history,
        ...(environmentUpdate ? { environmentUpdate } : {}), ...planPosture(turnPosture(engine.#mode, options?.posture)), ...originCarry(options?.origin ?? engine.#origin),
        density: options?.density,
        signal: options?.signal, ...workspaceCarry(options?.workspace), ...(options?.skills ? { skills: options.skills } : {}),
        ...(engine.#todo.items.length > 0 ? { initialTodo: engine.#todo.items } : {}),
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
        engine.#todo.observe(event);
        if (event._tag === "StreamCompleted" && !recorded) {
          recorded = true;
          engine.#lastRunContext = lastRunContextOf(undefined, event.metadata);
          const assistant = assistantTurnOf(event);
          engine.#recordBothTurns(userText, assistant);
          await engine.#publishTurns(event.taskId ?? "stream", "react-loop", userText, assistant, event.metadata?.tokensUsed);
          await engine.#persistHistory();
          engine.#env.commit();
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
    this.#history = [...healShapedAssistantTurns(loaded)];
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
  #recordBothTurns(userContent: string, assistant: string | AssistantTurn): void {
    this.#history.push(...recordedTurnPair(userContent, assistant));
  }

  /**
   * Publish one user + one assistant {@link ChatTurnEvent} through the host's
   * `publishTurn` capability. Event shape mirrors `chat.ts:buildChatTurnEvents`
   * (the current publish closure contents): `_tag`, `taskId`, `sessionId`
   * (canonical engine session id), `routedVia` naming the path, role-tagged
   * pair, and `tokensUsed` on the assistant turn when known. A failed run's
   * assistant turn also carries `failed: true` and `error` (its cause).
   *
   * Swallow-site: publish failures are telemetry-quality — never turn-fatal.
   * Errors surface as an `ErrorSwallowed` event with site tag
   * `chat/engine.ts:publishTurn`.
   */
  async #publishTurns(taskId: string, routedVia: "direct-llm" | "react-loop", userMessage: string, assistant: AssistantTurn, tokensUsed?: number): Promise<void> {
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
        content: assistant.content,
        ...(tokensUsed !== undefined ? { tokensUsed } : {}),
        ...(assistant.failed ? { failed: true, ...(assistant.error !== undefined ? { error: assistant.error } : {}) } : {}),
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
    const contextSummary = [this.#deps.contextSummary?.(message), this.#lastRunContext].filter(isNonEmpty).join(DIRECT_PROMPT_SEPARATOR);
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
