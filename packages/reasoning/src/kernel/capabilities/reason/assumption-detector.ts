import type { Rationale } from "@reactive-agents/core";

/**
 * Extract self-reported assumptions from a think-phase thought string.
 * Matches "I assume X." and "I assume X because Y." (case-insensitive, also "I am assuming X").
 * Capped at 3 results per call to avoid bloating the trace when models go verbose.
 *
 * Returns [] when no assumption marker is present. Pure function; safe to call
 * from anywhere in the kernel.
 */
export type DetectedAssumption = {
  readonly assumption: string;
  readonly rationale: Rationale;
};

const ASSUMPTION_RE = /I\s+(?:am\s+)?assum(?:e|ing)\s+(?:that\s+)?([^.\n]+?)(?:\s+because\s+([^.\n]+))?\./gi;
const MAX_ASSUMPTIONS = 3;

export function detectAssumptions(thoughtText: string): DetectedAssumption[] {
  if (!thoughtText) return [];
  const out: DetectedAssumption[] = [];
  let match: RegExpExecArray | null;
  // Reset regex state (g flag carries lastIndex across calls otherwise)
  ASSUMPTION_RE.lastIndex = 0;
  while ((match = ASSUMPTION_RE.exec(thoughtText)) !== null) {
    if (out.length >= MAX_ASSUMPTIONS) break;
    const rawA = match[1]?.trim() ?? "";
    const rawR = match[2]?.trim();
    if (!rawA) continue;
    // Cap lengths defensively — assumptions are usually short, but a runaway
    // sentence shouldn't blow past Rationale.why's 280-char limit.
    const assumption = rawA.length > 240 ? rawA.slice(0, 240) : rawA;
    const why = rawR && rawR.length > 0
      ? (rawR.length > 280 ? rawR.slice(0, 280) : rawR)
      : "implicit";
    out.push({ assumption, rationale: { why } });
  }
  return out;
}
