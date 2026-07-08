export type AgentEvent =
  | { readonly kind: "goal"; readonly text: string }
  | { readonly kind: "thought"; readonly text: string }
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
