/**
 * In-memory map: Cortex run id → desk chat session id for the Run detail "Chat" tab.
 * Survives switching bottom tabs so the thread is not recreated on each visit.
 */
const sessionByRunId = new Map<string, string>();

export function peekRunChatSession(runId: string): string | undefined {
  return sessionByRunId.get(runId);
}

export function rememberRunChatSession(runId: string, sessionId: string): void {
  sessionByRunId.set(runId, sessionId);
}

export function forgetRunChatSession(runId: string): void {
  sessionByRunId.delete(runId);
}
