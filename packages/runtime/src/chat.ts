import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { AgentDebrief } from "./debrief.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatReply {
  message: string;
  toolsUsed?: string[];
  fromMemory?: boolean;
}

export interface ChatOptions {
  /** Override automatic tool-need detection. Default: auto-detected via heuristic */
  useTools?: boolean;
  /** Maximum iterations for the tool-capable path. Default: 5 */
  maxIterations?: number;
}

export interface SessionOptions {
  /** Write conversation to episodic memory on session.end(). Default: false */
  persistOnEnd?: boolean;
}

// ─── Intent classifier (heuristic, zero tokens) ────────────────────────────

const TOOL_INTENT_PATTERNS = [
  /\b(search|fetch|find|get|check|look up|what is the current|what are the latest)\b/i,
  /\b(write|create|save|send|post|update|delete)\b/i,
  /\b(run|execute|calculate|compute)\b/i,
];

export function requiresTools(message: string): boolean {
  return TOOL_INTENT_PATTERNS.some((p) => p.test(message));
}

// ─── Context builder from debrief ─────────────────────────────────────────

export function buildContextSummary(lastDebrief?: AgentDebrief): string {
  if (!lastDebrief) return "";
  const parts = [`Last run summary: ${lastDebrief.summary}`];
  if (lastDebrief.keyFindings.length > 0) {
    parts.push(`Key findings: ${lastDebrief.keyFindings.join("; ")}`);
  }
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

    return { message: response.content } satisfies ChatReply;
  });
}

// ─── AgentSession ──────────────────────────────────────────────────────────

export class AgentSession {
  private _history: ChatMessage[] = [];

  constructor(
    private readonly chatFn: (message: string, history: ChatMessage[]) => Promise<ChatReply>,
    private readonly onEnd?: (history: ChatMessage[]) => Promise<void>,
  ) {}

  async chat(message: string): Promise<ChatReply> {
    const reply = await this.chatFn(message, this._history);
    this._history.push({ role: "user", content: message, timestamp: Date.now() });
    this._history.push({ role: "assistant", content: reply.message, timestamp: Date.now() });
    return reply;
  }

  history(): ChatMessage[] {
    return [...this._history];
  }

  async end(): Promise<void> {
    if (this.onEnd) await this.onEnd(this._history);
    this._history = [];
  }
}
