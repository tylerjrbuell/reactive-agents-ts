import type { EventLog } from "./event-log.js";
import type { ResultStore } from "./result-store.js";
import type { ResolvedCapability } from "./capability.js";
import type { ProviderRequest } from "./types.js";
import { emptyTrace, type AssemblyTrace } from "./trace.js";
import { systemPromptStage } from "./stages/system-prompt.js";
import { selectToolsStage } from "./stages/select-tools.js";
import { projectResultsStage } from "./stages/project-results.js";
import { compactHistoryStage } from "./stages/compact-history.js";
import { finalizeStage } from "./stages/finalize.js";

export interface AssemblyInput {
  readonly log: EventLog;
  readonly capability: ResolvedCapability;
  readonly store: ResultStore;
  readonly persona: { system: string; environmentContext?: Readonly<Record<string, string>> };
  readonly tools: {
    schemas: readonly unknown[];
    /** Tools the dispatcher requires — drives the tier-adaptive in-prompt
     *  "Required tools (call these)" grouping for weak-FC local models. */
    requiredTools?: readonly string[];
    /** Schema verbosity for the in-prompt tool reference (from profile). */
    detail?: "names-only" | "names-and-types" | "full";
  };
}

export interface AssemblyCtx extends AssemblyInput {
  systemPrompt: string;
  messages: ProviderRequest["messages"];
  toolSchemas: readonly unknown[];
  trace: AssemblyTrace;
}

export interface Projection {
  readonly request: ProviderRequest;
  readonly trace: AssemblyTrace;
}

const STAGES = [
  systemPromptStage,
  selectToolsStage,
  projectResultsStage,
  compactHistoryStage,
  finalizeStage,
];

export function project(input: AssemblyInput): Projection {
  let ctx: AssemblyCtx = {
    ...input,
    systemPrompt: "",
    messages: [],
    toolSchemas: [],
    trace: emptyTrace(input.capability),
  };
  for (const stage of STAGES) ctx = stage(ctx);
  return {
    request: { systemPrompt: ctx.systemPrompt, messages: ctx.messages, tools: ctx.toolSchemas },
    trace: ctx.trace,
  };
}
