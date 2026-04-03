/**
 * Pure helpers to turn persisted `ReasoningStepCompleted` payloads into UI thread rows.
 * Shared contract: Cortex API and the run-detail message-count badge must match.
 */

export type ReasoningDisplayMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; [key: string]: unknown }>;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  toolName?: string;
  toolCallId?: string;
};

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Prefer `messages` when the framework logged full model I/O (`logModelIO`).
 * Otherwise synthesize a short thread from `prompt`, `thought`, `action`, and `observation`
 * so plan-execute-reflect and similar strategies still show up in the Messages panel.
 */
export function extractReasoningStepDisplayMessages(
  parsed: Record<string, unknown>,
): ReasoningDisplayMessage[] {
  if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
    return parsed.messages as ReasoningDisplayMessage[];
  }

  const out: ReasoningDisplayMessage[] = [];
  const prompt = parsed.prompt;
  if (prompt && typeof prompt === "object" && prompt !== null) {
    const p = prompt as { system?: unknown; user?: unknown };
    if (nonEmptyString(p.system)) {
      out.push({ role: "system", content: p.system });
    }
    if (nonEmptyString(p.user)) {
      out.push({ role: "user", content: p.user });
    }
  }
  if (nonEmptyString(parsed.thought)) {
    out.push({ role: "assistant", content: parsed.thought });
  }
  if (nonEmptyString(parsed.action)) {
    out.push({ role: "assistant", content: parsed.action });
  }
  if (nonEmptyString(parsed.observation)) {
    out.push({ role: "tool", content: parsed.observation });
  }
  if (nonEmptyString(parsed.rawResponse)) {
    out.push({ role: "assistant", content: parsed.rawResponse });
  }
  return out;
}

export function countReasoningStepDisplayMessagesInRunEvents(
  events: ReadonlyArray<{ type: string; payload: Record<string, unknown> }>,
): number {
  let n = 0;
  for (const e of events) {
    if (e.type !== "ReasoningStepCompleted") continue;
    n += extractReasoningStepDisplayMessages(e.payload).length;
  }
  return n;
}

export function numericKernelPassFromPayload(
  parsed: Record<string, unknown>,
  fallbackOneBased: number,
): number {
  const k = parsed.kernelPass;
  return typeof k === "number" && Number.isFinite(k) ? k : fallbackOneBased;
}

export function phaseLabelFromPayload(parsed: Record<string, unknown>): string | undefined {
  const k = parsed.kernelPass;
  return typeof k === "string" && k.trim() ? k : undefined;
}
