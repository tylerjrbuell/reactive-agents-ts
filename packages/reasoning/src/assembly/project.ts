import { emptyTrace } from "./trace.js";
import { systemPromptStage } from "./stages/system-prompt.js";
import { selectToolsStage } from "./stages/select-tools.js";
import { projectResultsStage } from "./stages/project-results.js";
import { compactHistoryStage } from "./stages/compact-history.js";
import { volatileTailStage } from "./stages/volatile-tail.js";
import { finalizeStage } from "./stages/finalize.js";
import type { AssemblyInput, AssemblyCtx, Projection } from "./assembly-ctx.js";

export type { AssemblyInput, AssemblyCtx, Projection } from "./assembly-ctx.js";

const STAGES = [
  systemPromptStage,
  selectToolsStage,
  projectResultsStage,
  compactHistoryStage,
  // F10: volatile content goes AFTER history compaction (so it is never
  // compacted away) and BEFORE finalize (which reads standingSections for the
  // projection trace).
  volatileTailStage,
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
