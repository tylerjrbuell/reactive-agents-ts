/**
 * Answer release gate: an answer the output screen has not passed is never published.
 *
 * Owns: holding a run's `FinalAnswerProduced` events (and, on `runStream()`,
 * its text deltas) while an output screen is configured, releasing them once
 * {@link screenFinalOutput} passes, and dropping them when it blocks.
 *
 * Why: the reasoning kernel publishes `FinalAnswerProduced` the moment the
 * loop ends, but the output screen (PII / toxicity guardrail, behavioral
 * contract `checkOutput`) runs later, after the strategy returns. Every event
 * consumer (Cortex, telemetry, a user's `subscribe`) received a blocked answer
 * before the screen ran (Cortex live QA 2026-11-11, `487399ff0`).
 *
 * How: the strategy resolves the `EventBus` ambiently, so the run is given a
 * bus that holds this run's `FinalAnswerProduced` (matched on its `taskId`;
 * sub-agent answers pass through, their own run screens them) and forwards
 * every other event unchanged. No output screen configured: the run gets the
 * plain bus (zero cost, same event order as before).
 */
import { Context, Effect, Option } from "effect";
import { EventBus, type AgentEvent } from "@reactive-agents/core";
import type { Task, TaskResult } from "@reactive-agents/core";
import type { ReactiveAgentsConfig } from "../types.js";

/** Releases the held answers of the run in scope. Provided per run by {@link holdUnscreenedAnswers}. */
export class AnswerReleaseGate extends Context.Tag("@reactive-agents/runtime/AnswerReleaseGate")<
  AnswerReleaseGate,
  { readonly release: Effect.Effect<void> }
>() {}

/** True when the run screens its final output (guardrails or behavioral contracts on). */
export const outputScreenActive = (config: ReactiveAgentsConfig): boolean =>
  config.enableGuardrails === true || config.enableBehavioralContracts === true;

type EventBusService = Context.Tag.Service<typeof EventBus>;

/**
 * A bus that holds `FinalAnswerProduced` for `taskId` until `release`. After
 * the release it forwards everything. Exported for the seam pin.
 */
export const makeHeldAnswerBus = (
  bus: EventBusService,
  taskId: string,
): { readonly bus: EventBusService; readonly release: Effect.Effect<void> } => {
  const held: AgentEvent[] = [];
  let released = false;
  return {
    bus: {
      ...bus,
      publish: (event) =>
        !released && event._tag === "FinalAnswerProduced" && event.taskId === taskId
          ? Effect.sync(() => {
              held.push(event);
            })
          : bus.publish(event),
    },
    release: Effect.suspend(() => {
      released = true;
      const out = held.splice(0);
      return Effect.forEach(out, (event) => bus.publish(event), { discard: true });
    }),
  };
};

/**
 * Wrap `execute` so a run with an output screen holds its answers until the
 * screen passes. A blocked or failed run never releases them.
 */
export const holdUnscreenedAnswers = <E>(
  execute: (task: Task) => Effect.Effect<TaskResult, E>,
  config: ReactiveAgentsConfig,
): ((task: Task) => Effect.Effect<TaskResult, E>) => {
  if (!outputScreenActive(config)) return execute;
  return (task) =>
    Effect.flatMap(Effect.serviceOption(EventBus), (busOpt) => {
      if (Option.isNone(busOpt)) return execute(task);
      const gate = makeHeldAnswerBus(busOpt.value, String(task.id));
      return execute(task).pipe(
        Effect.provideService(EventBus, gate.bus),
        Effect.provideService(AnswerReleaseGate, { release: gate.release }),
      );
    });
};

/** Release the held answers of the run in scope (no-op without a gate). Called once the screen passes. */
export const releaseScreenedAnswers: Effect.Effect<void> = Effect.flatMap(
  Effect.serviceOption(AnswerReleaseGate),
  (gate) => (Option.isSome(gate) ? gate.value.release : Effect.void),
);

/**
 * Text-delta holder for `runStream()`: while an output screen is configured,
 * deltas wait until the run ends; `flush` delivers them (the run passed its
 * screen), and a failed run never calls it.
 */
export const holdTextUntilScreened = (
  active: boolean,
  deliver: (text: string) => Effect.Effect<void>,
): { readonly sink: (text: string) => Effect.Effect<void>; readonly flush: Effect.Effect<void> } => {
  if (!active) return { sink: deliver, flush: Effect.void };
  const held: string[] = [];
  return {
    sink: (text) =>
      Effect.sync(() => {
        held.push(text);
      }),
    flush: Effect.suspend(() => Effect.forEach(held.splice(0), deliver, { discard: true })),
  };
};
