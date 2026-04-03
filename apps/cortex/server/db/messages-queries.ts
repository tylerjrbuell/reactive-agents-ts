import type { Database } from "bun:sqlite";
import {
  extractReasoningStepDisplayMessages,
  numericKernelPassFromPayload,
  phaseLabelFromPayload,
} from "../../messages-extract.js";

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
  /** When `kernelPass` was a string (e.g. `plan-execute:step-1:done`), show this in the UI header. */
  phaseLabel?: string;
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
    const messages = extractReasoningStepDisplayMessages(parsed) as KernelMessage[];
    if (messages.length === 0) continue;
    const phaseLabel = phaseLabelFromPayload(parsed);
    groups.push({
      seq: row.seq,
      kernelPass: numericKernelPassFromPayload(parsed, groups.length + 1),
      ...(phaseLabel !== undefined ? { phaseLabel } : {}),
      step: typeof parsed.step === "number" ? parsed.step : 1,
      totalSteps: typeof parsed.totalSteps === "number" ? parsed.totalSteps : 1,
      strategy: typeof parsed.strategy === "string" ? parsed.strategy : "unknown",
      messages,
    });
  }
  return groups;
}
