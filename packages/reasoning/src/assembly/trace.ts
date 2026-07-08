import type { ResolvedCapability } from "./capability.js";

export interface MessageTrace {
  readonly role: string;
  readonly chars: number;
  readonly projection?: "full" | "preview+ref" | "cleared";
}

/**
 * Compaction outcome for THIS projection (C4). Absent when the thread was under
 * budget (no compaction attempted). `droppedRefs` feeds the `compaction-marker`
 * ledger fact; `noShrinkEvent` fires when compaction ran but could not shrink
 * (everything protected) so the caller signals instead of silently no-op'ing.
 */
export interface CompactionTrace {
  readonly droppedRefs: readonly string[];
  readonly shrank: boolean;
  readonly noShrinkEvent: boolean;
  readonly droppedBlocks: number;
}

export interface AssemblyTrace {
  readonly capability: ResolvedCapability;
  readonly stages: ReadonlyArray<{ name: string; note: string }>;
  readonly messages: readonly MessageTrace[];
  readonly tools: readonly string[];
  /** Set only when compaction was attempted this projection (C4). */
  readonly compaction?: CompactionTrace;
}

export const emptyTrace = (capability: ResolvedCapability): AssemblyTrace => ({
  capability,
  stages: [],
  messages: [],
  tools: [],
});

export const recordCompaction = (t: AssemblyTrace, c: CompactionTrace): AssemblyTrace => ({
  ...t,
  compaction: c,
});

export const pushStage = (t: AssemblyTrace, name: string, note: string): AssemblyTrace => ({
  ...t,
  stages: [...t.stages, { name, note }],
});

export const recordMessage = (t: AssemblyTrace, m: MessageTrace): AssemblyTrace => ({
  ...t,
  messages: [...t.messages, m],
});

export const setTools = (t: AssemblyTrace, tools: readonly string[]): AssemblyTrace => ({
  ...t,
  tools,
});
