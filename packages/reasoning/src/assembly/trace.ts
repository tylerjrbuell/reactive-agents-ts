import type { ResolvedCapability } from "./capability.js";

export interface MessageTrace {
  readonly role: string;
  readonly chars: number;
  readonly projection?: "full" | "summary+ref" | "cleared";
}

export interface AssemblyTrace {
  readonly capability: ResolvedCapability;
  readonly stages: ReadonlyArray<{ name: string; note: string }>;
  readonly messages: readonly MessageTrace[];
  readonly tools: readonly string[];
}

export const emptyTrace = (capability: ResolvedCapability): AssemblyTrace => ({
  capability,
  stages: [],
  messages: [],
  tools: [],
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
