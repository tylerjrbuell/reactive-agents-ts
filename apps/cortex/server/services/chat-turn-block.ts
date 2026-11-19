/**
 * Why a user turn is refused before it starts (a plain 409, not a mid-run failure): the session
 * is pursuing a goal, or its strategy cannot run behind its approval gate (code-action, see
 * strategy-conflict-guard.ts).
 */
import type { ChatGoalService } from "./chat-goal-service.js";
import type { ChatSessionService } from "./chat-session-service.js";
import { normalizeCortexAgentConfig } from "./cortex-agent-config.js";
import { resolveEnableTools } from "./chat-tool-params.js";
import { strategyConflictBodyOf } from "./strategy-conflict-guard.js";

/** The 409 body for a session's strategy / approval-gate conflict, or `undefined`. */
export function sessionStrategyConflict(svc: Pick<ChatSessionService, "sessionConfig">, sessionId: string) {
  const raw = svc.sessionConfig(sessionId);
  if (!raw) return undefined;
  const cfg = normalizeCortexAgentConfig(raw);
  return strategyConflictBodyOf(cfg, { toolsEnabled: resolveEnableTools(cfg) });
}

/** 409 body naming why the session cannot take a user turn, or null when it can. */
export function turnBlockOf(goals: ChatGoalService | undefined, svc: Pick<ChatSessionService, "sessionConfig">, sessionId: string): { error: string } | null {
  const g = goals?.activeGoal(sessionId);
  if (g) return { error: `Session is pursuing a goal: "${g.objective}". Pause or cancel the goal to chat.` };
  return sessionStrategyConflict(svc, sessionId) ?? null;
}
