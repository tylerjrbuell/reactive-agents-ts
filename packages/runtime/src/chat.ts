import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { gatewayComplete } from "@reactive-agents/reasoning";
import type { AgentEvent } from "@reactive-agents/core";
import type { AgentDebrief } from "./debrief.js";
import {
  applyHistoryWindowWithOverflow,
  type HistoryOverflowHandler,
} from "./gateway-context-formatting.js";
export type { HistoryOverflowHandler } from "./gateway-context-formatting.js";
import type { RunHandle } from "./run-controller.js";
import { ChatEngine } from "./chat/engine.js";
export { ChatEngine } from "./chat/engine.js";
import { ChatEngineCapabilityError } from "./chat/engine-errors.js";
import type { StreamDensity } from "./stream-types.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * A single message in a chat session history.
 *
 * Used internally by `AgentSession` to maintain conversation context
 * and by `agent.chat()` for multi-turn interactions.
 */
export interface ChatMessage {
  /** Who sent this message: "user" for caller input, "assistant" for agent replies */
  role: "user" | "assistant";
  /** Message content */
  content: string;
  /** Unix timestamp in milliseconds when the message was added */
  timestamp: number;
}

/**
 * Response returned by `agent.chat()` or `session.chat()`.
 *
 * Contains the agent's reply text plus optional metadata about how
 * the response was produced (tools used, token count, cost).
 */
export interface ChatReply {
  /** The agent's response text */
  message: string;
  /** Names of tools called during response generation (tool-capable path only) */
  toolsUsed?: string[];
  /** Whether the response was served from prior memory or debrief context */
  fromMemory?: boolean;
  /** Token count from the LLM response (when available) */
  tokens?: number;
  /** Reasoning steps taken (tool-capable path only) */
  steps?: number;
  /** Estimated cost in USD (when available) */
  cost?: number;
  /**
   * Full reasoning-step evidence (tool-capable path only). Structurally
   * typed to mirror `@reactive-agents/reasoning`'s `ReasoningStep` without a
   * cross-package import (same pattern as `TaskResult.metadata.reasoningSteps`
   * in runtime/src/types.ts). Pass this to `validateCitations(message, steps)`
   * (from `@reactive-agents/reasoning`) to deterministically check that every
   * URL the reply cites appears in the run's actual tool-observation evidence.
   */
  reasoningSteps?: readonly {
    id?: string;
    type: string;
    content: string;
    metadata?: Record<string, unknown>;
  }[];
  /**
   * Full (uncompressed) tool-result store, keyed by `ReasoningStep.metadata.storedKey`.
   * Pass this to `validateCitations(message, steps, new Map(Object.entries(scratchpad)))`
   * so it reads the same evidence corpus the kernel's own grounding checks use, not the
   * lossy compressed preview in `reasoningSteps[].content`.
   */
  scratchpad?: Readonly<Record<string, string>>;
  /**
   * Result of `validateCitations()` against tool-observation evidence — only
   * populated when `ChatOptions.verifyCitations` is true AND the reply was
   * produced on the tool-capable path (there is no tool evidence to check
   * citations against on the direct-LLM path, so the field is omitted there
   * rather than reporting a false `ok: true`).
   */
  citationCheck?: {
    ok: boolean;
    uncitedUrls: readonly string[];
    citedUrlCount: number;
  };
}

/**
 * Options for `agent.chat()` — override automatic routing behavior.
 *
 * By default, the agent auto-detects whether tools are needed based on
 * the message content. Use these options to force a specific path.
 */
export interface ChatOptions {
  /**
   * Override automatic tool-need detection for this call.
   *
   * Precedence: this explicit `useTools` > the agent-level classifier set via
   * `.withToolIntent()` on the builder (if any) > the default `requiresTools()`
   * heuristic. Default: auto-detected via heuristic.
   */
  useTools?: boolean;
  /** Maximum iterations for the tool-capable path. Default: 5 */
  maxIterations?: number;
  /** Optional context prepended to the system context summary (direct-LLM path only). */
  extraContext?: string;
  /**
   * Deterministically verify that every URL the reply cites appears in the
   * run's tool-observation evidence (via `validateCitations` from
   * `@reactive-agents/reasoning`). Tool-capable path only — no-op on the
   * direct-LLM path since there is no tool evidence to check against.
   * Default: false (no cost unless opted in).
   */
  verifyCitations?: boolean;
}

/**
 * Options for `agent.session()` — configure session lifecycle behavior.
 *
 * The live options are the ones accepted inline by
 * `ReactiveAgent.session()`: `persist` (save/restore history via
 * `SessionStoreService` — requires the memory layer) and `id` (stable
 * session identifier for resuming).
 */
export interface SessionOptions {
  /**
   * Persist conversation history to the SQLite session store (requires the
   * memory layer). Default: agent-level `_sessionPersist` (false unless opted in).
   */
  persist?: boolean;
  /**
   * Stable session identifier for resuming a prior conversation. When omitted
   * the engine generates a canonical `sess_session_<unique>` id.
   */
  id?: string;
  /** Retention window in days for persisted sessions (host-defined). */
  maxAgeDays?: number;
  /**
   * Called when history windowing would drop turns for this session's `chat()`
   * calls, with exactly the dropped turns (oldest-to-newest). Its returned
   * summary text is spliced back in as a synthetic leading turn.
   */
  onOverflow?: HistoryOverflowHandler;
}

// ─── Intent classifier (heuristic, zero tokens) ────────────────────────────

/**
 * Heuristic intent classifier — returns true when the message NEEDS tools
 * to answer (e.g. "search for X", "send a message to Y").
 *
 * Returns false for conversational / reflective messages even if they contain
 * tool-adjacent words like "found", "sent", "created" — these refer to past
 * actions, not new tool invocations.
 *
 * Priority: false positives (routing to tool path unnecessarily) are worse
 * than false negatives (missing a tool need) because the tool path loses
 * chat context. When in doubt, route to direct LLM.
 */
const TOOL_INTENT_PATTERNS = [
  // Active imperatives — user wants the agent to DO something now
  /\b(search for|fetch|look up|what is the current|what are the latest)\b/i,
  /\b(write to|create a|save to|send a|post to|update the|delete the)\b/i,
  /\b(run this|execute this|calculate|compute)\b/i,
];

// Conversational patterns that override tool intent — past tense, reflective
const CHAT_OVERRIDE_PATTERNS = [
  /\b(what did you|tell me about|which one|summarize|explain|describe|how did)\b/i,
  /\b(in the last run|earlier|previous|before)\b/i,
];

export function requiresTools(message: string): boolean {
  // Conversational overrides take priority — these are about past actions, not new ones
  if (CHAT_OVERRIDE_PATTERNS.some((p) => p.test(message))) return false;
  return TOOL_INTENT_PATTERNS.some((p) => p.test(message));
}

// ─── Context builder from debrief ─────────────────────────────────────────

export function buildContextSummary(
  lastDebrief?: AgentDebrief,
  observations?: readonly string[],
): string {
  const hasObservations = observations !== undefined && observations.length > 0;
  if (!lastDebrief && !hasObservations) return "";
  const parts: string[] = [];
  if (lastDebrief) {
    parts.push(
      `## Last Run Results`,
      `Outcome: ${lastDebrief.outcome} (confidence: ${lastDebrief.confidence})`,
      `Summary: ${lastDebrief.summary}`,
    );
    if (lastDebrief.keyFindings.length > 0) {
      parts.push(`Key findings:\n${lastDebrief.keyFindings.map((f) => `- ${f}`).join("\n")}`);
    }
    if (lastDebrief.toolsUsed.length > 0) {
      parts.push(`Tools used: ${lastDebrief.toolsUsed.map((t) => `${t.name} (${t.calls}x, ${t.successRate}% success)`).join(", ")}`);
    }
    if (lastDebrief.errorsEncountered.length > 0) {
      parts.push(`Errors: ${lastDebrief.errorsEncountered.join("; ")}`);
    }
    if (lastDebrief.metrics) {
      parts.push(`Metrics: ${lastDebrief.metrics.iterations} iterations, ${lastDebrief.metrics.tokens} tokens, ${(lastDebrief.metrics.duration / 1000).toFixed(1)}s`);
    }
  }

  // Include actual tool results so the chat can reference specific data
  if (hasObservations) {
    // Cap total observation text to ~3000 chars to avoid blowing up context
    let totalChars = 0;
    const included: string[] = [];
    for (const obs of observations) {
      if (totalChars + obs.length > 3000) {
        // Truncate long observations to fit within budget
        const remaining = 3000 - totalChars;
        if (remaining > 100) {
          included.push(obs.slice(0, remaining) + "…");
        }
        break;
      }
      included.push(obs);
      totalChars += obs.length;
    }
    parts.push(`\n## Tool Results (from last run)\n${included.map((o, i) => `### Result ${i + 1}\n${o}`).join("\n\n")}`);
  }

  parts.push(`\nUse this information to answer questions about what you did, found, or accomplished. Reference specific data from tool results when answering.`);
  return parts.join("\n");
}

/**
 * Formats {@link ReactiveAgentBuilder.withTaskContext} data for `agent.chat()` system context.
 * ExecutionEngine injects the same record into the reasoning loop on `run()`; chat must merge it
 * explicitly because the direct-LLM path does not boot the full execution pipeline.
 */
export function formatTaskContextForChat(ctx?: Record<string, string> | undefined): string {
  if (!ctx) return "";
  const entries = Object.entries(ctx).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0,
  );
  if (entries.length === 0) return "";
  const body = entries.map(([k, v]) => `### ${k}\n${v.trim()}`).join("\n\n");
  return `## Task / session grounding\n\n${body}`;
}

/**
 * Full conversational context: static task context from build time plus last `.run()` debrief/observations.
 */
export function buildChatSystemContext(
  taskContext?: Record<string, string> | undefined,
  lastDebrief?: AgentDebrief,
  observations?: readonly string[],
): string {
  const taskBlock = formatTaskContextForChat(taskContext);
  const runBlock = buildContextSummary(lastDebrief, observations);
  return [taskBlock, runBlock].filter(Boolean).join("\n\n---\n\n");
}

// ─── Direct LLM chat (no tools) ────────────────────────────────────────────



// ─── AgentSession ──────────────────────────────────────────────────────────

export class AgentSession {
  private readonly engine?: ChatEngine;

  // Legacy (pre-engine) backing state — retained for callers that construct
  // `AgentSession` directly with a `chatFn` (cortex, older tests). New
  // `agent.session()` instances are engine-backed and use `this.engine`.
  private _history: ChatMessage[] = [];
  private _historyLoader?: () => Promise<ChatMessage[]>;
  private _historyLoaded = false;
  private readonly chatFn?: (message: string, history: ChatMessage[], options?: ChatOptions) => Promise<ChatReply>;
  private readonly onEnd?: (history: ChatMessage[]) => Promise<void>;
  private readonly onSave?: (history: ChatMessage[]) => Promise<void>;
  private readonly onOverflow?: HistoryOverflowHandler;

  constructor(
    engineOrChatFn:
      | ChatEngine
      | ((message: string, history: ChatMessage[], options?: ChatOptions) => Promise<ChatReply>),
    onEnd?: (history: ChatMessage[]) => Promise<void>,
    onSave?: (history: ChatMessage[]) => Promise<void>,
    initialHistory?: ChatMessage[],
    historyLoader?: () => Promise<ChatMessage[]>,
    onOverflow?: HistoryOverflowHandler,
  ) {
    if (engineOrChatFn instanceof ChatEngine) {
      this.engine = engineOrChatFn;
      return;
    }
    this.chatFn = engineOrChatFn;
    this.onEnd = onEnd;
    this.onSave = onSave;
    if (initialHistory) this._history = [...initialHistory];
    if (historyLoader) this._historyLoader = historyLoader;
    this.onOverflow = onOverflow;
  }

  /**
   * Send a conversational message through the session.
   *
   * Engine-backed sessions delegate to the held {@link ChatEngine}; legacy
   * sessions retain the pre-engine windowing + recording behavior.
   */
  async chat(message: string, options?: ChatOptions): Promise<ChatReply> {
    if (this.engine) {
      return this.engine.turn(message, options);
    }
    if (this._historyLoader && !this._historyLoaded) {
      this._history = await this._historyLoader();
      this._historyLoaded = true;
    }
    const historyForChat = this.onOverflow
      ? await applyHistoryWindowWithOverflow(this._history, this.onOverflow)
      : this._history;
    const reply = await this.chatFn!(message, historyForChat, options);
    this._history.push({ role: "user", content: message, timestamp: Date.now() });
    this._history.push({ role: "assistant", content: reply.message, timestamp: Date.now() });
    if (this.onSave) await this.onSave(this._history);
    return reply;
  }

  /**
   * Snapshot of the session's full conversation history (oldest first).
   */
  history(): ChatMessage[] {
    if (this.engine) return this.engine.history();
    return [...this._history];
  }

  /**
   * Flush persistence (when wired) and clear in-memory state.
   */
  async end(): Promise<void> {
    if (this.engine) {
      await this.engine.end();
      return;
    }
    if (this.onSave) await this.onSave(this._history);
    if (this.onEnd) await this.onEnd(this._history);
    this._history = [];
  }

  /**
   * Stream a conversational turn through the held engine. Engine-backed sessions
   * only (legacy `chatFn` sessions have no streaming capability).
   */
  runStream(
    message: string,
    options?: { readonly density?: StreamDensity; readonly signal?: AbortSignal },
  ): RunHandle {
    if (!this.engine) {
      throw new ChatEngineCapabilityError({
        message:
          "AgentSession.runStream() requires an engine-backed session (construct via agent.session()).",
        capability: "runStreamTask",
      });
    }
    return this.engine.streamTurn(message, {
      density: options?.density,
      signal: options?.signal,
    });
  }
}
