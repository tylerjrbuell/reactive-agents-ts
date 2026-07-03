import { useMemo } from "react";
import type { RunState } from "@reactive-agents/ui-core";

export interface StepEntry {
  readonly kind: "tool" | "thought" | "iteration";
  readonly label: string;
  readonly seq?: number;
  readonly durationMs?: number;
  readonly success?: boolean;
}

export function useRunSteps(state: RunState): readonly StepEntry[] {
  return useMemo(() => {
    const out: StepEntry[] = [];
    // Tracks the array index of the in-flight "tool" entry for a given
    // callId so a later ToolCallCompleted merges into the same row instead
    // of appending a second, duration/success-less row for the same call.
    const toolIndexByCallId = new Map<string, number>();
    for (const e of state.events) {
      switch (e._tag) {
        case "ToolCallStarted": {
          toolIndexByCallId.set(e.callId, out.length);
          out.push({ kind: "tool", label: `→ ${e.toolName}`, seq: e.seq });
          break;
        }
        case "ToolCallCompleted": {
          const entry: StepEntry = {
            kind: "tool",
            label: `✓ ${e.toolName}`,
            seq: e.seq,
            durationMs: e.durationMs,
            success: e.success,
          };
          const idx = toolIndexByCallId.get(e.callId);
          if (idx !== undefined) {
            out[idx] = entry;
          } else {
            out.push(entry);
          }
          break;
        }
        case "ThoughtEmitted":
          out.push({ kind: "thought", label: e.content.slice(0, 80), seq: e.seq });
          break;
        case "IterationProgress":
          out.push({ kind: "iteration", label: `iteration ${e.iteration}`, seq: e.seq });
          break;
        default:
          break;
      }
    }
    return out;
  }, [state.events]);
}
