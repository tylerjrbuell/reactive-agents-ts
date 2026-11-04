// File: src/kernel/contract/strategy-contract.ts
//
// D9 (Plan 8 section D item 9) — primitive A: the run contract for a strategy
// that does not run the reactive kernel at its top level (plan-execute first).
//
// The reactive runner compiles the run contract once at kernel start
// (`runner.ts`, `compileRunContract` + `contract-compiled`). A strategy without
// a top-level kernel pass had no contract of its own, so its terminal could not
// be judged against the files the task names. This opens the SAME contract
// with the SAME inputs (required tools, the run's writing tools, posture,
// declared TaskContract) and emits the SAME `contract-compiled` event.
//
// Deliberately does NOT seed ledger `requirement` entries: a declared `answer`
// requirement with no terminal verdict reads as unsatisfied, which would flip
// honest plain partials to refused (runtime veto). The judgment lives in
// `strategy-delivery.ts` and the finalize mint.

import { Effect } from "effect";
import { RunEnvelope } from "../envelope/run-envelope.js";
import { WRITING_TOOL_NAMES } from "../capabilities/verify/post-conditions.js";
import { emitContractCompiled } from "../utils/diagnostics.js";
import type { StrategyServices } from "../utils/service-utils.js";
import { compileRunContract, type RunContract } from "./run-contract.js";

/**
 * Tools available to a run that can write a file artifact: builtins in
 * `WRITING_TOOL_NAMES` plus any registered tool declaring `produces: "file"`
 * (FM-15 layers 4+5). `undefined` when no schema list is known, which keeps the
 * contract compiler's legacy writer guess.
 *
 * Shared by the reactive runner (both run-start derivations) and
 * {@link openStrategyContract}, so the two contracts name the same writer.
 */
export function resolveAvailableWritingTools(
  schemas: readonly { readonly name: string }[] | undefined,
  toolService: StrategyServices["toolService"],
): Effect.Effect<readonly string[] | undefined> {
  return Effect.gen(function* () {
    if (schemas === undefined) return undefined;
    const writers: string[] = [];
    for (const { name } of schemas) {
      if (WRITING_TOOL_NAMES.has(name.toLowerCase())) {
        writers.push(name);
        continue;
      }
      if (toolService._tag !== "Some") continue;
      const declared = yield* toolService.value.getTool(name).pipe(
        Effect.map((d) => d.produces),
        Effect.catchAll(() => Effect.succeed(undefined)),
      );
      if (declared === "file") writers.push(name);
    }
    return writers;
  });
}

/** What a strategy holds at its start that the contract compile needs. */
export interface OpenStrategyContractArgs {
  /** The strategy's task text (history-prefixed text is fine: the compiler takes the current turn). */
  readonly task: string;
  /** Run/task id the `contract-compiled` event is stamped with. */
  readonly taskId: string;
  /** Tools the dispatcher requires. */
  readonly requiredTools?: readonly string[];
  /** Tool schemas available to the run (`allToolSchemas ?? availableToolSchemas`). */
  readonly toolSchemas?: readonly { readonly name: string }[];
  /** Tool service, to read `produces: "file"` on custom writers. */
  readonly toolService: StrategyServices["toolService"];
  /** Iteration stamped on the event. Default 0 (strategy start). */
  readonly iteration?: number;
}

/**
 * Compile the run contract for a strategy without a top-level kernel pass and
 * emit `contract-compiled`. Posture and the declared TaskContract come off the
 * {@link RunEnvelope}, exactly as the reactive runner receives them. Returns the
 * frozen contract; pass it to `finalizeStrategyResult({ runContract })`.
 */
export function openStrategyContract(
  args: OpenStrategyContractArgs,
): Effect.Effect<RunContract, never, RunEnvelope> {
  return Effect.gen(function* () {
    const envelope = yield* RunEnvelope;
    const availableWritingTools = yield* resolveAvailableWritingTools(args.toolSchemas, args.toolService);
    const contract = compileRunContract(args.task, {
      requiredTools: args.requiredTools ?? [],
      ...(availableWritingTools !== undefined ? { availableWritingTools } : {}),
      ...(envelope.rails.posture !== undefined ? { posture: envelope.rails.posture } : {}),
      ...(envelope.policy.taskContract !== undefined ? { taskContract: envelope.policy.taskContract } : {}),
    });
    yield* emitContractCompiled({ taskId: args.taskId, iteration: args.iteration ?? 0, contract });
    return contract;
  });
}
