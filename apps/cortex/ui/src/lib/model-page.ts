/**
 * Model page rules (`/models/[provider]/[...model]`, Bench spec section 8):
 * the capability stat grid, the remaining capability rows, and the note on
 * what runs on this model actually used. Rendering lives in the route.
 */
import { formatTokens } from "@reactive-agents/ui-core";
import type { RunRow } from "./runs-table.js";

/** `GET /api/models/capability` for one provider/model. */
export interface ModelCapability {
  readonly maxContextTokens: number;
  readonly recommendedNumCtx: number;
  readonly maxOutputTokens: number;
  readonly supportsThinking: boolean;
  readonly supportsVision: boolean;
  readonly supportsPromptCaching: boolean;
  readonly toolCallDialect: string;
  readonly tier: string;
  /** `fallback` when the model is not in the shipped capability table. */
  readonly source: string;
  /** `null` for providers that need no key. */
  readonly keyConfigured: boolean | null;
}

/** One labelled capability value (values are machine values: set in mono). */
export interface CapabilityItem {
  readonly label: string;
  readonly value: string;
}

const yesNo = (b: boolean): string => (b ? "yes" : "no");
const count = (n: number): string => n.toLocaleString("en-US");

/** The four headline stats (the mockup's grid): context, max output, tool calls, thinking. */
export function capabilityStats(cap: ModelCapability): CapabilityItem[] {
  return [
    { label: "Context window", value: count(cap.maxContextTokens) },
    { label: "Max output", value: count(cap.maxOutputTokens) },
    { label: "Tool calls", value: cap.toolCallDialect },
    { label: "Thinking", value: yesNo(cap.supportsThinking) },
  ];
}

/** The rest of the capability record, as rows under the grid. */
export function capabilityRows(cap: ModelCapability): CapabilityItem[] {
  return [
    { label: "Working context", value: `${count(cap.recommendedNumCtx)} tokens` },
    { label: "Vision", value: yesNo(cap.supportsVision) },
    { label: "Prompt caching", value: yesNo(cap.supportsPromptCaching) },
    { label: "Tier", value: cap.tier },
  ];
}

/** Runs recorded with exactly this provider and model, newest first. */
export function runsOnModel(rows: readonly RunRow[], provider: string, model: string): RunRow[] {
  return rows
    .filter((r) => r.provider === provider && r.model === model)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * The capability note: whether the values are measured or fallback defaults,
 * then what recorded runs on this model used (the largest run's total
 * tokens), so a declared number and real use sit side by side (spec G5).
 * `null` when there is nothing to say.
 */
export function capabilityNote(cap: ModelCapability, runs: readonly RunRow[]): string | null {
  const parts: string[] = [];
  if (cap.source === "fallback") {
    parts.push("Not in the shipped capability table: these are conservative defaults, not measured values.");
  }
  const used = runs.reduce((max, r) => Math.max(max, r.tokensUsed), 0);
  if (used > 0) {
    const n = runs.length;
    parts.push(`${n} recorded ${n === 1 ? "run" : "runs"} on this model; the largest used ${formatTokens(used)} tokens in total.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
