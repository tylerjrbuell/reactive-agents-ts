import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { AgentEvent } from "@reactive-agents/core";
import type { AgentDebrief } from "./debrief.js";

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
}

/**
 * Options for `agent.chat()` — override automatic routing behavior.
 *
 * By default, the agent auto-detects whether tools are needed based on
 * the message content. Use these options to force a specific path.
 */
export interface ChatOptions {
  /** Override automatic tool-need detection. Default: auto-detected via heuristic */
  useTools?: boolean;
  /** Maximum iterations for the tool-capable path. Default: 5 */
  maxIterations?: number;
}

/**
 * Options for `agent.session()` — configure session lifecycle behavior.
 */
export interface SessionOptions {
  /** Write conversation to episodic memory on session.end(). Default: false */
  persistOnEnd?: boolean;
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
  if (!lastDebrief) return "";
  const parts = [
    `## Last Run Results`,
    `Outcome: ${lastDebrief.outcome} (confidence: ${lastDebrief.confidence})`,
    `Summary: ${lastDebrief.summary}`,
  ];
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

  // Include actual tool results so the chat can reference specific data
  if (observations && observations.length > 0) {
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

// ─── Direct LLM chat (no tools) ────────────────────────────────────────────

export function directChat(
  message: string,
  history: ChatMessage[],
  contextSummary: string,
): Effect.Effect<ChatReply, Error, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;

    const systemPrompt = contextSummary
      ? `You are a helpful AI assistant. Here is context from a recent agent run:\n\n${contextSummary}\n\nAnswer conversationally and concisely.`
      : "You are a helpful AI assistant. Answer conversationally and concisely.";

    const messages = [
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: message },
    ];

    const response = yield* llm
      .complete({
        messages,
        systemPrompt,
        temperature: 0.7,
        maxTokens: 1024,
      })
      .pipe(
        Effect.mapError((e) => new Error(String(e))),
      );

    return {
      message: response.content,
      tokens: response.usage?.totalTokens,
      cost: response.usage?.estimatedCost,
    } satisfies ChatReply;
  });
}

export function buildChatTurnEvents(params: {
  taskId: string;
  sessionId: string;
  routedVia: "direct-llm" | "react-loop";
  userMessage: string;
  assistantMessage: string;
  tokensUsed?: number;
}): [Extract<AgentEvent, { _tag: "ChatTurn" }>, Extract<AgentEvent, { _tag: "ChatTurn" }>] {
  const base = {
    _tag: "ChatTurn" as const,
    taskId: params.taskId,
    sessionId: params.sessionId,
    routedVia: params.routedVia,
  };

  return [
    {
      ...base,
      role: "user",
      content: params.userMessage,
    },
    {
      ...base,
      role: "assistant",
      content: params.assistantMessage,
      ...(params.tokensUsed !== undefined ? { tokensUsed: params.tokensUsed } : {}),
    },
  ];
}

export async function publishChatTurnEvents(params: {
  taskId: string;
  sessionId: string;
  routedVia: "direct-llm" | "react-loop";
  userMessage: string;
  assistantMessage: string;
  tokensUsed?: number;
  publish: (event: Extract<AgentEvent, { _tag: "ChatTurn" }>) => Promise<void>;
}): Promise<void> {
  const events = buildChatTurnEvents({
    taskId: params.taskId,
    sessionId: params.sessionId,
    routedVia: params.routedVia,
    userMessage: params.userMessage,
    assistantMessage: params.assistantMessage,
    tokensUsed: params.tokensUsed,
  });

  for (const event of events) {
    await params.publish(event);
  }
}

// ─── AgentSession ──────────────────────────────────────────────────────────

export class AgentSession {
  private _history: ChatMessage[] = [];

  constructor(
    private readonly chatFn: (message: string, history: ChatMessage[], options?: ChatOptions) => Promise<ChatReply>,
    private readonly onEnd?: (history: ChatMessage[]) => Promise<void>,
    private readonly onSave?: (history: ChatMessage[]) => Promise<void>,
    initialHistory?: ChatMessage[],
  ) {
    if (initialHistory) this._history = [...initialHistory];
  }

  async chat(message: string, options?: ChatOptions): Promise<ChatReply> {
    const reply = await this.chatFn(message, this._history, options);
    this._history.push({ role: "user", content: message, timestamp: Date.now() });
    this._history.push({ role: "assistant", content: reply.message, timestamp: Date.now() });
    return reply;
  }

  history(): ChatMessage[] {
    return [...this._history];
  }

  async end(): Promise<void> {
    if (this.onSave) await this.onSave(this._history);
    if (this.onEnd) await this.onEnd(this._history);
    this._history = [];
  }
}
