import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";

export const compactHistoryStage = (c: AssemblyCtx): AssemblyCtx => {
  const totalChars = c.messages.reduce((n, m) => n + (m.content ?? "").length, 0);
  const limitChars = c.capability.window * 4; // window (tokens) → chars
  if (totalChars <= limitChars) {
    return { ...c, trace: pushStage(c.trace, "compactHistory", "under limit, no-op") };
  }
  let half = Math.floor(c.messages.length / 2);
  // Never orphan a tool_result from its assistant tool_use: advance the cut
  // forward until the kept slice does NOT begin with a tool_result (which would
  // be a dangling answer to a tool_use that compaction just dropped — invalid
  // for Anthropic/OpenAI native-FC).
  while (half < c.messages.length && c.messages[half]?.role === "tool_result") half++;
  const kept = c.messages.slice(half);
  const summary = { role: "user" as const, content: `[history compacted: ${half} earlier messages summarized]` };
  return {
    ...c,
    messages: [summary, ...kept],
    trace: pushStage(c.trace, "compactHistory", `compacted ${half} msgs`),
  };
};
