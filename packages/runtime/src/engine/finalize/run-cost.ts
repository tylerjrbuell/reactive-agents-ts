/**
 * The run's final billed cost: one `RunCostFinalized` event per run and the
 * value `AgentResult.totalCost()` resolves to.
 *
 * Owns:
 *   - {@link runCostTotal}: run meter + debrief synthesis (+ post-run
 *     extraction), one `CostSum`.
 *   - {@link finalizeRunCost}: the success path. Without a debrief fiber or a
 *     pending post-run slot it publishes at once; otherwise it forks a daemon
 *     that joins the debrief and/or awaits the slot, then publishes. With a
 *     debrief the daemon replaces `_debriefFiber` on the result so
 *     `debriefRich()`, `dispose()` and `totalCost()` all wait for the publish.
 *   - {@link withPostRunCost}: the post-run slot `run()` opens around the
 *     engine call and its structured-output extraction.
 *   - {@link publishAbortedRunCost}: the abnormal-exit path (failure, defect,
 *     interrupt), read from the live run meter, incomplete when an LLM call
 *     was cut in flight (`../llm-in-flight.ts`).
 *
 * The answer's spend (`result.metadata.cost`) settles before the debrief is
 * forked, so the debrief call is added here, never in the meter. The debrief
 * stays off the critical path: nothing here blocks `run()`'s return.
 */
import { Cause, Deferred, Effect, Exit, Fiber, FiberRef } from "effect";
import { EMPTY_COST_SUM, addCost, emitErrorSwallowed, errorTag, type CostSum } from "@reactive-agents/core";
import {
  CurrentRunBudget,
  addRunSpend,
  costSumOf,
  makeRunBudgetMeter,
  withRunBudgetMeter,
  type RunBudgetMeter,
} from "@reactive-agents/reasoning";
import type { AgentDebrief } from "../../debrief.js";
import type { EbLike } from "../runtime-context.js";
import { getRunSlot, runSlot } from "@reactive-agents/core/internal/run-scope";
import { hasInFlightLlmCall } from "../llm-in-flight.js";

/** What the forked debrief fiber settles to (`finalizeDebriefBackground`). */
export interface DebriefFiberValue {
  readonly debrief: AgentDebrief | undefined;
  readonly tokensUsed: number;
  /**
   * The debrief LLM call's cost. `EMPTY_COST_SUM` when no call was made;
   * `{ usd: 0, complete: false }` when a call was made but its cost is unknown
   * (failed call, no usage reported, or an unpriced model).
   */
  readonly synthesisCost: CostSum;
}

/** The debrief fiber value after {@link finalizeRunCost} published the run's total. */
export interface SettledDebriefValue extends DebriefFiberValue {
  readonly runCost: CostSum;
}

/** Identity fields of a `RunCostFinalized` event. */
export interface RunCostIds {
  readonly taskId: string;
  readonly agentId: string;
  /** The run's `RunContext.runId`; written only when it differs from `taskId`. */
  readonly runId?: string;
}

/** Unknown cost: nothing counted, flagged incomplete. */
const UNKNOWN_COST: CostSum = { usd: 0, complete: false };

/** The debrief call's cost from its `synthesisTokens` (absent usage = unknown). */
export const synthesisCostOf = (debrief: AgentDebrief | undefined): CostSum => {
  const synthesis = debrief?.metrics.synthesisTokens;
  if (synthesis === undefined) return UNKNOWN_COST;
  return { usd: synthesis.cost, complete: synthesis.costComplete !== false };
};

/** Run total: the answer's spend plus the debrief call's. Incomplete when either is. */
export const runCostTotal = (answer: CostSum, debrief: CostSum): CostSum => {
  const sum = addCost(answer, debrief.usd);
  return debrief.complete ? sum : { usd: sum.usd, complete: false };
};

/** The answer's spend as `result.metadata` reports it (`cost` + `costComplete`). */
export const resultCost = (metadata: unknown): CostSum => {
  const m = (metadata ?? {}) as { readonly cost?: unknown; readonly costComplete?: unknown };
  if (typeof m.cost !== "number") return UNKNOWN_COST;
  return costSumOf({ cost: m.cost, ...(m.costComplete === false ? { costComplete: false } : {}) });
};

const RUN_COST_KEY = "_runCost";
const DEBRIEF_FIBER_KEY = "_debriefFiber";

const defineHidden = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: false, writable: false, configurable: true });
};

/** The run total `finalizeRunCost` attached to an engine result; `undefined` when none was. */
export const readRunCost = (result: object): Effect.Effect<CostSum> | undefined => {
  const value: unknown = (result as Record<string, unknown>)[RUN_COST_KEY];
  return Effect.isEffect(value) ? (value as Effect.Effect<CostSum>) : undefined;
};

const readDebriefFiber = (result: object): Fiber.RuntimeFiber<DebriefFiberValue, never> | undefined => {
  const value: unknown = (result as Record<string, unknown>)[DEBRIEF_FIBER_KEY];
  return Fiber.isFiber(value) && Fiber.isRuntimeFiber(value) ?(value as Fiber.RuntimeFiber<DebriefFiberValue, never>) : undefined;
};

/** Publish `RunCostFinalized`; a publish failure is recorded, never raised. */
export const publishRunCostFinalized = (
  eb: EbLike | null,
  ids: RunCostIds,
  total: CostSum,
  site: string,
): Effect.Effect<void> =>
  eb === null
    ? Effect.void
    : eb
        .publish({
          _tag: "RunCostFinalized",
          taskId: ids.taskId,
          agentId: ids.agentId,
          ...(ids.runId !== undefined && ids.runId !== ids.taskId ? { runId: ids.runId } : {}),
          totalCostUsd: total.usd,
          costComplete: total.complete,
        })
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site, tag: errorTag(err) })));

/**
 * Settle the run's final cost on the success path and attach it to `result`
 * (read by `totalCost()`). `eb` is `null` for a run that has not ended (a
 * pause): the value is attached, nothing is published.
 */
export const finalizeRunCost = (deps: {
  readonly result: object & { readonly metadata?: unknown };
  readonly eb: EbLike | null;
  readonly ids: RunCostIds;
}): Effect.Effect<void> =>
  Effect.gen(function* () {
    const answer = resultCost(deps.result.metadata);
    const debriefFiber = readDebriefFiber(deps.result);
    // Post-run LLM work of this run (structured-output extraction), settled
    // by the caller after this engine returns; `null` when none is pending.
    const post = (yield* getRunSlot(postRunCostSlot)).current;
    const postCost = post !== null && post.taskId === deps.ids.taskId ? Deferred.await(post.settled) : null;
    if (debriefFiber === undefined && postCost === null) {
      defineHidden(deps.result, RUN_COST_KEY, Effect.succeed(answer));
      yield* publishRunCostFinalized(deps.eb, deps.ids, answer, "runtime/src/engine/finalize/run-cost.ts:no-debrief");
      return;
    }
    if (debriefFiber === undefined) {
      const total = yield* Effect.forkDaemon(
        (postCost ?? Effect.succeed(EMPTY_COST_SUM)).pipe(
          Effect.map((p) => runCostTotal(answer, p)),
          Effect.tap((t) => publishRunCostFinalized(deps.eb, deps.ids, t, "runtime/src/engine/finalize/run-cost.ts:after-post-run")),
        ),
      );
      defineHidden(deps.result, RUN_COST_KEY, Fiber.join(total));
      return;
    }
    const settled = yield* Effect.forkDaemon(
      Fiber.join(debriefFiber).pipe(
        Effect.flatMap((d) =>
          (postCost ?? Effect.succeed(EMPTY_COST_SUM)).pipe(
            Effect.map((p): SettledDebriefValue => ({ ...d, runCost: runCostTotal(runCostTotal(answer, d.synthesisCost), p) })),
          ),
        ),
        Effect.tap((d) =>
          publishRunCostFinalized(deps.eb, deps.ids, d.runCost, "runtime/src/engine/finalize/run-cost.ts:after-debrief"),
        ),
      ),
    );
    defineHidden(deps.result, DEBRIEF_FIBER_KEY, settled);
    defineHidden(deps.result, RUN_COST_KEY, Fiber.join(settled).pipe(Effect.map((d) => d.runCost)));
  });

/**
 * `RunCostFinalized` for a run that ended abnormally (failure, defect,
 * interrupt), from the live run meter. No meter armed = cost unknown. A call
 * interrupted in flight never reached the meter but may be billed, so it
 * makes the total incomplete (`llm-in-flight.ts`; an interrupted stream is
 * flagged by the meter itself).
 */
export const publishAbortedRunCost = (eb: EbLike | null, ids: RunCostIds): Effect.Effect<void> =>
  Effect.zip(FiberRef.get(CurrentRunBudget), hasInFlightLlmCall).pipe(
    Effect.map(([meter, cutInFlight]): CostSum => {
      if (meter === null) return UNKNOWN_COST;
      const total = costSumOf(meter);
      return cutInFlight ? { usd: total.usd, complete: false } : total;
    }),
    Effect.flatMap((total) => publishRunCostFinalized(eb, ids, total, "runtime/src/engine/finalize/run-cost.ts:aborted")),
  );

/**
 * LLM work a `run()` does after its engine returned the result: the
 * structured-output extraction of `.withOutputSchema()` when parse-first
 * misses. Its calls run outside the engine's run meter, which has settled, so
 * they are metered here and their cost is added to the run's final total.
 * `metadata.cost` stays the engine's settled spend.
 */
interface PostRunCost {
  /** The run whose finalize waits for {@link settled}. */
  readonly taskId: string;
  readonly meter: RunBudgetMeter;
  readonly settled: Deferred.Deferred<CostSum>;
}

/** The run's pending post-run cost; `current` is `null` when none. Reset for sub-agents (their own run opens their own). */
const postRunCostSlot = runSlot<{ current: PostRunCost | null }>("runtime.postRunCost", {
  child: "reset",
  fresh: () => ({ current: null }),
});

/**
 * Pipeable: run `self` (the engine call plus the post-run work that follows
 * it) with a post-run cost slot for `taskId`. The engine's `finalizeRunCost`
 * sees the slot and publishes `RunCostFinalized` (and resolves `totalCost()`)
 * only once the slot settles; LLM calls made in `self` outside the engine's
 * own meter are metered into it. The slot settles on every exit of `self`, so
 * the publish never hangs; an interrupted `self` may have cut a call in
 * flight, so its cost is then incomplete. The metered spend is also added to
 * an enclosing run meter, if any (a sub-agent run inside a parent's run),
 * which used to receive those calls directly. `enabled: false` = `self`
 * unchanged.
 */
export const withPostRunCost =
  (taskId: string, enabled: boolean) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    !enabled
      ? self
      : Effect.flatMap(Effect.zip(Deferred.make<CostSum>(), getRunSlot(postRunCostSlot)), ([settled, cell]) => {
          const post: PostRunCost = { taskId, meter: makeRunBudgetMeter(), settled };
          return Effect.zipRight(
            Effect.sync(() => {
              cell.current = post;
            }),
            withRunBudgetMeter(self, post.meter),
          ).pipe(
            Effect.onExit((exit) => {
              const cost = costSumOf(post.meter);
              const cut = Exit.isFailure(exit) && Cause.isInterrupted(exit.cause);
              return addRunSpend(post.meter).pipe(
                Effect.zipRight(Deferred.succeed(settled, cut ? { usd: cost.usd, complete: false } : cost)),
                Effect.zipRight(
                  Effect.sync(() => {
                    if (cell.current === post) cell.current = null;
                  }),
                ),
              );
            }),
          );
        });

/** No debrief call made: nothing to add. */
export const NO_SYNTHESIS_COST: CostSum = EMPTY_COST_SUM;
