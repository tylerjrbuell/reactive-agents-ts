import type { EventLog } from "./event-log.js";
import type { ResultStore } from "./result-store.js";
import type { ResolvedCapability } from "./capability.js";
import type { ProviderRequest } from "./types.js";
import { emptyTrace, type AssemblyTrace } from "./trace.js";
import type { StandingFrameSection } from "./standing-frame.js";
import type { RunContract } from "../kernel/contract/run-contract.js";
import type { RunLedger } from "../kernel/ledger/run-ledger.js";
import type { RunAssessment } from "../kernel/assessment/assess.js";
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
  /**
   * H1 (2026-07-08 sweep, audit 03-F1): carried context from BEFORE this
   * kernel pass — strategy-switch handoffs, ToT selected-approach summaries,
   * reflexion param hints, memory bootstrap. Composed by every strategy but
   * WRITE-ONLY since the APC deletion removed its only renderer; the model
   * restarted blind after every switch. systemPromptStage now renders it.
   */
  readonly priorContext?: string;
  /**
   * D1 (Projector): the upstream meta-loop DAG nodes the projector RENDERS from.
   * All optional — absent → byte-identical pre-D1 behavior. The projector reads
   * them (never mutates): `ledger` supplies handoff entries (audit 03-F5) +
   * requirement-satisfaction for the outstanding frame; `contract` supplies the
   * outstanding requirements (standing goal frame); `assessment` selects the
   * phase render profile; `longHorizon` is the opt-in gate for the outstanding
   * frame + phase profiles (default profile stays byte-identical).
   */
  readonly contract?: RunContract;
  readonly ledger?: RunLedger;
  readonly assessment?: RunAssessment;
  readonly longHorizon?: boolean;
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
  /** Standing-frame sections rendered by systemPromptStage (D1). finalizeStage
   *  reads these to build the `projection` trace (section provenance). */
  standingSections?: readonly StandingFrameSection[];
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
