// File: src/kernel/loop/iterate-input-order-seam.ts
//
// Read-before-write order for listed inputs (DEBT #39 follow-up, harness switch
// `inputCoverage`, default OFF; no new flag).
//
// The input-coverage ablation (wiki/Research/Ablations/2026-11-07-input-coverage)
// showed coverage alone is not enough: cogito read 36/36 listed inputs and still
// scored 0, because the reads came AFTER the writes (the exit gate only asks
// "read before exit"). The spike (wiki/Research/Harness-Reports/
// 2026-11-15-enumerated-inputs-spike.md) found the same shape on
// lh-enumerate-audit: the audit was written before inv-12 was read.
//
// This seam closes the order gap with guidance, not a veto. In a pass that wrote
// a file while listed inputs are still unread, it appends one line to the
// pending guidance naming each unread input, so the model can read them and
// rewrite the deliverable. It reads only existing state (`InputRead` delivery
// conditions exist only under the switch), so with the switch off it is inert.
//
// Pure, deterministic, NO LLM, NO fs.

import { appendGuidanceText } from "../state/guidance-channel.js";
import { deliveryConditions } from "../contract/declared-deliverables.js";
import { WRITING_TOOL_NAMES } from "../capabilities/verify/post-conditions.js";
import { verifyDelivery } from "../capabilities/verify/delivery-authority.js";
import { transitionState, type KernelState } from "../state/kernel-state.js";

/** Cap on named inputs in the line: beyond it the count says the rest. */
const MAX_NAMED = 6;

/** Listed inputs not yet read (task order), by entity as written. Empty when the switch is off. */
export function unreadListedInputs(state: KernelState): readonly string[] {
  const inputs = (deliveryConditions(state.meta) ?? []).filter((c) => c.kind === "InputRead");
  if (inputs.length === 0) return [];
  const { unmet } = verifyDelivery(inputs, { steps: state.steps, output: "", ledger: state.ledger });
  return unmet.flatMap((c) => (c.kind === "InputRead" ? [c.entity] : []));
}

/** True when a write-tool action step sits at or after `fromStep`. */
export function wroteSince(state: KernelState, fromStep: number): boolean {
  return state.steps.slice(fromStep).some((s) => {
    if (s.type !== "action") return false;
    const name = s.metadata?.toolCall?.name;
    return typeof name === "string" && WRITING_TOOL_NAMES.has(name.toLowerCase());
  });
}

/** The guidance line naming the unread inputs, or undefined when there is nothing to say. */
export function inputOrderLine(state: KernelState, stepsAtPassStart: number): string | undefined {
  if (!wroteSince(state, stepsAtPassStart)) return undefined;
  const unread = unreadListedInputs(state);
  if (unread.length === 0) return undefined;
  const named = unread.slice(0, MAX_NAMED).join(", ");
  const rest = unread.length > MAX_NAMED ? ` (and ${unread.length - MAX_NAMED} more)` : "";
  return (
    `You wrote a file while these listed inputs are still unread: ${named}${rest}. ` +
    "Read each one, then update what you wrote so it covers every listed input."
  );
}

/** Append the read-before-write line to the pending guidance when it applies. */
export function applyInputOrderGuidance(state: KernelState, stepsAtPassStart: number): KernelState {
  const line = inputOrderLine(state, stepsAtPassStart);
  return line === undefined
    ? state
    : transitionState(state, { pendingGuidance: appendGuidanceText(state.pendingGuidance, "icsGuidance", line) });
}
