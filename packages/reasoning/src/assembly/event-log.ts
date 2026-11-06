import type { ContentPart } from "@reactive-agents/core";

export type AgentEvent =
  | {
      readonly kind: "goal";
      /** The goal's text (system prompt, compaction and traces read this). */
      readonly text: string;
      /**
       * Present only when the goal turn carries a non-text part (Plan 9
       * Phase 4): the full typed parts, rendered as the opening user turn.
       * Absent for text-only goals, so text runs project byte-identically.
       */
      readonly parts?: readonly ContentPart[];
    }
  | {
      readonly kind: "thought";
      /** The thought's text (non-text parts contribute nothing). */
      readonly text: string;
      /** Present only when the assistant turn carries a non-text part (same rule as `goal`). */
      readonly parts?: readonly ContentPart[];
    }
  | { readonly kind: "tool_called"; readonly tool: string; readonly callId: string; readonly args: Record<string, unknown> }
  | {
      readonly kind: "tool_result";
      readonly callId: string;
      readonly ref: string;
      readonly shape: string;
      /**
       * `preserveOnCompaction` (C4, audit 03-F4): carried from the observation
       * step so the compaction path can protect this result from being dropped.
       * Absent ⇒ not preserved.
       */
      readonly preserve?: boolean;
    }
  | { readonly kind: "observation"; readonly text: string }
  | { readonly kind: "goal_state"; readonly remaining: readonly string[] }
  | { readonly kind: "terminated"; readonly reason: string };

export class EventLog {
  constructor(readonly events: readonly AgentEvent[] = []) {}
  append(e: AgentEvent): EventLog {
    return new EventLog([...this.events, e]);
  }
  byKind<K extends AgentEvent["kind"]>(kind: K): ReadonlyArray<Extract<AgentEvent, { kind: K }>> {
    return this.events.filter((e): e is Extract<AgentEvent, { kind: K }> => e.kind === kind);
  }
}
