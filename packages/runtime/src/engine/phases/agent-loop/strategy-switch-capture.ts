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
 * listens for the duration of one `ReasoningService.execute` call and records
 * EVERY switch for THIS task (sub-agents share the bus), in order. The result
 * assembly reports the last target as `strategyUsed` and the whole history as
 * `strategySwitches`. Reporting only: nothing is written back to
 * `ctx.selectedStrategy`, so later passes (verification retry, continuation)
 * still dispatch the strategy they did before.
 */
import { Effect, type Exit } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { StrategySwitchRecord } from "../../../builder/agent-result.js";

/** `ExecutionContext.metadata` key carrying the last switch target of the latest pass. */
export const STRATEGY_SWITCHED_TO_KEY = "strategySwitchedTo" as const;

/** `ExecutionContext.metadata` key carrying every switch of the run so far, in order. */
export const STRATEGY_SWITCHES_KEY = "strategySwitches" as const;

/** Outcome of one captured pass: the strategy call's exit plus the switches it made. */
export interface CapturedStrategyPass<A, E> {
  readonly exit: Exit.Exit<A, E>;
  /** The `to` of the last `StrategySwitched` for `taskId` during the pass; undefined when none fired. */
  readonly switchedTo: string | undefined;
  /** Every `StrategySwitched` for `taskId` during the pass, in publish order (empty when none fired). */
  readonly switches: readonly StrategySwitchRecord[];
}

/**
 * Run `effect` to an Exit while recording each `StrategySwitched` whose
 * `taskId` matches. Without an EventBus in context the effect still runs and
 * no switch is recorded. The subscription is removed on every exit path.
 */
export const captureStrategySwitch = <A, E, R>(
  taskId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<CapturedStrategyPass<A, E>, never, R> =>
  Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    const switches: StrategySwitchRecord[] = [];
    const unsubscribe =
      busOpt._tag === "Some"
        ? yield* busOpt.value.on("StrategySwitched", (event) =>
            Effect.sync(() => {
              if (String(event.taskId) !== taskId) return;
              switches.push({
                from: event.from,
                to: event.to,
                ...(typeof event.iteration === "number" ? { iteration: event.iteration } : {}),
              });
            }),
          )
        : undefined;
    const exit = yield* Effect.exit(effect).pipe(
      Effect.ensuring(Effect.sync(() => unsubscribe?.())),
    );
    return { exit, switchedTo: switches[switches.length - 1]?.to, switches };
  });

/** Read the recorded switch target off `ExecutionContext.metadata` (undefined when absent or malformed). */
export const readStrategySwitchedTo = (
  metadata: Readonly<Record<string, unknown>>,
): string | undefined => {
  const value = metadata[STRATEGY_SWITCHED_TO_KEY];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const isSwitchRecord = (v: unknown): v is StrategySwitchRecord => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["from"] === "string" &&
    typeof r["to"] === "string" &&
    (r["iteration"] === undefined || typeof r["iteration"] === "number")
  );
};

/** Read the run's switch history off `ExecutionContext.metadata` (empty when absent; malformed entries dropped). */
export const readStrategySwitches = (
  metadata: Readonly<Record<string, unknown>>,
): readonly StrategySwitchRecord[] => {
  const value = metadata[STRATEGY_SWITCHES_KEY];
  return Array.isArray(value) ? value.filter(isSwitchRecord) : [];
};

/** The run's history after one more pass: earlier passes' switches, then this pass's. */
export const appendStrategySwitches = (
  metadata: Readonly<Record<string, unknown>>,
  pass: readonly StrategySwitchRecord[],
): readonly StrategySwitchRecord[] => [...readStrategySwitches(metadata), ...pass];
