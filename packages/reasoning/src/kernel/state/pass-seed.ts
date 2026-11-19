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
import { Effect, Ref } from "effect";
import { currentScratchpadStore } from "@reactive-agents/tools";
import type { RunContract } from "../contract/run-contract.js";
import type { RunLedger } from "../ledger/run-ledger.js";
import { toolEvidence } from "../capabilities/verify/requirement-state.js";
import { seedInitialAdvisory } from "./checklist-seed.js";
import { resetResumedStreaks } from "../assessment/guard-adapters.js";
import { normalizeKernelMessages } from "./kernel-message.js";
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
 * `state.evidence` (derived from the ledger at transitionState) includes the
 * seed's calls; this marks it `seeded` when the seed holds a substantive one.
 */
export function adoptPassLedger(
  state: KernelState,
  input: Pick<KernelInput, "seedRunLedger" | "resumeState">,
): KernelState {
  const seed = input.seedRunLedger;
  if (seed === undefined || seed.length === 0 || input.resumeState !== undefined) return state;
  if ((state.ledger ?? []).length > 0) return state;
  const seedEvidence = toolEvidence(seed);
  // `seeded` is the one flag a patch may set on `evidence`; counts come from the ledger.
  const evidence = { ...seedEvidence, seeded: seedEvidence.substantive };
  const seededTools = Object.keys(seedEvidence.successfulCounts);
  if (seededTools.length === 0) return transitionState(state, { ledger: seed, evidence });
  return transitionState(state, { ledger: seed, evidence, toolsUsed: new Set([...state.toolsUsed, ...seededTools]) });
}

/**
 * Canonical content for the seeded thread (Plan 9 Phase 4): caller-supplied
 * text-only parts collapse to one string before any kernel reader sees them.
 * Returns the same state when every message is already string content.
 */
function normalizeSeededThread(state: KernelState): KernelState {
  if (state.messages.every((m) => typeof m.content === "string")) return state;
  return transitionState(state, { messages: normalizeKernelMessages(state.messages) });
}

/**
 * Resolve the carried thread's stored tool-result refs on a fresh pass.
 *
 * A multi-pass strategy hands a later pass the earlier thread
 * (`initialMessages`), whose `tool_result` messages may point at a stored
 * result (`storedKey`, e.g. `_tool_result_1`). A fresh pass starts with an
 * empty `state.scratchpad`, so projection could not resolve those refs: it
 * fell back to the message's cut preview and fired `tool-result-pairing`
 * (harness report 2026-11-19, Cortex reflexion trace 01M7T8XTQEARASBWPNVYEEZJZ0).
 * Keys are minted run-wide (act/tool-execution.ts), so the run's scratchpad
 * store holds them; this copies exactly the carried refs into the pass state.
 *
 * Returns `state` by identity on a resumed run (its scratchpad is restored),
 * when no carried message has a ref, or when every ref is already present or
 * absent from the store.
 */
export function seedCarriedScratchpad(
  state: KernelState,
  input: Pick<KernelInput, "resumeState">,
): Effect.Effect<KernelState> {
  if (input.resumeState !== undefined) return Effect.succeed(state);
  const refs = state.messages.flatMap((m) =>
    m.role === "tool_result" && m.storedKey !== undefined && !state.scratchpad.has(m.storedKey) ? [m.storedKey] : [],
  );
  if (refs.length === 0) return Effect.succeed(state);
  return Effect.gen(function* () {
    const store = yield* Ref.get(yield* currentScratchpadStore);
    const found = refs.flatMap((k) => {
      const v = store.get(k);
      return v === undefined ? [] : [[k, v] as const];
    });
    if (found.length === 0) return state;
    return transitionState(state, { scratchpad: new Map([...state.scratchpad, ...found]) });
  });
}

/**
 * The runner's pre-loop state seeding: normalize the seeded thread's content,
 * adopt the pass ledger seed, then the conversation's advisory todo seed (which
 * no-ops when the adopted ledger already carries checklist facts). A durable
 * resume restarts the low-delta streak (state/resume-epoch.ts).
 */
export function seedPassState(
  state: KernelState,
  input: Pick<KernelInput, "seedRunLedger" | "resumeState" | "initialAdvisory">,
): KernelState {
  return seedInitialAdvisory(adoptPassLedger(normalizeSeededThread(resetResumedStreaks(state, input)), input), input);
}
