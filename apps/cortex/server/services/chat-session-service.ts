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
  updateSessionAgentConfig,
  type ChatSessionRow,
  type ChatTurnRow,
} from "../db/chat-queries.js";
import {
  mergeCortexAllowedTools,
  coerceTaskContextRecord,
  normalizeCortexAgentConfig,
} from "./cortex-agent-config.js";
import { buildCortexAgent } from "./build-cortex-agent.js";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";
import { buildRunTaskContext } from "./chat-run-context.js";

const VALID_REASONING_STRATEGIES = new Set([
  "reactive",
  "plan-execute-reflect",
  "tree-of-thought",
  "reflexion",
  "adaptive",
]);

const DEFAULT_TOOL_CHAT_PERSONA: NonNullable<BuildCortexAgentParams["persona"]> = {
  enabled: true,
  role: "Tool-first problem solver",
  tone: "technical",
  traits:
    "Think step-by-step, then call tools immediately when needed. Avoid repeating the same thought without acting. Prefer clear tool calls with exact schema parameter names.",
  responseStyle: "structured",
};

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
    const normalizedAgentConfig = normalizeCortexAgentConfig(opts.agentConfig);
    return createChatSession(this.db, { ...opts, agentConfig: normalizedAgentConfig, stableAgentId });
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

  updateSessionConfig(sessionId: string, configPatch: Record<string, unknown>): void {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);

    const merged = { ...row.agentConfig, ...configPatch };
    const normalized = normalizeCortexAgentConfig(merged);
    const updated = updateSessionAgentConfig(this.db, sessionId, normalized);
    if (!updated) throw new Error(`Chat session ${sessionId} not found`);

    // Force next turn to rebuild AgentSession with updated config.
    this.sessions.delete(sessionId);
  }

  async chat(sessionId: string, message: string): Promise<CortexChatResult> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);

    const cfg = normalizeCortexAgentConfig(row.agentConfig);
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

    const cfg = normalizeCortexAgentConfig(row.agentConfig);
    const stableAgentId = row.stableAgentId;
    const enableTools = cfg.enableTools === true;
    const streamReasoningSteps = cfg.streamReasoningSteps === true;

    // Direct conversational path: preserve full session history + run grounding even when tools are off.
    // We still expose SSE shape so Run Chat and main Chat panel behave consistently.
    if (!enableTools && !streamReasoningSteps) {
      let agentSession = this.sessions.get(sessionId);
      if (!agentSession) {
        agentSession = await this.buildSession(sessionId, cfg, stableAgentId);
        this.sessions.set(sessionId, agentSession);
      }

      appendChatTurn(this.db, { sessionId, role: "user", content: message, tokensUsed: 0 });

      let replyText = "";
      let tokensUsed = 0;
      let steps = 0;
      let toolsUsed: string[] = [];
      let cost = 0;

      try {
        const chatReply = await agentSession.chat(message, { useTools: false });
        replyText = chatReply.message;
        tokensUsed = chatReply.tokens ?? 0;
        steps = chatReply.steps ?? 0;
        toolsUsed = chatReply.toolsUsed ?? [];
        cost = chatReply.cost ?? 0;

        if (replyText.length > 0) {
          yield { _tag: "TextDelta", text: replyText };
        }

        const completedEvent: AgentStreamEvent = {
          _tag: "StreamCompleted",
          output: replyText,
          metadata: {
            tokensUsed,
            cost,
            stepsCount: steps,
            iterations: steps,
          } as Record<string, unknown>,
        };
        if (toolsUsed.length > 0) {
          completedEvent.toolSummary = toolsUsed.map((name) => ({ name, calls: 1, avgMs: 0 }));
        }
        yield completedEvent;
      } catch (e) {
        const cause = e instanceof Error ? e.message : String(e);
        yield { _tag: "StreamError", cause };
      } finally {
        appendChatTurn(this.db, {
          sessionId,
          role: "assistant",
          content: replyText,
          tokensUsed,
          ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
        });
        updateSessionLastUsed(this.db, sessionId);
      }

      return;
    }

    /** Must mirror {@link buildSession} so run-linked desk chat keeps debrief + event context over SSE. */
    const params = this.buildChatAgentParams(sessionId, cfg, stableAgentId, { streaming: true });
    const agent = await buildCortexAgent(params);

    appendChatTurn(this.db, { sessionId, role: "user", content: message, tokensUsed: 0 });

    let tokensUsed = 0;
    let toolsUsed: string[] = [];
    let steps = 0;
    let replyText = "";

    try {
      for await (const event of agent.runStream(message, { density: streamReasoningSteps ? "full" : "tokens" })) {
        if (event._tag === "TextDelta") {
          replyText += event.text;
        } else if (event._tag === "StreamCompleted") {
          tokensUsed = event.metadata.tokensUsed ?? 0;
          steps = event.metadata.stepsCount ?? 0;
          // Collect tool names from toolSummary if available
          if (event.toolSummary && event.toolSummary.length > 0) {
            toolsUsed = event.toolSummary.map((t) => t.name);
          }
          // StreamCompleted.output is the authoritative final answer after post-processing
          // (verification, retries, synthesis). Always prefer it when present.
          const out = typeof event.output === "string" ? event.output.trim() : "";
          if (out.length > 0) {
            replyText = out;
          }
        }
        yield event;
      }
    } finally {
      // SSE handler closes the stream right after StreamCompleted, which aborts this generator
      // before code after the loop would run — `finally` still runs on generator return/cleanup.
      appendChatTurn(this.db, {
        sessionId,
        role: "assistant",
        content: replyText,
        tokensUsed,
        ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
      });
      updateSessionLastUsed(this.db, sessionId);
    }
  }

  private async buildSession(
    sessionId: string,
    agentConfig: Record<string, unknown>,
    stableAgentId?: string,
  ): Promise<AgentSession> {
    const params = this.buildChatAgentParams(sessionId, agentConfig, stableAgentId, { streaming: false });
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

  /**
   * Single source of truth for desk chat agent wiring (non-stream and SSE).
   * Keeps run-linked `taskContext` (`buildRunTaskContext`) aligned with `chatStream`.
   */
  private buildChatAgentParams(
    sessionId: string,
    agentConfig: Record<string, unknown>,
    stableAgentId: string | undefined,
    opts: { readonly streaming: boolean },
  ): BuildCortexAgentParams {
    const provider = (agentConfig.provider as string | undefined) ?? "test";
    const enableTools = agentConfig.enableTools === true;

    const rawStrategy = typeof agentConfig.strategy === "string" ? agentConfig.strategy.trim() : "";
    const configuredStrategy =
      rawStrategy.length > 0 && VALID_REASONING_STRATEGIES.has(rawStrategy)
        ? rawStrategy
        : undefined;
    const effectiveStrategy = enableTools
      ? configuredStrategy ?? "plan-execute-reflect"
      : configuredStrategy;

    const strategySwitchingExplicit =
      typeof agentConfig.strategySwitching === "boolean" ? agentConfig.strategySwitching : undefined;
    const runtimeVerificationExplicit =
      typeof agentConfig.runtimeVerification === "boolean" ? agentConfig.runtimeVerification : undefined;
    const verificationStepRaw =
      agentConfig.verificationStep === "reflect" || agentConfig.verificationStep === "none"
        ? (agentConfig.verificationStep as "reflect" | "none")
        : undefined;
    const effectiveVerificationStep = enableTools ? verificationStepRaw ?? "reflect" : verificationStepRaw;

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

    return {
      agentName: `chat-${sessionId.slice(0, 8)}`,
      provider,
      ...(stableAgentId ? { agentId: stableAgentId } : {}),
      memory: { episodic: true },
      ...(opts.streaming ? { streaming: true } : {}),
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
            strategy: effectiveStrategy,
            maxIterations:
              typeof agentConfig.maxIterations === "number" && agentConfig.maxIterations > 0
                ? agentConfig.maxIterations
                : 16,
          }
        : {}),
      ...(effectiveVerificationStep ? { verificationStep: effectiveVerificationStep } : {}),
      ...((enableTools ? strategySwitchingExplicit ?? true : strategySwitchingExplicit) === true
        ? { strategySwitching: true }
        : {}),
      ...((enableTools ? runtimeVerificationExplicit ?? true : runtimeVerificationExplicit) === true
        ? { runtimeVerification: true }
        : {}),
      ...(contextSynthesis ? { contextSynthesis } : {}),
      ...(guardrails ? { guardrails } : {}),
      ...(persona ? { persona } : {}),
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
    };
  }
}
