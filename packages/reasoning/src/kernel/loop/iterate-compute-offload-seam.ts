// File: src/kernel/loop/iterate-compute-offload-seam.ts
//
// Compute offload guidance (harness switch `computeOffload`, default OFF).
//
// Spike wiki/Research/Harness-Reports/2026-11-15-compute-offload-spike.md: weak
// models computed a mean of 20 numbers in their head and were right 0 of 14
// times; the runs that called `code-execute` successfully were right 3 of 3.
// Once data was read on an aggregation task and no `code-execute` call has
// succeeded, ONE advisory line reaches the model on its next think turn, the
// turn that computes the figure and writes or answers.
//
// Advisory only: appended to the pending guidance, never a veto, no exit-gate
// or terminal logic. Fires once per run (`meta.computeOffloadHinted`). It also
// stays quiet when `code-execute` is not on the run's surface, so it never
// points at a tool the model cannot call. Switch off: returns the same state.
//
// Pure, deterministic, NO LLM, NO fs.

import { appendGuidanceText } from "../state/guidance-channel.js";
import { transitionState, type KernelInput, type KernelState } from "../state/kernel-state.js";
import { GUARD_OBSERVATION_TAG, HARNESS_PSEUDO_TOOLS, META_TOOLS } from "../state/kernel-constants.js";
import { WRITING_TOOL_NAMES } from "../capabilities/verify/post-conditions.js";
import {
  asksForComputedAggregate,
  COMPUTE_OFFLOAD_LINE,
  COMPUTE_TOOL,
} from "../capabilities/comprehend/compute-offload.js";

declare module "../state/kernel-state.js" {
  interface KernelMeta {
    /** Set once the compute-offload line was sent, so it is sent once per run. */
    readonly computeOffloadHinted?: boolean;
  }
}

/** True when a successful observation came from a tool that read data (not a meta, write, pseudo or compute tool). */
function readData(state: KernelState): boolean {
  return state.steps.some((s) => {
    if (s.type !== "observation" || s.metadata?.frameworkInstrumentation === GUARD_OBSERVATION_TAG) return false;
    const r = s.metadata?.observationResult;
    if (r === undefined || r.success !== true) return false;
    const name = r.toolName.toLowerCase();
    return name !== COMPUTE_TOOL && !META_TOOLS.has(name) && !HARNESS_PSEUDO_TOOLS.has(name) && !WRITING_TOOL_NAMES.has(name);
  });
}

/** True when a `code-execute` call has already succeeded in this run. */
function computed(state: KernelState): boolean {
  return state.steps.some(
    (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === COMPUTE_TOOL && s.metadata.observationResult.success === true,
  );
}

/** The advisory line, or undefined when the switch is off or nothing is left to say. */
export function computeOffloadLine(state: KernelState, input: KernelInput): string | undefined {
  if (input.harness?.computeOffload !== true || state.meta.computeOffloadHinted === true) return undefined;
  if (!asksForComputedAggregate(input.task)) return undefined;
  const offered = [...(input.availableToolSchemas ?? []), ...(input.allToolSchemas ?? [])].some((ts) => ts.name === COMPUTE_TOOL);
  if (!offered || !readData(state) || computed(state)) return undefined;
  return COMPUTE_OFFLOAD_LINE;
}

/** Append the compute-offload line to the pending guidance when it applies (once per run). */
export function applyComputeOffloadGuidance(state: KernelState, input: KernelInput): KernelState {
  const line = computeOffloadLine(state, input);
  return line === undefined
    ? state
    : transitionState(state, {
        pendingGuidance: appendGuidanceText(state.pendingGuidance, "icsGuidance", line),
        meta: { ...state.meta, computeOffloadHinted: true },
      });
}
