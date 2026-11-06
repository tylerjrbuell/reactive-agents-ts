import { chatEnvironmentSnapshot, countTodoEdits } from "./chat-environment.js";
import type { EnvironmentSnapshotInput } from "./chat-environment.js";
import { SessionDocumentCache, type DocumentFetcher, type DocumentIngestFailure } from "./chat-document-cache.js";
import type { Database } from "bun:sqlite";
import { generateTaskId, type RunPosture } from "@reactive-agents/core";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { AgentSession, type ChatMessage, type ChatOptions, type AgentStreamEvent } from "@reactive-agents/runtime";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  appendChatTurn,
  type StoredContext,
  getChatSessionTotals,
  type ChatSessionTotals,
  getChatTurns,
  updateSessionLastUsed,
  renameSession as renameChatSessionInDb,
  updateSessionAgentConfig,
  type ChatSessionRow,
  type ChatTurnRow,
  rewindChatTurns,
  editCompactionSummary,
  clearChatTurns,
  copyChatTurns,
  compactableTurns,
  compactChatTurns,
  countChatExchanges,
  rotateStableAgentId,
  getChatTodo,
  setChatTodo,
  type StoredTodoItem,
} from "../db/chat-queries.js";
import {
  mergeCortexAllowedTools,
  coerceTaskContextRecord,
  normalizeCortexAgentConfig,
  parseCortexShellOptions,
  parseDocumentSpecs,
} from "./cortex-agent-config.js";
import { detectToolCallShape } from "@reactive-agents/tools";
import { Effect, type Layer } from "effect";
import { traceDirs } from "./run-trace-file.js";
import { turnEvidenceOf, type TurnEvidence } from "./chat-turn-evidence.js";
import { buildCortexAgent } from "./build-cortex-agent.js";
import { UTILITY_AGENT_PARAMS, utilityOutput, utilityPrompt } from "./utility-agent.js";
import { attachChatIngest, type ChatIngestSink } from "./chat-ingest.js";
import { CortexIngestService } from "./ingest-service.js";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";
import { buildRunTaskContext } from "./chat-run-context.js";
import { getMcpServersByIds, parseMcpConfig } from "../db/mcp-queries.js";
import { chatToolParams, resolveEnableTools } from "./chat-tool-params.js";
import { DEFAULT_CHAT_NAME, cleanChatTitle, fallbackChatTitle } from "./chat-title.js";
import { turnCostOf, type TurnCost } from "./chat-turn-cost.js";
import {
  TurnTraceRecorder,
  turnOutcomeOf,
  withTurnOutcome,
  type StoredTurnOutcome,
  type StoredTurnTrace,
} from "./chat-turn-trace.js";
import { makeSessionControlTool, SESSION_CONTROL_SYSTEM_LINE } from "./session-control-tool.js";
import type { SessionControlPort } from "./chat-proposal-service.js";

const VALID_REASONING_STRATEGIES = new Set([
  "reactive",
  "plan-execute-reflect",
  "tree-of-thought",
  "reflexion",
  "adaptive",
  "blueprint",
  "code-action",
  "direct",
]);

/** Iteration cap for a tool-using chat turn when the session sets none (see buildChatAgentParams). */
export const CHAT_DEFAULT_MAX_ITERATIONS = 16;

const DEFAULT_TOOL_CHAT_PERSONA: NonNullable<BuildCortexAgentParams["persona"]> = {
  enabled: true,
  role: "Tool-first problem solver",
  tone: "technical",
  traits:
    "Think step-by-step, then call tools immediately when needed. Avoid repeating the same thought without acting. Prefer clear tool calls with exact schema parameter names.",
  responseStyle: "structured",
};

/**
 * True when an assistant reply is a failed tool call emitted as text (raw call JSON / dialect
 * markers). Structural check only (no tool catalog): such text must never become history.
 */
function isShapedAssistantReply(content: string): boolean {
  return detectToolCallShape(content, []).shaped;
}

/**
 * Model-visible history from stored rows. A shaped assistant row is excluded together with the
 * user row it answered, so user/assistant alternation stays intact. Stored rows are untouched
 * (the UI may still show them); this heals already-contaminated DBs on the next agent rebuild.
 */
export function turnsToChatMessages(turns: ChatTurnRow[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const t of turns) {
    if (t.role === "assistant" && isShapedAssistantReply(t.content)) {
      if (out.length > 0 && out[out.length - 1]!.role === "user") out.pop();
      continue;
    }
    out.push({ role: t.role, content: t.content, timestamp: t.ts });
  }
  return out;
}

const TODO_MAX_ITEMS = 100;
const TODO_STATUS_SET: ReadonlySet<string> = new Set(["pending", "in_progress", "completed"]);

/** Validate + normalise a user-supplied to-do list: stable unique ids, non-empty titles, known statuses. */
function validateTodo(items: readonly StoredTodoItem[]): StoredTodoItem[] {
  if (!Array.isArray(items) || items.length > TODO_MAX_ITEMS) throw new Error("Invalid to-do list");
  const seen = new Set<string>();
  return items.map((it) => {
    const id = typeof it?.id === "string" ? it.id.trim() : "";
    const title = typeof it?.title === "string" ? it.title.trim() : "";
    if (!id || !title || !TODO_STATUS_SET.has(it.status) || seen.has(id)) throw new Error("Invalid to-do list item");
    seen.add(id);
    return { id, title, status: it.status };
  });
}

export type CortexChatResult = {
  reply: string;
  tokensUsed: number;
  toolsUsed?: string[];
  steps?: number;
  cost?: number;
  /** Tool-result and checklist evidence this turn produced; absent on paths that cannot observe it. */
  evidence?: TurnEvidence;
};

export interface CachedChatSession {
  readonly session: AgentSession;
  readonly agent: { dispose: () => Promise<void> };
  /** Detaches the in-process ingest subscription (see `chat-ingest.ts`). */
  readonly unsubscribe?: () => void;
}

/** Dispose a cached chat agent (tears down MCP containers); never throws. */
export async function disposeCachedSession(entry: CachedChatSession): Promise<void> {
  try {
    entry.unsubscribe?.();
    await entry.agent.dispose();
  } catch {
    /* best-effort: a dispose failure must not block config update / delete */
  }
}

/** Thrown when a turn is submitted while another turn on the same session is still running. */
/** The provider/model a turn ran on, from the session config the agent was built with. */
const producedBy = (cfg: Record<string, unknown>): { provider: string; model: string } | undefined =>
  typeof cfg.provider === "string" && cfg.provider !== "" && typeof cfg.model === "string" && cfg.model !== ""
    ? { provider: cfg.provider, model: cfg.model }
    : undefined;

export class ChatSessionBusyError extends Error {
  constructor(sessionId: string) {
    super(`Chat session ${sessionId} is busy: a turn is already in flight`);
    this.name = "ChatSessionBusyError";
  }
}

/** Default cap on live cached chat agents (each can hold MCP containers + a memory DB). */
const DEFAULT_MAX_CACHED_SESSIONS = 8;

function resolveMaxCachedSessions(): number {
  const n = Number(process.env.CORTEX_CHAT_MAX_SESSIONS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CACHED_SESSIONS;
}

export class ChatSessionService {
  private readonly db: Database;
  private readonly maxCachedSessions: number;
  /** In-process ingest sink; chat agents report here when the server wires an `ingestLayer`. */
  private readonly ingestLayer: Layer.Layer<CortexIngestService> | undefined;
  private ingestSink: Promise<ChatIngestSink> | undefined;
  /**
   * In-memory LRU cache of live agent sessions keyed by Cortex session ID.
   * Map insertion order is recency order: `getOrBuildSession` re-inserts on use.
   */
  private readonly sessions = new Map<string, CachedChatSession>();
  /** Single-flight builds so two concurrent first turns never build (and leak) two agents. */
  private readonly building = new Map<string, Promise<CachedChatSession>>();
  /** Session ids with a turn in flight — concurrent turns would interleave engine history. */
  private readonly inFlight = new Set<string>();
  /** Per-session `/docs` URL cache + ingest-failure record (D-2026-10-28-DOC-FETCH). */
  private readonly documents: SessionDocumentCache;

  /** Summarises old turns for `compact`. Injectable so tests need no live model. */
  private readonly summarizer: (turns: ReadonlyArray<{ role: string; content: string }>, cfg: Record<string, unknown>) => Promise<string>;

  /** Writes a short title from the first exchange. Injectable so tests need no live model. */
  private readonly titler: (userMessage: string, reply: string, cfg: Record<string, unknown>) => Promise<string>;

  constructor(
    db: Database,
    opts?: {
      readonly maxCachedSessions?: number;
      /** Same ingest layer Lab and gateway runs use; chat agents (and their sub-agents) feed it in-process. */
      readonly ingestLayer?: Layer.Layer<CortexIngestService>;
      /** Document fetch seam for tests; defaults to the runtime's SSRF-guarded fetch. */
      readonly fetchDocument?: DocumentFetcher;
      readonly title?: (userMessage: string, reply: string, cfg: Record<string, unknown>) => Promise<string>;
      readonly summarize?: (turns: ReadonlyArray<{ role: string; content: string }>, cfg: Record<string, unknown>) => Promise<string>;
    },
  ) {
    this.db = db;
    this.ingestLayer = opts?.ingestLayer;
    this.documents = new SessionDocumentCache(opts?.fetchDocument);
    this.titler = opts?.title ?? ((u, r, cfg) => this.titleWithAgent(u, r, cfg));
    this.summarizer = opts?.summarize ?? ((turns, cfg) => this.summarizeWithAgent(turns, cfg));
    this.maxCachedSessions = opts?.maxCachedSessions ?? resolveMaxCachedSessions();
  }

  /** Dispose every cached agent (server shutdown). Never throws. */
  async disposeAll(): Promise<void> {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(entries.map(disposeCachedSession));
  }

  /** Per-session environment baseline (last snapshot the engine read). Survives engine eviction so a rebuild still diffs. */
  private readonly envBaselines = new Map<string, EnvironmentSnapshotInput>();
  /** Per-session cumulative USER to-do edits (agent edits never pass through `setTodo`). */
  private readonly todoEdits = new Map<string, { added: number; removed: number }>();
  private goalSource: ((sessionId: string) => { status: string; objective?: string } | null) | undefined;

  /** Goal-status port for environment notices; set once at startup (the goal service needs this service). */
  attachGoalSource(source: (sessionId: string) => { status: string; objective?: string } | null): void {
    this.goalSource = source;
  }

  /** Proposal port behind the `session-control` tool; set once at startup (the proposal service needs this service, so it cannot be a constructor arg). */
  private sessionControl: SessionControlPort | undefined;

  /** Enable `agentControl` sessions: the tool is registered only when this port is attached AND the session opts in. */
  attachSessionControl(port: SessionControlPort): void {
    this.sessionControl = port;
  }

  /** True while a turn is in flight for the session. */
  isBusy(sessionId: string): boolean {
    return this.inFlight.has(sessionId);
  }

  private acquireTurn(sessionId: string): () => void {
    if (this.inFlight.has(sessionId)) throw new ChatSessionBusyError(sessionId);
    this.inFlight.add(sessionId);
    return () => {
      this.inFlight.delete(sessionId);
    };
  }

  private async getOrBuildSession(
    sessionId: string,
    cfg: Record<string, unknown>,
    stableAgentId: string | undefined,
  ): Promise<CachedChatSession> {
    const cached = this.sessions.get(sessionId);
    if (cached) {
      this.sessions.delete(sessionId);
      this.sessions.set(sessionId, cached);
      return cached;
    }
    let pending = this.building.get(sessionId);
    if (!pending) {
      pending = this.buildSession(sessionId, cfg, stableAgentId)
        .then(async (built) => {
          this.sessions.set(sessionId, built);
          await this.evictOverflow(sessionId);
          return built;
        })
        .finally(() => this.building.delete(sessionId));
      this.building.set(sessionId, pending);
    }
    return pending;
  }

  /** Evict least-recently-used idle sessions beyond the cap (never the one just used). */
  private async evictOverflow(keep: string): Promise<void> {
    for (const [id, entry] of this.sessions) {
      if (this.sessions.size <= this.maxCachedSessions) return;
      if (id === keep || this.inFlight.has(id)) continue;
      this.sessions.delete(id);
      await disposeCachedSession(entry);
    }
  }

  async createSession(opts: {
    name?: string;
    agentConfig: Record<string, unknown>;
    seedTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<string> {
    const stableAgentId = generateTaskId();
    const normalizedAgentConfig = normalizeCortexAgentConfig(opts.agentConfig);
    const sessionId = await createChatSession(this.db, { ...opts, agentConfig: normalizedAgentConfig, stableAgentId });
    if (opts.seedTurns?.length) {
      for (const turn of opts.seedTurns) {
        appendChatTurn(this.db, { sessionId, role: turn.role, content: turn.content, tokensUsed: 0 });
      }
    }
    return sessionId;
  }

  listSessions(): ChatSessionRow[] {
    return listChatSessions(this.db);
  }

  getSession(
    sessionId: string,
  ): (ChatSessionRow & {
    turns: ChatTurnRow[];
    totals: ChatSessionTotals;
    todo: StoredTodoItem[];
    /** Document sources that failed to load on the latest agent build. */
    documentFailures: DocumentIngestFailure[];
  }) | null {
    const session = getChatSession(this.db, sessionId);
    if (!session) return null;
    const turns = getChatTurns(this.db, sessionId);
    return { ...session, turns, totals: getChatSessionTotals(this.db, sessionId), todo: getChatTodo(this.db, sessionId), documentFailures: this.documents.failures(sessionId) };
  }

  /**
   * Replace the conversation's to-do list (user edit). Runs under the turn guard and evicts
   * the cached engine so the next turn is rebuilt and seeded from the edited list.
   */
  async setTodo(sessionId: string, items: readonly StoredTodoItem[]): Promise<StoredTodoItem[]> {
    const clean = validateTodo(items);
    await this.mutateHistory(sessionId, () => {
      const edits = countTodoEdits(getChatTodo(this.db, sessionId), clean);
      const prev = this.todoEdits.get(sessionId) ?? { added: 0, removed: 0 };
      this.todoEdits.set(sessionId, { added: prev.added + edits.added, removed: prev.removed + edits.removed });
      setChatTodo(this.db, sessionId, clean);
    });
    return clean;
  }


  // ─── Chat utilities: rewind / clear / fork / compact ───────────────────────
  // Every history mutation runs under the turn guard (no mutation mid-stream) and
  // evicts the cached engine session so it rebuilds from the DB — the DB is the
  // single source of truth for history.

  private async evictSession(sessionId: string): Promise<void> {
    const cached = this.sessions.get(sessionId);
    if (!cached) return;
    this.sessions.delete(sessionId);
    await disposeCachedSession(cached);
  }

  private async mutateHistory<T>(sessionId: string, fn: () => T): Promise<T> {
    if (!getChatSession(this.db, sessionId)) throw new Error(`Chat session ${sessionId} not found`);
    const release = this.acquireTurn(sessionId);
    try {
      const out = fn();
      await this.evictSession(sessionId);
      return out;
    } finally {
      release();
    }
  }

  /**
   * Replace a compaction summary with the user's own wording. The agent is rebuilt
   * from history, so the next turn carries the edited text forward.
   */
  async editSummary(sessionId: string, turnId: number, content: string): Promise<void> {
    const text = content.trim();
    if (text.length === 0) throw new Error("Summary cannot be empty");
    const ok = await this.mutateHistory(sessionId, () => editCompactionSummary(this.db, sessionId, turnId, text));
    if (!ok) throw new Error(`Summary ${turnId} not found in session ${sessionId}`);
  }

  /** Delete the exchange containing `turnId` and everything after it. Returns the removed user message (for edit / rerun). */
  async rewind(sessionId: string, turnId: number): Promise<{ removed: number; userMessage: string }> {
    const out = await this.mutateHistory(sessionId, () => rewindChatTurns(this.db, sessionId, turnId));
    if (!out) throw new Error(`Turn ${turnId} not found in session ${sessionId}`);
    updateSessionLastUsed(this.db, sessionId);
    return out;
  }

  /**
   * Clear the conversation (keeps the session + config). Also rotates the agent
   * identity: memory is keyed on it, so a cleared chat must not recall the
   * conversation it just dropped.
   */
  async clear(sessionId: string): Promise<{ removed: number }> {
    const removed = await this.mutateHistory(sessionId, () => {
      rotateStableAgentId(this.db, sessionId, generateTaskId());
      setChatTodo(this.db, sessionId, []);
      return clearChatTurns(this.db, sessionId);
    });
    return { removed };
  }

  /**
   * Fork into a NEW session (same config, fresh agent identity) carrying the
   * history up to and including `atTurnId` (whole conversation when omitted).
   */
  async fork(sessionId: string, opts: { atTurnId?: number; name?: string } = {}): Promise<string> {
    const source = getChatSession(this.db, sessionId);
    if (!source) throw new Error(`Chat session ${sessionId} not found`);
    const forkId = createChatSession(this.db, {
      name: opts.name ?? `${source.name} (fork)`,
      agentConfig: source.agentConfig,
      stableAgentId: generateTaskId(),
    });
    const copied = copyChatTurns(this.db, sessionId, forkId, opts.atTurnId);
    setChatTodo(this.db, forkId, getChatTodo(this.db, sessionId));
    if (opts.atTurnId !== undefined && copied === 0) {
      deleteChatSession(this.db, forkId);
      throw new Error(`Turn ${opts.atTurnId} not found in session ${sessionId}`);
    }
    return forkId;
  }

  /**
   * Compact: summarise everything before the last `keepLast` exchanges into one
   * summary exchange, shrinking the context every later turn carries.
   */
  async compact(
    sessionId: string,
    opts: { keepLast?: number } = {},
  ): Promise<{ collapsed: number; compacted: number; summary: string }> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);
    // Default keeps 2 exchanges, but never so many that a short chat has nothing to compact.
    const keepLast = Math.max(0, opts.keepLast ?? Math.max(1, Math.min(2, countChatExchanges(this.db, sessionId) - 1)));
    const old = compactableTurns(this.db, sessionId, keepLast);
    if (old.length === 0) return { collapsed: 0, compacted: 0, summary: "" };
    // Summarise outside the guard (slow, no history change), then apply under it.
    const summary = (await this.summarizer(old, normalizeCortexAgentConfig(row.agentConfig))).trim();
    if (summary.length === 0) throw new Error("Compaction failed: the summary run produced no summary. History is unchanged.");
    const collapsed = await this.mutateHistory(sessionId, () => compactChatTurns(this.db, sessionId, keepLast, summary));
    return { collapsed, compacted: old.length, summary };
  }

  /** Default summariser: a tool-less one-shot agent on the session's own provider/model. */
  private async summarizeWithAgent(
    turns: ReadonlyArray<{ role: string; content: string }>,
    cfg: Record<string, unknown>,
  ): Promise<string> {
    const transcript = turns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n\n");
    const agent = await buildCortexAgent({
      agentName: "chat-compactor",
      ...UTILITY_AGENT_PARAMS,
      provider: typeof cfg.provider === "string" ? cfg.provider : "anthropic",
      ...(typeof cfg.model === "string" && cfg.model.trim() ? { model: cfg.model.trim() } : {}),
      ...(typeof cfg.numCtx === "number" && cfg.numCtx > 0 ? { numCtx: cfg.numCtx } : {}),
      temperature: 0.2,
    });
    try {
      const result = await agent.run(
        utilityPrompt(
          transcript,
          "Summarise the conversation above so it can replace the original as context for future turns. Keep decisions, facts, names, numbers, file paths, open questions and the user's goals. Be concise; no preamble.",
        ),
        { origin: "cortex-utility" },
      );
      // A failed run yields "" so compact() refuses instead of replacing history with a failure notice.
      return utilityOutput(result);
    } finally {
      await agent.dispose();
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const evicted = this.sessions.get(sessionId);
    if (evicted) {
      await disposeCachedSession(evicted);
      this.sessions.delete(sessionId);
    }
    this.documents.clear(sessionId);
    this.envBaselines.delete(sessionId);
    this.todoEdits.delete(sessionId);
    return deleteChatSession(this.db, sessionId);
  }

  renameSession(sessionId: string, name: string): void {
    renameChatSessionInDb(this.db, sessionId, name);
  }

  async updateSessionConfig(sessionId: string, configPatch: Record<string, unknown>): Promise<void> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);

    const merged = { ...row.agentConfig, ...configPatch };
    const normalized = normalizeCortexAgentConfig(merged);
    const updated = updateSessionAgentConfig(this.db, sessionId, normalized);
    if (!updated) throw new Error(`Chat session ${sessionId} not found`);

    // Force next turn to rebuild AgentSession with updated config.
    // Dispose the evicted agent first so its MCP docker containers are torn down.
    const evicted = this.sessions.get(sessionId);
    if (evicted) {
      await disposeCachedSession(evicted);
      this.sessions.delete(sessionId);
    }
  }

  async chat(sessionId: string, message: string, opts: { readonly posture?: RunPosture } = {}): Promise<CortexChatResult> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);

    const cfg = normalizeCortexAgentConfig(row.agentConfig);
    const enableTools = resolveEnableTools(cfg);

    const release = this.acquireTurn(sessionId);
    try {
      const entry = await this.getOrBuildSession(sessionId, cfg, row.stableAgentId);

      /** Playground-style explicit routing — avoids accidental tool runs when tools are off. */
      const chatOpts: ChatOptions = {
        useTools: enableTools,
        ...(opts.posture !== undefined ? { posture: opts.posture } : {}),
      };

      const todoBefore = entry.session.todo();
      const chatReply = await entry.session.chat(message, chatOpts);
      const reply = chatReply.message;
      const tokensUsed = chatReply.tokens ?? 0;
      const toolsUsed = chatReply.toolsUsed;
      const evidence = turnEvidenceOf(chatReply.reasoningSteps, todoBefore, entry.session.todo());

      // Persist the pair only after the engine recorded it: a failed turn leaves no
      // orphan user row, so DB-seeded engine history stays symmetric after eviction.
      this.persistTurn(sessionId, message, reply, tokensUsed, toolsUsed, undefined, producedBy(cfg), turnCostOf(chatReply.cost, undefined));

      return {
        reply,
        tokensUsed,
        ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
        ...(chatReply.steps != null ? { steps: chatReply.steps } : {}),
        ...(chatReply.cost != null ? { cost: chatReply.cost } : {}),
        evidence,
      };
    } finally {
      release();
    }
  }

  async *chatStream(sessionId: string, message: string, signal?: AbortSignal, posture?: RunPosture): AsyncGenerator<AgentStreamEvent> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);

    const cfg = normalizeCortexAgentConfig(row.agentConfig);
    const enableTools = resolveEnableTools(cfg);
    const streamReasoningSteps = cfg.streamReasoningSteps === true;

    const release = this.acquireTurn(sessionId);
    try {
      const entry = await this.getOrBuildSession(sessionId, cfg, row.stableAgentId);

      // Direct conversational path: full session history + run grounding even when tools are off,
      // wrapped in the SSE event shape so Run Chat and the main Chat panel behave consistently.
      if (!enableTools && !streamReasoningSteps) {
        try {
          const chatReply = await entry.session.chat(message, { useTools: false, ...(posture !== undefined ? { posture } : {}) });
          const replyText = chatReply.message;
          const tokensUsed = chatReply.tokens ?? 0;
          const toolsUsed = chatReply.toolsUsed ?? [];

          this.persistTurn(sessionId, message, replyText, tokensUsed, toolsUsed, undefined, producedBy(cfg), turnCostOf(chatReply.cost, undefined));

          if (replyText.length > 0) {
            yield { _tag: "TextDelta", text: replyText };
          }
          yield {
            _tag: "StreamCompleted",
            output: replyText,
            metadata: {
              tokensUsed,
              cost: chatReply.cost ?? 0,
              stepsCount: chatReply.steps ?? 0,
              duration: 0,
            },
            ...(toolsUsed.length > 0
              ? { toolSummary: toolsUsed.map((name) => ({ name, calls: 1, avgMs: 0 })) }
              : {}),
          };
        } catch (e) {
          yield { _tag: "StreamError", cause: e instanceof Error ? e.message : String(e) };
        }
        return;
      }

      // Tools / reasoning-steps path: stream through the cached engine session so
      // the same agent (and its history) backs non-stream chat and SSE chat.
      let tokensUsed = 0;
      let streamCost: number | undefined;
      let streamRunId: string | undefined;
      let toolsUsed: string[] = [];
      let replyText = "";
      let iterationsCompleted = 0;
      let completed = false;
      let context: StoredContext | undefined;
      let outcome: StoredTurnOutcome | undefined;
      const recorder = new TurnTraceRecorder();

      try {
        for await (const event of entry.session.runStream(message, {
          density: "full",
          ...(signal ? { signal } : {}),
          ...(posture !== undefined ? { posture } : {}),
        })) {
          recorder.record(event);
          if (event._tag === "ContextPressure") {
            const { tokensUsed: used, tokensAvailable, utilizationPct, level } = event;
            context = { tokensUsed: used, windowTokens: used + tokensAvailable, utilizationPct, level };
          } else if (event._tag === "TextDelta") {
            replyText += event.text;
          } else if (event._tag === "IterationProgress") {
            iterationsCompleted = event.iteration ?? iterationsCompleted;
          } else if (event._tag === "StreamCompleted") {
            completed = true;
            tokensUsed = event.metadata?.tokensUsed ?? 0;
            streamCost = event.metadata?.cost;
            streamRunId = event.taskId;
            outcome = turnOutcomeOf(event);
            if (event.toolSummary && event.toolSummary.length > 0) {
              toolsUsed = event.toolSummary.map((t) => t.name);
            }
            const out = typeof event.output === "string" ? event.output.trim() : "";
            if (out.length > 0) replyText = out;
          }
          yield event;
        }
      } catch (e) {
        if (signal?.aborted) {
          yield { _tag: "StreamCancelled", reason: "user", iterationsCompleted };
        } else {
          yield { _tag: "StreamError", cause: e instanceof Error ? e.message : String(e) };
        }
      } finally {
        // Only a stream that reached StreamCompleted was recorded by the engine; mirror
        // exactly that in the DB (cancelled / errored turns leave no trace in either).
        if (completed && replyText.length > 0) {
          const trace = withTurnOutcome(recorder.finish(), outcome);
          this.persistTurn(sessionId, message, replyText, tokensUsed, toolsUsed, trace, producedBy(cfg), turnCostOf(streamCost, trace), streamRunId, context);
          // The to-do list belongs to the conversation: keep the engine's latest list for the next turn / restart.
          setChatTodo(this.db, sessionId, entry.session.todo());
        }
      }
    } finally {
      release();
    }
  }

  /** Persist one completed user/assistant exchange and bump the session's last-used stamp. */
  private persistTurn(
    sessionId: string,
    userMessage: string,
    reply: string,
    tokensUsed: number,
    toolsUsed: readonly string[] | undefined,
    trace?: StoredTurnTrace,
    by?: { provider: string; model: string },
    cost?: TurnCost,
    runId?: string,
    context?: StoredContext,
  ): void {
    // A failed tool call emitted as text is not a conversation turn: persisting it would
    // re-poison the rebuilt history. Skip the whole exchange so alternation stays sane.
    if (isShapedAssistantReply(reply)) return;
    appendChatTurn(this.db, { sessionId, role: "user", content: userMessage, tokensUsed: 0 });
    appendChatTurn(this.db, {
      sessionId,
      role: "assistant",
      content: reply,
      tokensUsed,
      ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed: [...toolsUsed] } : {}),
      ...(trace ? { trace } : {}),
      ...(by ? { provider: by.provider, model: by.model } : {}),
      ...(cost ? { costUsd: cost.usd, costKnown: cost.known } : {}),
      ...(runId ? { runId } : {}),
      ...(context ? { context } : {}),
    });
    updateSessionLastUsed(this.db, sessionId);
    this.maybeAutoName(sessionId, userMessage, reply);
  }

  /**
   * Auto-name: a session still called "New Chat" gets an instant title from the
   * first message, then (best-effort, in the background) a model-written one.
   * On by default; `autoName: false` in the session config opts out. A name the
   * user set or edited is never touched.
   */
  private maybeAutoName(sessionId: string, userMessage: string, reply: string): void {
    const row = getChatSession(this.db, sessionId);
    if (!row || row.name !== DEFAULT_CHAT_NAME || row.agentConfig.autoName === false) return;
    const provisional = fallbackChatTitle(userMessage);
    if (provisional === DEFAULT_CHAT_NAME) return;
    renameChatSessionInDb(this.db, sessionId, provisional);
    void this.titler(userMessage, reply, normalizeCortexAgentConfig(row.agentConfig))
      .then((raw) => {
        const title = cleanChatTitle(raw);
        const current = getChatSession(this.db, sessionId);
        // Only upgrade our own provisional title — never overwrite a rename the user made meanwhile.
        if (title && current && current.name === provisional) renameChatSessionInDb(this.db, sessionId, title);
      })
      .catch(() => undefined);
  }

  /** Default titler: a tool-less one-shot agent on the session's own provider/model. */
  private async titleWithAgent(userMessage: string, reply: string, cfg: Record<string, unknown>): Promise<string> {
    const agent = await buildCortexAgent({
      agentName: "chat-titler",
      ...UTILITY_AGENT_PARAMS,
      provider: typeof cfg.provider === "string" ? cfg.provider : "anthropic",
      ...(typeof cfg.model === "string" && cfg.model.trim() ? { model: cfg.model.trim() } : {}),
      ...(typeof cfg.numCtx === "number" && cfg.numCtx > 0 ? { numCtx: cfg.numCtx } : {}),
      temperature: 0.2,
    });
    try {
      const result = await agent.run(
        utilityPrompt(
          `User: ${userMessage.slice(0, 600)}\n\nAssistant: ${reply.slice(0, 600)}`,
          "Write a title of 3 to 6 words for the conversation above. Reply with the title only — no quotes, no punctuation at the end.",
        ),
        { origin: "cortex-utility" },
      );
      // A failed run yields "" so the provisional title stays.
      return utilityOutput(result);
    } finally {
      await agent.dispose();
    }
  }

  private async buildSession(
    sessionId: string,
    agentConfig: Record<string, unknown>,
    stableAgentId?: string,
  ): Promise<CachedChatSession> {
    const built = this.buildChatAgentParams(sessionId, agentConfig, stableAgentId);
    // URL docs are fetched once per session and reused across rebuilds; failures are recorded for the UI.
    const resolved = built.documents ? await this.documents.resolve(sessionId, built.documents) : undefined;
    const { documents: _unresolved, ...rest } = built;
    const params = resolved && resolved.length > 0 ? { ...rest, documents: resolved } : rest;
    const agent = await buildCortexAgent(params);
    const turns = getChatTurns(this.db, sessionId);
    const initialHistory = turnsToChatMessages(turns);
    const initialTodo = getChatTodo(this.db, sessionId);
    const session = agent.session({
      // Session default: every chat turn (chat/runStream) records run-started.origin = "cortex-chat".
      origin: "cortex-chat",
      persist: false,
      id: sessionId,
      environment: () => {
        const snap = chatEnvironmentSnapshot(built, {
          agentControl: agentConfig.agentControl === true,
          goal: this.goalSource?.(sessionId) ?? null,
          todoUserEdits: this.todoEdits.get(sessionId) ?? { added: 0, removed: 0 },
        });
        this.envBaselines.set(sessionId, snap);
        return snap;
      },
      environmentUpdates: agentConfig.environmentUpdates !== false,
      ...(this.envBaselines.has(sessionId) ? { initialEnvironment: this.envBaselines.get(sessionId)! } : {}),
      ...(initialHistory.length > 0 ? { initialHistory } : {}),
      ...(initialTodo.length > 0 ? { initialTodo } : {}),
    });
    const sink = await this.resolveIngestSink();
    const unsubscribe = sink
      ? await attachChatIngest(agent, sink, { sessionId, ...(stableAgentId ? { stableAgentId } : {}) })
      : undefined;
    return { session, agent, ...(unsubscribe ? { unsubscribe } : {}) };
  }

  private resolveIngestSink(): Promise<ChatIngestSink | undefined> {
    const layer = this.ingestLayer;
    if (!layer) return Promise.resolve(undefined);
    this.ingestSink ??= Effect.runPromise(CortexIngestService.pipe(Effect.provide(layer)));
    return this.ingestSink;
  }

  /**
   * Single source of truth for desk chat agent wiring (non-stream and SSE).
   * Keeps run-linked `taskContext` (`buildRunTaskContext`) aligned with `chatStream`.
   */
  private buildChatAgentParams(
    sessionId: string,
    agentConfig: Record<string, unknown>,
    stableAgentId: string | undefined,
  ): BuildCortexAgentParams {
    const provider = (agentConfig.provider as string | undefined) ?? "test";
    // `agentControl` also turns tools on (see `resolveEnableTools`); the tool exists only when a port is attached.
    const sessionControlTool =
      agentConfig.agentControl === true && this.sessionControl
        ? makeSessionControlTool(sessionId, this.sessionControl)
        : undefined;
    const enableTools = resolveEnableTools(agentConfig);

    const rawStrategy = typeof agentConfig.strategy === "string" ? agentConfig.strategy.trim() : "";
    const configuredStrategy =
      rawStrategy.length > 0 && VALID_REASONING_STRATEGIES.has(rawStrategy)
        ? rawStrategy
        : undefined;
    // Defaults mirror the UI's `defaultConfig()` (reactive, no verification pass,
    // no strategy switching): a chat turn must run what the config panel shows,
    // not a heavier stack. plan-execute-reflect + reflect + semantic verification
    // turned a one-tool question into a plan call, a judge pass and a verifier.
    const effectiveStrategy = enableTools ? configuredStrategy ?? "reactive" : configuredStrategy;

    const strategySwitchingExplicit =
      typeof agentConfig.strategySwitching === "boolean" ? agentConfig.strategySwitching : undefined;
    const runtimeVerificationExplicit =
      typeof agentConfig.runtimeVerification === "boolean" ? agentConfig.runtimeVerification : undefined;
    const verificationStepRaw =
      agentConfig.verificationStep === "reflect" || agentConfig.verificationStep === "none"
        ? (agentConfig.verificationStep as "reflect" | "none")
        : undefined;
    const effectiveVerificationStep = verificationStepRaw;

    const personaRaw =
      agentConfig.persona && typeof agentConfig.persona === "object" && !Array.isArray(agentConfig.persona)
        ? (agentConfig.persona as Record<string, unknown>)
        : undefined;
    const personaRole = typeof personaRaw?.role === "string" ? personaRaw.role.trim() : "";
    const personaTone = typeof personaRaw?.tone === "string" ? personaRaw.tone.trim() : "";
    const personaTraits =
      typeof personaRaw?.traits === "string"
        ? personaRaw.traits.trim()
        : typeof personaRaw?.instructions === "string"
          ? personaRaw.instructions.trim()
          : "";
    const personaResponseStyle =
      typeof personaRaw?.responseStyle === "string" ? personaRaw.responseStyle.trim() : "";
    const personaEnabled = personaRaw?.enabled !== false;
    const hasPersonaContent =
      personaRole.length > 0 ||
      personaTone.length > 0 ||
      personaTraits.length > 0 ||
      personaResponseStyle.length > 0;
    const personaConfigured = personaRaw !== undefined;
    const persona =
      personaConfigured && personaEnabled && hasPersonaContent
        ? {
            enabled: true,
            ...(personaRole.length > 0 ? { role: personaRole } : {}),
            ...(personaTone.length > 0 ? { tone: personaTone } : {}),
            ...(personaTraits.length > 0 ? { traits: personaTraits } : {}),
            ...(personaResponseStyle.length > 0 ? { responseStyle: personaResponseStyle } : {}),
          }
        : !personaConfigured && enableTools
          ? { ...DEFAULT_TOOL_CHAT_PERSONA }
          : undefined;

    const contextSynthesisRaw = typeof agentConfig.contextSynthesis === "string"
      ? agentConfig.contextSynthesis.trim()
      : "";
    const contextSynthesis =
      contextSynthesisRaw === "auto" ||
      contextSynthesisRaw === "template" ||
      contextSynthesisRaw === "llm" ||
      contextSynthesisRaw === "none"
        ? contextSynthesisRaw
        : undefined;

    const guardrailsRaw =
      agentConfig.guardrails && typeof agentConfig.guardrails === "object" && !Array.isArray(agentConfig.guardrails)
        ? (agentConfig.guardrails as Record<string, unknown>)
        : undefined;
    const guardrails =
      guardrailsRaw && guardrailsRaw.enabled === true
        ? {
            enabled: true,
            ...(typeof guardrailsRaw.injection === "boolean" ? { injection: guardrailsRaw.injection } : {}),
            ...(typeof guardrailsRaw.pii === "boolean" ? { pii: guardrailsRaw.pii } : {}),
            ...(typeof guardrailsRaw.toxicity === "boolean" ? { toxicity: guardrailsRaw.toxicity } : {}),
            ...(Array.isArray(guardrailsRaw.customBlocklist) && guardrailsRaw.customBlocklist.length > 0
              ? { customBlocklist: guardrailsRaw.customBlocklist.filter((x): x is string => typeof x === "string") }
              : {}),
            ...(typeof guardrailsRaw.injectionThreshold === "number"
              ? { injectionThreshold: guardrailsRaw.injectionThreshold }
              : {}),
            ...(typeof guardrailsRaw.piiThreshold === "number"
              ? { piiThreshold: guardrailsRaw.piiThreshold }
              : {}),
            ...(typeof guardrailsRaw.toxicityThreshold === "number"
              ? { toxicityThreshold: guardrailsRaw.toxicityThreshold }
              : {}),
          }
        : undefined;

    const runId =
      typeof agentConfig.runId === "string" && agentConfig.runId.trim().length > 0
        ? agentConfig.runId.trim()
        : undefined;

    const taskContext: Record<string, string> = {};
    if (runId) {
      const runCtx = buildRunTaskContext(this.db, runId);
      if (runCtx) Object.assign(taskContext, runCtx);
    }
    const userCtx = coerceTaskContextRecord(agentConfig.taskContext);
    if (userCtx) Object.assign(taskContext, userCtx);

    const toolPick = Array.isArray(agentConfig.tools)
      ? (agentConfig.tools as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const mergedTools = enableTools ? mergeCortexAllowedTools(toolPick, undefined, {}) : [];

    const addl =
      typeof agentConfig.terminalShellAdditionalCommands === "string"
        ? agentConfig.terminalShellAdditionalCommands.trim()
        : "";
    const allowOnly =
      typeof agentConfig.terminalShellAllowedCommands === "string"
        ? agentConfig.terminalShellAllowedCommands.trim()
        : "";

    const rawScenario = agentConfig.testScenario;
    const customTestScenario =
      Array.isArray(rawScenario) && rawScenario.length > 0 ? (rawScenario as TestTurn[]) : undefined;

    const mcpServerIds = Array.isArray(agentConfig.mcpServerIds)
      ? (agentConfig.mcpServerIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const mcpConfigs =
      enableTools && mcpServerIds.length > 0
        ? getMcpServersByIds(this.db, mcpServerIds).map(parseMcpConfig)
        : [];
    const toolParams = chatToolParams(agentConfig, enableTools, mcpConfigs);

    // Chat history already carries the conversation, and recalled cross-run memory
    // can override fresh tool use with stale conclusions — so memory is opt-in per chat.
    const memoryRaw =
      agentConfig.memory && typeof agentConfig.memory === "object" && !Array.isArray(agentConfig.memory)
        ? (agentConfig.memory as { working?: boolean; episodic?: boolean; semantic?: boolean })
        : undefined;
    const memory = memoryRaw
      ? {
          working: memoryRaw.working === true,
          episodic: memoryRaw.episodic === true,
          semantic: memoryRaw.semantic === true,
        }
      : { working: false, episodic: false, semantic: false };

    const metaTools =
      agentConfig.metaTools && typeof agentConfig.metaTools === "object" && !Array.isArray(agentConfig.metaTools)
        ? (agentConfig.metaTools as BuildCortexAgentParams["metaTools"])
        : undefined;
    const observability =
      agentConfig.observability && typeof agentConfig.observability === "object" && !Array.isArray(agentConfig.observability)
        ? (agentConfig.observability as BuildCortexAgentParams["observability"])
        : undefined;
    const fallbacks =
      agentConfig.fallbacks && typeof agentConfig.fallbacks === "object" && !Array.isArray(agentConfig.fallbacks)
        ? (agentConfig.fallbacks as BuildCortexAgentParams["fallbacks"])
        : undefined;
    const retryPolicy =
      agentConfig.retryPolicy && typeof agentConfig.retryPolicy === "object" && !Array.isArray(agentConfig.retryPolicy)
        ? (agentConfig.retryPolicy as BuildCortexAgentParams["retryPolicy"])
        : undefined;
    const observabilityVerbosity =
      agentConfig.observabilityVerbosity === "off" ||
      agentConfig.observabilityVerbosity === "minimal" ||
      agentConfig.observabilityVerbosity === "normal" ||
      agentConfig.observabilityVerbosity === "verbose"
        ? agentConfig.observabilityVerbosity
        : undefined;

    // Forward run-wired feature keys so chat sessions can use them (Phase 2 parity).
    const skillsRaw =
      agentConfig.skills && typeof agentConfig.skills === "object" && !Array.isArray(agentConfig.skills)
        ? (agentConfig.skills as { paths?: unknown; activate?: unknown })
        : undefined;
    const skillsPaths = Array.isArray(skillsRaw?.paths)
      ? skillsRaw!.paths.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const skillsActivate = Array.isArray(skillsRaw?.activate)
      ? skillsRaw!.activate.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const skills = skillsPaths.length > 0
      ? { paths: skillsPaths, ...(skillsActivate.length > 0 ? { activate: skillsActivate } : {}) }
      : undefined;

    const budgetRaw =
      agentConfig.budget && typeof agentConfig.budget === "object" && !Array.isArray(agentConfig.budget)
        ? (agentConfig.budget as { tokenLimit?: unknown; costLimit?: unknown })
        : undefined;
    const budgetTokenLimit =
      typeof budgetRaw?.tokenLimit === "number" && (budgetRaw.tokenLimit as number) > 0
        ? (budgetRaw.tokenLimit as number)
        : undefined;
    const budgetCostLimit =
      typeof budgetRaw?.costLimit === "number" && (budgetRaw.costLimit as number) > 0
        ? (budgetRaw.costLimit as number)
        : undefined;
    const budget = budgetTokenLimit !== undefined || budgetCostLimit !== undefined
      ? { ...(budgetTokenLimit !== undefined ? { tokenLimit: budgetTokenLimit } : {}), ...(budgetCostLimit !== undefined ? { costLimit: budgetCostLimit } : {}) }
      : undefined;

    const groundingRaw =
      agentConfig.grounding && typeof agentConfig.grounding === "object" && !Array.isArray(agentConfig.grounding)
        ? (agentConfig.grounding as { mode?: unknown; tolerance?: unknown })
        : undefined;
    const groundingMode = groundingRaw?.mode === "warn" || groundingRaw?.mode === "block" ? groundingRaw.mode : undefined;
    const grounding = groundingMode
      ? { mode: groundingMode, ...(typeof groundingRaw?.tolerance === "number" ? { tolerance: groundingRaw.tolerance as number } : {}) }
      : undefined;

    const fabricationGuard =
      agentConfig.fabricationGuard === "off" || agentConfig.fabricationGuard === "warn" || agentConfig.fabricationGuard === "block"
        ? (agentConfig.fabricationGuard as "off" | "warn" | "block")
        : undefined;

    const modelRoutingRaw =
      agentConfig.modelRouting && typeof agentConfig.modelRouting === "object" && !Array.isArray(agentConfig.modelRouting)
        ? (agentConfig.modelRouting as { enabled?: unknown; minTier?: unknown; tierModels?: unknown })
        : undefined;
    const modelRouting = modelRoutingRaw?.enabled === true
      ? {
          enabled: true,
          ...(typeof modelRoutingRaw.minTier === "string" ? { minTier: modelRoutingRaw.minTier as "haiku" | "sonnet" | "opus" } : {}),
          ...(modelRoutingRaw.tierModels && typeof modelRoutingRaw.tierModels === "object"
            ? { tierModels: modelRoutingRaw.tierModels as Partial<Record<"haiku" | "sonnet" | "opus", string>> }
            : {}),
        }
      : undefined;

    const outputSchema =
      agentConfig.outputSchema && typeof agentConfig.outputSchema === "object" && !Array.isArray(agentConfig.outputSchema)
        ? (agentConfig.outputSchema as Record<string, unknown>)
        : undefined;

    const harness =
      agentConfig.harness && typeof agentConfig.harness === "object" && !Array.isArray(agentConfig.harness)
        ? (agentConfig.harness as Record<string, unknown>)
        : undefined;

    const documents = parseDocumentSpecs(agentConfig.documents);

    const auditRationale = agentConfig.auditRationale === true ? true : undefined;

    // Same keys the Lab run path forwards (runner-service): generic framework overrides and
    // durable execution / approval gate. Both arrive already normalised (normalizeCortexAgentConfig).
    const rawConfig =
      agentConfig.rawConfig && typeof agentConfig.rawConfig === "object" && !Array.isArray(agentConfig.rawConfig)
        ? (agentConfig.rawConfig as Record<string, unknown>)
        : undefined;
    const durableRuns =
      agentConfig.durableRuns && typeof agentConfig.durableRuns === "object" && (agentConfig.durableRuns as { enabled?: unknown }).enabled === true
        ? (agentConfig.durableRuns as NonNullable<BuildCortexAgentParams["durableRuns"]>)
        : undefined;
    // Workspace + shell options are tool-layer settings: a tools-off chat must not get a tool layer.
    const workspace = enableTools && typeof agentConfig.workspace === "string" && agentConfig.workspace.trim() !== ""
      ? agentConfig.workspace.trim()
      : undefined;
    const terminalShellOptions = enableTools ? parseCortexShellOptions(agentConfig.terminalShellOptions) : undefined;

    return {
      agentName: `chat-${sessionId.slice(0, 8)}`,
      provider,
      ...(stableAgentId ? { agentId: stableAgentId } : {}),
      memory,
      streaming: true,
      // Framework JSONL tracer so every chat turn has a real run trace (opt out: `traceRuns: false`).
      tracing: agentConfig.traceRuns === false ? false : { dir: traceDirs()[0]! },
      ...(typeof agentConfig.model === "string" && agentConfig.model.trim()
        ? { model: agentConfig.model.trim() }
        : {}),
      ...(() => {
        const base = typeof agentConfig.systemPrompt === "string" ? agentConfig.systemPrompt.trim() : "";
        const sp = sessionControlTool ? [base, SESSION_CONTROL_SYSTEM_LINE].filter(Boolean).join("\n\n") : base;
        return sp ? { systemPrompt: sp } : {};
      })(),
      ...(sessionControlTool ? { extraTools: [sessionControlTool] } : {}),
      ...(typeof agentConfig.temperature === "number" ? { temperature: agentConfig.temperature } : {}),
      ...(typeof agentConfig.maxTokens === "number" && agentConfig.maxTokens > 0
        ? { maxTokens: agentConfig.maxTokens }
        : {}),
      ...(typeof agentConfig.numCtx === "number" && agentConfig.numCtx > 0
        ? { numCtx: agentConfig.numCtx }
        : {}),
      ...(typeof agentConfig.thinking === "boolean" ? { thinking: agentConfig.thinking } : {}),
      ...(enableTools
        ? {
            tools: mergedTools,
            strategy: effectiveStrategy,
            // 16 when unset: a chat turn is open-ended (several tool rounds plus a final
            // answer), so it gets more headroom than the Lab builder's default of 10.
            // The quick bar's iteration control sets an explicit value.
            maxIterations:
              typeof agentConfig.maxIterations === "number" && agentConfig.maxIterations > 0
                ? agentConfig.maxIterations
                : CHAT_DEFAULT_MAX_ITERATIONS,
          }
        : {}),
      ...toolParams,
      ...(effectiveVerificationStep ? { verificationStep: effectiveVerificationStep } : {}),
      ...(strategySwitchingExplicit === true ? { strategySwitching: true } : {}),
      ...(runtimeVerificationExplicit === true ? { runtimeVerification: true } : {}),
      ...(contextSynthesis ? { contextSynthesis } : {}),
      ...(guardrails ? { guardrails } : {}),
      ...(persona ? { persona } : {}),
      ...(metaTools ? { metaTools } : {}),
      ...(observability ? { observability } : {}),
      ...(fallbacks ? { fallbacks } : {}),
      ...(retryPolicy ? { retryPolicy } : {}),
      ...(observabilityVerbosity ? { observabilityVerbosity } : {}),
      ...(skills ? { skills } : {}),
      ...(budget ? { budget } : {}),
      ...(grounding ? { grounding } : {}),
      ...(fabricationGuard ? { fabricationGuard } : {}),
      ...(modelRouting ? { modelRouting } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      ...(harness ? { harness } : {}),
      ...(documents ? { documents } : {}),
      ...(auditRationale ? { auditRationale: true } : {}),
      ...(rawConfig && Object.keys(rawConfig).length > 0 ? { rawConfig } : {}),
      ...(durableRuns ? { durableRuns } : {}),
      ...(workspace ? { workspace } : {}),
      ...(terminalShellOptions ? { terminalShellOptions } : {}),
      ...(typeof agentConfig.minIterations === "number" && agentConfig.minIterations > 0
        ? { minIterations: agentConfig.minIterations }
        : {}),
      ...(agentConfig.healthCheck === true ? { healthCheck: true as const } : {}),
      ...(typeof agentConfig.timeout === "number" && agentConfig.timeout > 0
        ? { timeout: agentConfig.timeout }
        : {}),
      ...(agentConfig.terminalTools === true ? { terminalTools: true as const } : {}),
      // Forward shell CLI config whenever tools are on and the session stored values — do not
      // gate on `shellInToolPick` alone so `buildCortexAgent` can still apply `terminalShell*`
      // when `hasShellTerminalConfig` forces `shellRequested` (see build-cortex-agent).
      ...(enableTools && addl.length > 0 ? { terminalShellAdditionalCommands: addl } : {}),
      ...(enableTools && allowOnly.length > 0 ? { terminalShellAllowedCommands: allowOnly } : {}),
      ...(Object.keys(taskContext).length > 0 ? { taskContext } : {}),
      ...(customTestScenario && provider === "test"
        ? { testScenario: customTestScenario }
        : provider === "test"
          ? { testScenario: [{ text: "Cortex chat test reply." }] }
          : {}),
    } as BuildCortexAgentParams;
  }
}
