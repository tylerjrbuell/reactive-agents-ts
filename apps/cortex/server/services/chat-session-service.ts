import type { Database } from "bun:sqlite";
import { generateTaskId } from "@reactive-agents/core";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { AgentSession, type ChatMessage, type ChatOptions, type AgentStreamEvent } from "@reactive-agents/runtime";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  appendChatTurn,
  getChatTurns,
  updateSessionLastUsed,
  renameSession as renameChatSessionInDb,
  type ChatSessionRow,
  type ChatTurnRow,
} from "../db/chat-queries.js";
import { mergeCortexAllowedTools, coerceTaskContextRecord } from "./cortex-agent-config.js";
import { buildCortexAgent } from "./build-cortex-agent.js";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";
import { buildRunTaskContext } from "./chat-run-context.js";

function turnsToChatMessages(turns: ChatTurnRow[]): ChatMessage[] {
  return turns.map((t) => ({
    role: t.role,
    content: t.content,
    timestamp: t.ts,
  }));
}

export type CortexChatResult = {
  reply: string;
  tokensUsed: number;
  toolsUsed?: string[];
  steps?: number;
  cost?: number;
};

export class ChatSessionService {
  private readonly db: Database;
  /** In-memory cache of live agent sessions keyed by Cortex session ID. */
  private readonly sessions = new Map<string, AgentSession>();

  constructor(db: Database) {
    this.db = db;
  }

  async createSession(opts: { name?: string; agentConfig: Record<string, unknown> }): Promise<string> {
    const stableAgentId = generateTaskId();
    return createChatSession(this.db, { ...opts, stableAgentId });
  }

  listSessions(): ChatSessionRow[] {
    return listChatSessions(this.db);
  }

  getSession(sessionId: string): (ChatSessionRow & { turns: ChatTurnRow[] }) | null {
    const session = getChatSession(this.db, sessionId);
    if (!session) return null;
    const turns = getChatTurns(this.db, sessionId);
    return { ...session, turns };
  }

  deleteSession(sessionId: string): boolean {
    this.sessions.delete(sessionId);
    return deleteChatSession(this.db, sessionId);
  }

  renameSession(sessionId: string, name: string): void {
    renameChatSessionInDb(this.db, sessionId, name);
  }

  async chat(sessionId: string, message: string): Promise<CortexChatResult> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);

    const cfg = row.agentConfig;
    const enableTools = cfg.enableTools === true;

    let agentSession = this.sessions.get(sessionId);
    if (!agentSession) {
      agentSession = await this.buildSession(sessionId, cfg, row.stableAgentId);
      this.sessions.set(sessionId, agentSession);
    }

    appendChatTurn(this.db, { sessionId, role: "user", content: message, tokensUsed: 0 });

    /** Playground-style explicit routing — avoids accidental tool runs when tools are off. */
    const chatOpts: ChatOptions = enableTools ? { useTools: true } : { useTools: false };

    const chatReply = await agentSession.chat(message, chatOpts);
    const reply = chatReply.message;
    const tokensUsed = chatReply.tokens ?? 0;
    const toolsUsed = chatReply.toolsUsed;

    appendChatTurn(this.db, {
      sessionId,
      role: "assistant",
      content: reply,
      tokensUsed,
      ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
    });
    updateSessionLastUsed(this.db, sessionId);

    return {
      reply,
      tokensUsed,
      ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
      ...(chatReply.steps != null ? { steps: chatReply.steps } : {}),
      ...(chatReply.cost != null ? { cost: chatReply.cost } : {}),
    };
  }

  async *chatStream(sessionId: string, message: string): AsyncGenerator<AgentStreamEvent> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);

    const cfg = row.agentConfig;
    const enableTools = cfg.enableTools === true;

    const provider = (cfg.provider as string | undefined) ?? "anthropic";
    const agentName = `chat-${sessionId.slice(0, 8)}`;
    const stableAgentId = row.stableAgentId;

    // Build agent for streaming (not using AgentSession, just raw agent)
    const agent = await buildCortexAgent({
      agentName,
      provider,
      ...(stableAgentId ? { agentId: stableAgentId } : {}),
      memory: { episodic: true },
      streaming: true,
      ...(typeof cfg.model === "string" && cfg.model.trim()
        ? { model: cfg.model.trim() }
        : {}),
      ...(typeof cfg.systemPrompt === "string" && cfg.systemPrompt.trim()
        ? { systemPrompt: cfg.systemPrompt.trim() }
        : {}),
      ...(typeof cfg.temperature === "number" ? { temperature: cfg.temperature } : {}),
      ...(typeof cfg.maxTokens === "number" && cfg.maxTokens > 0
        ? { maxTokens: cfg.maxTokens }
        : {}),
      ...(enableTools
        ? {
            tools: mergeCortexAllowedTools(
              Array.isArray(cfg.tools)
                ? (cfg.tools as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
                : [],
              undefined,
              {},
            ),
            strategy: "reactive",
            maxIterations:
              typeof cfg.maxIterations === "number" && cfg.maxIterations > 0
                ? cfg.maxIterations
                : 12,
          }
        : {}),
    });

    appendChatTurn(this.db, { sessionId, role: "user", content: message, tokensUsed: 0 });

    let tokensUsed = 0;
    let toolsUsed: string[] = [];
    let steps = 0;
    let replyText = "";

    try {
      for await (const event of agent.runStream(message, { density: "tokens" })) {
        if (event._tag === "TextDelta") {
          replyText += event.text;
        } else if (event._tag === "StreamCompleted") {
          tokensUsed = event.metadata.tokensUsed ?? 0;
          steps = event.metadata.iterations ?? 0;
          // Collect tool names from toolSummary if available
          if (event.toolSummary && event.toolSummary.length > 0) {
            toolsUsed = event.toolSummary.map((t) => t.name);
          }
        }
        yield event;
      }
    } catch (e) {
      throw e;
    }

    // Append assistant turn to database
    appendChatTurn(this.db, {
      sessionId,
      role: "assistant",
      content: replyText,
      tokensUsed,
      ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
    });
    updateSessionLastUsed(this.db, sessionId);
  }

  private async buildSession(
    sessionId: string,
    agentConfig: Record<string, unknown>,
    stableAgentId?: string,
  ): Promise<AgentSession> {
    const provider = (agentConfig.provider as string | undefined) ?? "test";
    const enableTools = agentConfig.enableTools === true;

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

    const rawScenario = agentConfig.testScenario;
    const customTestScenario =
      Array.isArray(rawScenario) && rawScenario.length > 0 ? (rawScenario as TestTurn[]) : undefined;

    const params: BuildCortexAgentParams = {
      agentName: `chat-${sessionId.slice(0, 8)}`,
      provider,
      ...(stableAgentId ? { agentId: stableAgentId } : {}),
      memory: { episodic: true },
      ...(typeof agentConfig.model === "string" && agentConfig.model.trim()
        ? { model: agentConfig.model.trim() }
        : {}),
      ...(typeof agentConfig.systemPrompt === "string" && agentConfig.systemPrompt.trim()
        ? { systemPrompt: agentConfig.systemPrompt.trim() }
        : {}),
      ...(typeof agentConfig.temperature === "number" ? { temperature: agentConfig.temperature } : {}),
      ...(typeof agentConfig.maxTokens === "number" && agentConfig.maxTokens > 0
        ? { maxTokens: agentConfig.maxTokens }
        : {}),
      ...(enableTools
        ? {
            tools: mergedTools,
            strategy: "reactive",
            maxIterations:
              typeof agentConfig.maxIterations === "number" && agentConfig.maxIterations > 0
                ? agentConfig.maxIterations
                : 12,
          }
        : {}),
      ...(Object.keys(taskContext).length > 0 ? { taskContext } : {}),
      ...(customTestScenario && provider === "test"
        ? { testScenario: customTestScenario }
        : provider === "test"
          ? { testScenario: [{ text: "Cortex chat test reply." }] }
          : {}),
    };

    const agent = await buildCortexAgent(params);
    const turns = getChatTurns(this.db, sessionId);
    const initialHistory = turnsToChatMessages(turns);
    return new AgentSession(
      (msg, hist, opts) => agent.chat(msg, opts, hist, sessionId),
      undefined,
      undefined,
      initialHistory.length > 0 ? initialHistory : undefined,
    );
  }
}
