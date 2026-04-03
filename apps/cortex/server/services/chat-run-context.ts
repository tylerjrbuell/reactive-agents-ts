import type { Database } from "bun:sqlite";
import { getRunDetail, getRunEvents } from "../db/queries.js";

const MAX_DEBRIEF_CHARS = 12_000;
const MAX_EVENTS = 40;
const MAX_EVENT_PAYLOAD = 500;

function formatDebriefForContext(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    const j = JSON.parse(t) as { summary?: string; outcome?: string; keyFindings?: string[] };
    const parts: string[] = [];
    if (typeof j.outcome === "string") parts.push(`Outcome: ${j.outcome}`);
    if (typeof j.summary === "string") parts.push(`Summary: ${j.summary}`);
    if (Array.isArray(j.keyFindings) && j.keyFindings.length > 0) {
      parts.push(`Key findings:\n${j.keyFindings.map((f) => `- ${f}`).join("\n")}`);
    }
    if (parts.length > 0) return parts.join("\n");
  } catch {
    /* not JSON */
  }
  return t.length > MAX_DEBRIEF_CHARS ? `${t.slice(0, MAX_DEBRIEF_CHARS)}\n…` : t;
}

/**
 * Builds {@link import("@reactive-agents/runtime").ReactiveAgentBuilder.withTaskContext} fields
 * from a persisted Cortex run so desk chat can continue in the same factual context.
 */
export function buildRunTaskContext(db: Database, runId: string): Record<string, string> | null {
  const detail = getRunDetail(db, runId);
  if (!detail) return null;

  const parts: string[] = [];
  parts.push(`You are continuing a conversation after a completed agent run in Cortex.`);
  parts.push(`Run ID: ${detail.runId}`);
  parts.push(`Agent ID: ${detail.agentId}`);
  parts.push(`Status: ${detail.status}`);
  parts.push(`Iterations: ${detail.iterationCount}; tokens used: ${detail.tokensUsed}; cost (USD): ${detail.cost}`);
  if (detail.provider) {
    parts.push(`Original provider/model: ${detail.provider}${detail.model ? ` / ${detail.model}` : ""}`);
  }
  if (detail.strategy) parts.push(`Reasoning strategy used: ${detail.strategy}`);

  if (detail.debrief) {
    const debriefBlock = formatDebriefForContext(detail.debrief);
    if (debriefBlock) {
      parts.push("");
      parts.push("## Prior run debrief");
      parts.push(debriefBlock);
    }
  }

  const events = getRunEvents(db, runId);
  const tail = events.slice(-MAX_EVENTS);
  if (tail.length > 0) {
    parts.push("");
    parts.push("## Recent run events (chronological)");
    for (const e of tail) {
      let p = e.payload.slice(0, MAX_EVENT_PAYLOAD);
      if (e.payload.length > MAX_EVENT_PAYLOAD) p += "…";
      parts.push(`- ${e.type}: ${p}`);
    }
  }

  return {
    cortexPriorRun: parts.join("\n"),
    cortexRunId: detail.runId,
  };
}
