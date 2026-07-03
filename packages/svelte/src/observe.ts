// packages/svelte/src/observe.ts
import type { RunState } from "@reactive-agents/ui-core";

export interface StepEntry {
  readonly kind: "tool" | "thought" | "iteration";
  readonly label: string;
  readonly seq?: number;
  readonly durationMs?: number;
  readonly success?: boolean;
}

export function runCost(state: RunState): { tokens: number; usd: number } {
  return state.cost ?? { tokens: 0, usd: 0 };
}

export function runSteps(state: RunState): readonly StepEntry[] {
  const out: StepEntry[] = [];
  for (const e of state.events) {
    switch (e._tag) {
      case "ToolCallStarted":
        out.push({ kind: "tool", label: `→ ${(e as { toolName: string }).toolName}`, seq: e.seq });
        break;
      case "ToolCallCompleted": {
        const c = e as { toolName: string; durationMs: number; success: boolean };
        out.push({ kind: "tool", label: `✓ ${c.toolName}`, seq: e.seq, durationMs: c.durationMs, success: c.success });
        break;
      }
      case "ThoughtEmitted":
        out.push({ kind: "thought", label: (e as { content: string }).content.slice(0, 80), seq: e.seq });
        break;
      case "IterationProgress":
        out.push({ kind: "iteration", label: `iteration ${(e as { iteration: number }).iteration}`, seq: e.seq });
        break;
      default:
        break;
    }
  }
  return out;
}
