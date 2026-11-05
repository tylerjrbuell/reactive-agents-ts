/**
 * state/pass-seed.ts — carry ONE run across several kernel passes.
 *
 * A multi-pass strategy (reflexion's improve passes, plan-execute steps) calls
 * the kernel once per pass. Without a seed each pass compiled its OWN run
 * contract from that pass's prompt (a harness improve-prompt yields phantom
 * requirements: `create-ticket`, a malformed `artifact:.//tmp/...`) and
 * assessed only its OWN ledger, so a requirement the first pass satisfied
 * (`tool:file-write`) stayed outstanding forever (Plan 9 live H3 finding).
 *
 * The seed lets the caller hand a later pass the first pass's contract and run
 * ledger. The runner adopts the contract instead of compiling one, and starts
 * the ledger from the seed: new entries append after it with `seq` continuing
 * (`appendEntry` assigns `seq = length`), so `assess()` sees the whole run.
 * Both fields absent => today's behavior, byte-for-byte.
 */
import type { RunContract } from "../contract/run-contract.js";
import type { RunLedger } from "../ledger/run-ledger.js";
import { buildSuccessfulToolCallCounts } from "../capabilities/verify/requirement-state.js";
import { seedInitialAdvisory } from "./checklist-seed.js";
import { transitionState, type KernelInput, type KernelState } from "./kernel-state.js";

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched; the fields
// live next to the code that reads them (precedent: checklist-seed.ts).
declare module "./kernel-state.js" {
  interface KernelInput {
    /**
     * The run contract an EARLIER kernel pass of the same run compiled. When
     * present the runner adopts it verbatim instead of compiling a contract from
     * this pass's task text. Absent => the pass compiles its own (default).
     */
    readonly seedRunContract?: RunContract;
    /**
     * The run ledger an EARLIER kernel pass of the same run produced. When
     * present (and non-empty) on a fresh pass, the pass's ledger starts from it:
     * new entries append with `seq` continuing, so assessment judges the whole
     * run. Ignored on a durable resume (`resumeState` already carries the
     * ledger). Absent/empty => the pass starts with an empty ledger (default).
     */
    readonly seedRunLedger?: RunLedger;
  }
}

/**
 * Start a fresh pass's ledger from `input.seedRunLedger`. Returns `state` by
 * identity when there is no seed, on a resumed run, or when the state already
 * carries ledger entries (never overwrites or double-seeds).
 *
 * The seed's SUCCESSFUL tool calls also seed `state.toolsUsed`, so the per-pass
 * tool view (terminal verifier `agent-took-action`, required-tool gating,
 * final-answer visibility) agrees with the run ledger instead of being a second
 * source of tool evidence that forgets pass 1 (Plan 9 S1-fix, golden
 * reflexion-two-pass seq 104-105). Failed seeded calls are not counted.
 */
export function adoptPassLedger(
  state: KernelState,
  input: Pick<KernelInput, "seedRunLedger" | "resumeState">,
): KernelState {
  const seed = input.seedRunLedger;
  if (seed === undefined || seed.length === 0 || input.resumeState !== undefined) return state;
  if ((state.ledger ?? []).length > 0) return state;
  const seededTools = Object.keys(buildSuccessfulToolCallCounts([], seed));
  if (seededTools.length === 0) return transitionState(state, { ledger: seed });
  return transitionState(state, { ledger: seed, toolsUsed: new Set([...state.toolsUsed, ...seededTools]) });
}

/**
 * The runner's pre-loop state seeding: adopt the pass ledger seed, then the
 * conversation's advisory todo seed (which no-ops when the adopted ledger
 * already carries checklist facts).
 */
export function seedPassState(
  state: KernelState,
  input: Pick<KernelInput, "seedRunLedger" | "resumeState" | "initialAdvisory">,
): KernelState {
  return seedInitialAdvisory(adoptPassLedger(state, input), input);
}
