// File: src/kernel/capabilities/act/batch-read-first.ts
//
// Read-before-write inside one round of native tool calls. The model authors every
// call's arguments before any result exists. When a round holds a write and the read
// of the input that write is paired with (notes-N.txt -> out-N.txt,
// `pairedOutputForInput`), the write's content was composed without the value, however
// the harness orders the calls: cogito todo-heavy runs 0 and 5 sent 12 calls in 2-3
// iterations and wrote placeholder content (live addendum 6, cause B).
//
// Running the read first would not help: the content is already fixed. So the write
// is refused with a one-line hint, the read runs, and the model resubmits the write
// with the value in view. The refusal is a guard answer (the call never ran, so it is
// not a prior call and the resubmitted write is no duplicate). Both act paths use it:
// the concurrent batch and the sequential loop.
//
// Applies only when the task pairs the write's target with a listed input that was not
// read before this round and this round reads it. Any other round is untouched.
// Pure, deterministic, NO LLM.

import type { ToolCallSpec } from "@reactive-agents/tools";
import type { KernelInput, KernelState } from "../../state/kernel-state.js";
import { deriveListedInputs, pairedOutputForInput } from "../verify/derive-inputs.js";
import { argsNameEntity } from "../verify/input-entity.js";
import { callWritesPath, isInputRead } from "../verify/post-conditions.js";
import type { GuardOutcome } from "./guard.js";

/** Tools that change the workspace: a call of one is never the read of an input. */
const NON_READING_TOOLS: ReadonlySet<string> = new Set(["file-write", "file-edit", "shell-execute", "code-execute"]);

const asRecord = (call: ToolCallSpec): Record<string, unknown> =>
  typeof call.arguments === "object" && call.arguments !== null ? (call.arguments as Record<string, unknown>) : {};

/**
 * The refusal text for `call` when it writes a paired output whose input `round`
 * reads and `entry` (the state at round start) had not read; undefined otherwise.
 */
export function writeBeforeReadRefusal(
  call: ToolCallSpec,
  round: readonly ToolCallSpec[],
  entry: KernelState,
  input: KernelInput,
): string | undefined {
  if (!NON_READING_TOOLS.has(call.name)) return undefined;
  for (const { entity } of deriveListedInputs(input.task)) {
    const output = pairedOutputForInput(input.task, entity);
    if (output === undefined || !callWritesPath({ name: call.name, arguments: asRecord(call) }, output)) continue;
    if (isInputRead(entity, entry.steps, entry.ledger)) continue;
    const readsIt = round.some((b) => b.id !== call.id && !NON_READING_TOOLS.has(b.name) && argsNameEntity(asRecord(b), entity));
    if (readsIt) {
      return `Not written: ${output} depends on ${entity}, which you read in this same round, so its value was not yet known. Wait for the ${entity} result, then write ${output} from it.`;
    }
  }
  return undefined;
}

/**
 * Wraps a guard check for one round of calls: a write whose paired input the round
 * reads (and `entry` had not) is refused first; every other call goes to `check`.
 */
export function withRoundReadFirst(
  check: (tc: ToolCallSpec, state: KernelState, input: KernelInput) => GuardOutcome,
  round: readonly ToolCallSpec[],
  entry: KernelState,
): (tc: ToolCallSpec, state: KernelState, input: KernelInput) => GuardOutcome {
  return (tc, state, input) => {
    const observation = writeBeforeReadRefusal(tc, round, entry, input);
    return observation === undefined ? check(tc, state, input) : { pass: false, observation, guard: "write_before_read_guard" };
  };
}
