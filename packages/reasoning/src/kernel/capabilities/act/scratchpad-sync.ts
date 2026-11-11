/**
 * Act phase — the end-of-round scratchpad sync.
 *
 * An act round has two scratchpad writers:
 *  - the kernel, which stores compressed tool results (`_tool_result_N`) in
 *    the Map act.ts captured from the run store at the start of the round;
 *  - the tools, which write through the run store's Ref (`find`'s `_find_*`,
 *    `recall`, `checkpoint`). Their `Ref.update(…, new Map)` REPLACES the
 *    Map, so the Map act.ts captured is no longer the Ref's value.
 *
 * Reading only the Ref at round end dropped every kernel write made after a
 * tool replaced the Map: a compressed `find` result's storedKey never reached
 * `state.scratchpad`, `projectResultsStage` found no stored value, and the
 * model's thread lost the find result (owner report 2026-11-10, Cortex traces
 * 01M745M4CSCS…, 01M745S366TC…). `recall` of that key also failed.
 *
 * The sync merges both writers (a tool's later write to a shared key wins) and
 * publishes the merged Map on the Ref, so `recall` sees the kernel's keys too.
 */
import { Effect, Ref } from "effect";
import { currentScratchpadStore } from "@reactive-agents/tools";

/**
 * Merge `state.scratchpad`, the round's kernel writes and the run store's
 * current value into one Map; set it as the run store's value and return it.
 */
export function syncRoundScratchpad(
  base: ReadonlyMap<string, string>,
  kernelWrites: ReadonlyMap<string, string>,
): Effect.Effect<Map<string, string>> {
  return Effect.gen(function* () {
    const ref = yield* currentScratchpadStore;
    const toolWrites = yield* Ref.get(ref);
    const merged = new Map(base);
    for (const [k, v] of kernelWrites) merged.set(k, v);
    for (const [k, v] of toolWrites) merged.set(k, v);
    yield* Ref.set(ref, merged);
    return merged;
  });
}
