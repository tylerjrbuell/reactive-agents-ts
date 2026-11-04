/**
 * Strategy-switch capture for one reasoning pass.
 *
 * A mid-run strategy switch happens INSIDE the kernel: the strategy result
 * still names the entry strategy (`reactive.ts` stamps `strategy: "reactive"`
 * whatever the kernel switched to), so `ctx.selectedStrategy` — and through it
 * `AgentResult.metadata.strategyUsed` / `StreamCompleted.metadata.strategyUsed`
 * — reported the strategy the run STARTED with while the trace's
 * `strategy-switched` event showed it finishing under another one.
 *
 * The kernel already publishes `StrategySwitched` on the EventBus. This module
 * listens for the duration of one `ReasoningService.execute` call, keeps the
 * last switch target for THIS task (sub-agents share the bus), and the result
 * assembly reports it. Reporting only: the value is NOT written back to
 * `ctx.selectedStrategy`, so later passes (verification retry, continuation)
 * still dispatch the strategy they did before.
 */
import { Effect, type Exit } from "effect";
import { EventBus } from "@reactive-agents/core";

/** `ExecutionContext.metadata` key carrying the last switch target of the latest pass. */
export const STRATEGY_SWITCHED_TO_KEY = "strategySwitchedTo" as const;

/** Outcome of one captured pass: the strategy call's exit plus the last switch target, if any. */
export interface CapturedStrategyPass<A, E> {
  readonly exit: Exit.Exit<A, E>;
  /** The `to` of the last `StrategySwitched` for `taskId` during the pass; undefined when none fired. */
  readonly switchedTo: string | undefined;
}

/**
 * Run `effect` to an Exit while recording the last `StrategySwitched.to` whose
 * `taskId` matches. Without an EventBus in context the effect still runs and
 * `switchedTo` is undefined. The subscription is removed on every exit path.
 */
export const captureStrategySwitch = <A, E, R>(
  taskId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<CapturedStrategyPass<A, E>, never, R> =>
  Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    let switchedTo: string | undefined;
    const unsubscribe =
      busOpt._tag === "Some"
        ? yield* busOpt.value.on("StrategySwitched", (event) =>
            Effect.sync(() => {
              if (String(event.taskId) === taskId) switchedTo = event.to;
            }),
          )
        : undefined;
    const exit = yield* Effect.exit(effect).pipe(
      Effect.ensuring(Effect.sync(() => unsubscribe?.())),
    );
    return { exit, switchedTo };
  });

/** Read the recorded switch target off `ExecutionContext.metadata` (undefined when absent or malformed). */
export const readStrategySwitchedTo = (
  metadata: Readonly<Record<string, unknown>>,
): string | undefined => {
  const value = metadata[STRATEGY_SWITCHED_TO_KEY];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
