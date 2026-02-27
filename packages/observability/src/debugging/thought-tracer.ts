import { Context, Effect, Layer, Option, Ref } from "effect";
import { EventBus } from "@reactive-agents/core";

// ─── Types ───

export interface ThoughtNode {
  readonly taskId: string;
  readonly strategy: string;
  readonly step: number;
  readonly totalSteps: number;
  readonly thought?: string;
  readonly action?: string;
  readonly observation?: string;
  readonly timestamp: Date;
}

export interface ThoughtTracer {
  /**
   * Record a reasoning step. Called directly by reasoning strategies, or
   * automatically via EventBus `ReasoningStepCompleted` events when wired.
   */
  readonly recordStep: (node: Omit<ThoughtNode, "timestamp">) => Effect.Effect<void, never>;

  /** Return the full chain of reasoning steps recorded for a task. */
  readonly getThoughtChain: (taskId: string) => Effect.Effect<readonly ThoughtNode[], never>;

  /** Remove all recorded steps for a task (e.g. after completion). */
  readonly clearChain: (taskId: string) => Effect.Effect<void, never>;

  /** Return all task IDs that have recorded steps. */
  readonly getAllTaskIds: () => Effect.Effect<readonly string[], never>;
}

// ─── Service Tag ───

export class ThoughtTracerService extends Context.Tag("ThoughtTracerService")<
  ThoughtTracerService,
  ThoughtTracer
>() {}

// ─── Core factory (no EventBus dependency) ───

export const makeThoughtTracer: Effect.Effect<ThoughtTracer, never> =
  Effect.gen(function* () {
    const chainsRef = yield* Ref.make<Map<string, ThoughtNode[]>>(new Map());

    const recordStep = (node: Omit<ThoughtNode, "timestamp">): Effect.Effect<void, never> =>
      Ref.update(chainsRef, (chains) => {
        const newMap = new Map(chains);
        const existing = newMap.get(node.taskId) ?? [];
        newMap.set(node.taskId, [...existing, { ...node, timestamp: new Date() }]);
        return newMap;
      });

    const getThoughtChain = (taskId: string): Effect.Effect<readonly ThoughtNode[], never> =>
      Ref.get(chainsRef).pipe(Effect.map((chains) => chains.get(taskId) ?? []));

    const clearChain = (taskId: string): Effect.Effect<void, never> =>
      Ref.update(chainsRef, (chains) => {
        const newMap = new Map(chains);
        newMap.delete(taskId);
        return newMap;
      });

    const getAllTaskIds = (): Effect.Effect<readonly string[], never> =>
      Ref.get(chainsRef).pipe(Effect.map((chains) => [...chains.keys()]));

    return { recordStep, getThoughtChain, clearChain, getAllTaskIds } satisfies ThoughtTracer;
  });

// ─── Live Layer (subscribes to EventBus when available) ───

export const ThoughtTracerLive = Layer.effect(
  ThoughtTracerService,
  Effect.gen(function* () {
    const tracer = yield* makeThoughtTracer;

    // Optionally subscribe to EventBus for ReasoningStepCompleted events
    const ebOpt = yield* Effect.serviceOption(EventBus);
    if (Option.isSome(ebOpt)) {
      // Register a handler — subscribe() returns an unsubscribe fn which we ignore
      // (the tracer lives for the process lifetime)
      yield* ebOpt.value.on("ReasoningStepCompleted", (event) =>
        tracer.recordStep({
          taskId: event.taskId,
          strategy: event.strategy,
          step: event.step,
          totalSteps: event.totalSteps,
          thought: event.thought,
          action: event.action,
          observation: event.observation,
        }),
      ).pipe(Effect.catchAll(() => Effect.void));
    }

    return tracer;
  }),
);
