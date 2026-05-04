import type { ChatMessage } from "./chat.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TURNS = 40;
const MAX_CHARS = 8_000;
const MAX_EPISODE_CONTENT = 300;

// ─── Pure Utilities ───────────────────────────────────────────────────────────

/**
 * Window conversation history to at most MAX_TURNS turns and MAX_CHARS total.
 * Drops oldest turns first. The full history is preserved for persistence —
 * this only affects what gets injected into the LLM instruction.
 */
export function applyHistoryWindow(history: readonly ChatMessage[]): ChatMessage[] {
  let windowed = history.slice(-MAX_TURNS);
  let totalChars = windowed.reduce((sum, m) => sum + m.content.length, 0);
  while (windowed.length > 0 && totalChars > MAX_CHARS) {
    totalChars -= windowed[0]!.content.length;
    windowed = windowed.slice(1);
  }
  return windowed;
}

/**
 * Format a windowed history slice as a labeled conversation block.
 */
export function formatHistoryBlock(history: readonly ChatMessage[]): string {
  if (history.length === 0) return "";
  const lines = history.map((m) =>
    m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`,
  );
  return `--- Conversation history ---\n${lines.join("\n")}`;
}

/**
 * Format recent episodic entries as a gateway activity block.
 */
export function formatEpisodicContext(
  episodes: readonly { eventType?: string; content?: string }[],
): string {
  if (episodes.length === 0) return "";
  const lines = episodes.map((e) => {
    const tag = e.eventType ?? "episodic";
    const body = String(e.content ?? "").slice(0, MAX_EPISODE_CONTENT);
    return `[${tag}] ${body}`;
  });
  return `--- Recent gateway activity ---\n${lines.join("\n")}`;
}

/**
 * How the model must complete a gateway channel turn: call an MCP outbound
 * message tool from the server that raised the event. No Signal/Telegram (or
 * other vendor) tool names — those differ per MCP; the model picks the right
 * tool from its registered list using that MCP server's tool name prefix.
 */
export function channelOutboundToolGuidance(params: {
  readonly mcpServer: string;
  readonly sender: string;
}): string {
  const server = params.mcpServer.trim() || "messaging";
  const prefix = `${server}/`;
  return (
    `You MUST deliver your reply on this channel by calling a tool that sends an outbound message. ` +
    `Choose a tool whose name starts with "${prefix}" and whose documented purpose is to send, post, DM, or reply to a user or chat. ` +
    `Pass "${params.sender}" as the argument value that identifies this conversation partner (recipient, chat id, user id, peer, thread, etc. — use the parameter name required by that tool). ` +
    `Do not end your turn without such a tool call. ` +
    `If you need multiple steps, call it first with a brief acknowledgement, then again with your final answer.`
  );
}

/**
 * Build the full enriched instruction sent to executeEvent().
 * Stacks: episodic context → conversation history → behavioral nudge → user message.
 */
export function buildEnrichedInstruction(params: {
  sender: string;
  platform: string;
  mcpServer: string;
  message: string;
  historyBlock: string;
  episodicBlock: string;
}): string {
  const parts: string[] = [];
  if (params.episodicBlock) parts.push(params.episodicBlock);
  if (params.historyBlock) parts.push(params.historyBlock);

  parts.push(
    `You are in a live conversation with ${params.sender} on ${params.platform}.\n\n` +
      `User: ${params.message}\n\n` +
      channelOutboundToolGuidance({
        mcpServer: params.mcpServer,
        sender: params.sender,
      }),
  );
  return parts.join("\n\n");
}

// ─── GatewayChatManager ───────────────────────────────────────────────────────

/** Dependencies injected by start() — all async, no Effect required at this layer. */
export interface GatewayChatManagerDeps {
  readonly agentId: string;
  readonly sessionTtlDays: number;
  readonly executeEvent: (event: unknown, source: string, instruction: string) => Promise<string | undefined>;
  readonly logEpisode: (entry: {
    id: string;
    agentId: string;
    date: string;
    content: string;
    eventType: string;
    createdAt: Date;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  readonly saveSession: (input: {
    sessionId: string;
    agentId: string;
    messages: ChatMessage[];
  }) => Promise<void>;
  readonly findById: (sessionId: string) => Promise<{ messages: ChatMessage[] } | null>;
  readonly getRecentEpisodes: (agentId: string, limit: number) => Promise<readonly { eventType?: string; content?: string }[]>;
  readonly cleanup: (ttlDays: number) => Promise<number>;
}

export class GatewayChatManager {
  private readonly histories = new Map<string, ChatMessage[]>();
  private lastPruneAt = 0;

  constructor(private readonly deps: GatewayChatManagerDeps) {}

  private sessionKey(senderId: string): string {
    return `gateway-chat-${this.deps.agentId}-${senderId}`;
  }

  async getOrLoadHistory(senderId: string): Promise<ChatMessage[]> {
    if (this.histories.has(senderId)) {
      return this.histories.get(senderId)!;
    }
    const record = await this.deps.findById(this.sessionKey(senderId));
    const history = record?.messages ?? [];
    this.histories.set(senderId, history);
    return history;
  }

  async handleMessage(
    sender: string,
    message: string,
    platform: string,
    mcpServer: string,
    gwEvent: unknown,
  ): Promise<void> {
    const history = await this.getOrLoadHistory(sender);

    const windowed = applyHistoryWindow(history);
    const episodes = await this.deps.getRecentEpisodes(this.deps.agentId, 8);

    const filtered = episodes.filter((e) => e.eventType !== "chat-turn");
    const episodicBlock = formatEpisodicContext(filtered);
    const historyBlock = formatHistoryBlock(windowed);
    const instruction = buildEnrichedInstruction({
      sender,
      platform,
      mcpServer,
      message,
      historyBlock,
      episodicBlock,
    });

    let runOutput: string;
    try {
      const output = await this.deps.executeEvent(gwEvent, "channel", instruction);
      runOutput = output ?? `(reply sent via ${platform})`;
    } catch (err) {
      runOutput = `(error: ${err instanceof Error ? err.message : String(err)})`;
    }

    const now = new Date();
    history.push({ role: "user", content: message, timestamp: now.getTime() });
    history.push({ role: "assistant", content: runOutput, timestamp: now.getTime() });

    await Promise.all([
      this.deps.saveSession({
        sessionId: this.sessionKey(sender),
        agentId: this.deps.agentId,
        messages: history,
      }),
      this.deps.logEpisode({
        id: `chat-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: this.deps.agentId,
        date: now.toISOString().slice(0, 10),
        content: `${sender} (${platform}): ${message.slice(0, 200)} → ${runOutput.slice(0, 300)}`,
        eventType: "chat-turn",
        createdAt: now,
        metadata: { sender, platform },
      }),
    ]);
  }

  async pruneStaleSessions(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPruneAt < 86_400_000) return;
    this.lastPruneAt = now;
    await this.deps.cleanup(this.deps.sessionTtlDays);
  }

  async dispose(): Promise<void> {
    this.histories.clear();
  }
}
