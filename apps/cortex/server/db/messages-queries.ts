import type { Database } from "bun:sqlite";

export type KernelMessageRole = "system" | "user" | "assistant" | "tool";

export type KernelMessage = {
  role: KernelMessageRole;
  content: string | Array<{ type: string; [key: string]: unknown }>;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  toolName?: string;
  toolCallId?: string;
};

export type MessageGroup = {
  seq: number;
  kernelPass: number;
  step: number;
  totalSteps: number;
  strategy: string;
  messages: KernelMessage[];
};

export function getRunMessages(db: Database, runId: string): MessageGroup[] {
  const rows = db
    .prepare(
      `SELECT seq, payload FROM cortex_events
       WHERE run_id = ? AND type = 'ReasoningStepCompleted'
       ORDER BY seq ASC`,
    )
    .all(runId) as Array<{ seq: number; payload: string }>;

  const groups: MessageGroup[] = [];
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const messages = Array.isArray(parsed.messages) ? (parsed.messages as KernelMessage[]) : [];
    if (messages.length === 0) continue;
    groups.push({
      seq: row.seq,
      kernelPass: typeof parsed.kernelPass === "number" ? parsed.kernelPass : groups.length + 1,
      step: typeof parsed.step === "number" ? parsed.step : 1,
      totalSteps: typeof parsed.totalSteps === "number" ? parsed.totalSteps : 1,
      strategy: typeof parsed.strategy === "string" ? parsed.strategy : "unknown",
      messages,
    });
  }
  return groups;
}
