/**
 * Live human gate: a run waits IN PROCESS for a person's decision.
 *
 * `.withApprovalPolicy({ mode: "detach" })` hands a gated tool call to a person
 * (`agent.approveRun` / `agent.denyRun`). Two backends serve that wait:
 *
 *   - durable (`.withDurableRuns()`): the kernel pauses, the paused state goes
 *     to the run store, and the decision resumes the run from ANY process,
 *     even after a restart.
 *   - live (this module, the default without durable runs): the run stays
 *     alive and blocks at the gate until the decision arrives in THIS process.
 *     No store, no checkpoint, no re-entry: the kernel's in-process approval
 *     seam (`ResolvedApprovalPolicy.decide`) calls {@link liveApprovalDecider}
 *     and the same run continues.
 *
 * One registry per agent ({@link HumanGateLive}, merged into the agent runtime
 * at build). It holds the pending requests (keyed by run id), the listeners
 * that project a request onto the run's stream (`ApprovalRequested`), and the
 * result of every run that asked, so `approveRun(runId)` resolves with the
 * same `AgentResult` the run's own caller gets.
 *
 * A wait ends one of four ways, each honest about what happened:
 *   - the decision arrives (`answer`);
 *   - the optional timeout elapses: `abandoned`, the call is denied;
 *   - the run is terminated (its abort signal) or stopped: `abandoned`, denied;
 *   - the run fiber is interrupted: the waiter is removed and anyone awaiting
 *     the run's result gets a failure naming the cancel.
 */
import { Context, Deferred, Effect, Exit, Layer, Option } from "effect";
import type { BlockApprovalDecider } from "@reactive-agents/reasoning";
import { currentRunContext, getRunSlot, runControllerSlot } from "@reactive-agents/core/internal/run-scope";
import type { RunControllerLike } from "@reactive-agents/core";
import type { AgentResult } from "../builder/agent-result.js";
import type { AgentStreamEvent } from "../stream-types.js";
import { ExecutionError } from "../errors.js";

/** One request a run is waiting on. */
export type HumanGateRequest =
  | {
      readonly kind: "approval";
      readonly runId: string;
      readonly gateId: string;
      readonly toolName: string;
      readonly args: unknown;
      /** The run's task text, when the asking site knows it. */
      readonly task?: string;
      readonly requestedAt: number;
    }
  | {
      readonly kind: "interaction";
      readonly runId: string;
      readonly interactionId: string;
      /** `form` | `choice` | `confirmation` (the `request_user_input` kind). */
      readonly interactionKind: string;
      readonly prompt: string;
      readonly schema: unknown;
      readonly task?: string;
      readonly requestedAt: number;
    };

/** A person's answer to one request. */
export type HumanGateAnswer =
  | { readonly kind: "approval"; readonly approve: boolean; readonly reason?: string }
  | { readonly kind: "interaction"; readonly interactionId: string; readonly value: unknown };

/** How a wait ended: the answer, or abandoned (timeout, terminate, stop). */
export type HumanGateOutcome = HumanGateAnswer | { readonly kind: "abandoned"; readonly reason: string };

/** Projects a new request onto the run's consumer (e.g. its stream). Must not fail. */
export type HumanGateListener = (request: HumanGateRequest) => Effect.Effect<void>;

/** The per-agent live gate registry. */
export interface HumanGateService {
  /**
   * Register `request`, notify the run's listeners, and wait for the answer.
   * Never fails: a timeout, terminate or stop resolves `abandoned`.
   */
  readonly ask: (
    request: HumanGateRequest,
    options?: { readonly timeoutMs?: number },
  ) => Effect.Effect<HumanGateOutcome>;
  /**
   * Deliver `answer` to the oldest live waiter of the same kind on `runId`
   * (an interaction answer must also match its `interactionId`). `Some` when a
   * live waiter took it, carrying the effect that awaits that run's final
   * result (fails when the run fails or is cancelled); `None` when no run is
   * waiting here for that answer.
   */
  readonly answer: (
    runId: string,
    answer: HumanGateAnswer,
  ) => Effect.Effect<Option.Option<Effect.Effect<AgentResult, ExecutionError>>>;
  /** Every request currently waiting, oldest first. */
  readonly pending: () => Effect.Effect<readonly HumanGateRequest[]>;
  /** Add a listener for `runId`'s requests; the returned effect removes it. */
  readonly subscribe: (runId: string, listener: HumanGateListener) => Effect.Effect<Effect.Effect<void>>;
  /**
   * Record how a run ended. A no-op for runs that never asked. Called by the
   * run entries (`run()` pipeline, `runStream()`), never by user code.
   */
  readonly settle: (runId: string, exit: Exit.Exit<AgentResult, ExecutionError>) => Effect.Effect<void>;
}

/** The per-agent live gate. Present on every builder-built agent. */
export class HumanGate extends Context.Tag("@reactive-agents/runtime/HumanGate")<HumanGate, HumanGateService>() {}

interface Waiter {
  readonly request: HumanGateRequest;
  readonly deferred: Deferred.Deferred<HumanGateOutcome>;
}

/** Hook a runtime `RunController` exposes so a stop() releases a waiting gate. */
interface StopHookable {
  readonly onStopRequested: (listener: () => void) => () => void;
}

const hasStopHook = (ctl: RunControllerLike | null): ctl is RunControllerLike & StopHookable =>
  ctl !== null && typeof (ctl as Partial<StopHookable>).onStopRequested === "function";

/** Resolves when the run's controller signals terminate (abort) or stop. */
const runEnded = (ctl: RunControllerLike | null): Effect.Effect<string> | undefined => {
  const signal = ctl?.signal;
  const stoppable = hasStopHook(ctl) ? ctl : undefined;
  if (signal === undefined && stoppable === undefined) return undefined;
  return Effect.async<string>((resume) => {
    if (signal?.aborted) {
      resume(Effect.succeed("the run was terminated while waiting for a person"));
      return;
    }
    const onAbort = () => resume(Effect.succeed("the run was terminated while waiting for a person"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const offStop = stoppable?.onStopRequested(() =>
      resume(Effect.succeed("the run was stopped while waiting for a person")),
    );
    return Effect.sync(() => {
      signal?.removeEventListener("abort", onAbort);
      offStop?.();
    });
  });
};

const matches = (request: HumanGateRequest, answer: HumanGateAnswer): boolean =>
  request.kind === answer.kind &&
  (answer.kind !== "interaction" ||
    (request.kind === "interaction" && request.interactionId === answer.interactionId));

/** Build one agent's registry. */
export const makeHumanGate = (): HumanGateService => {
  const waiters = new Map<string, Waiter[]>();
  const listeners = new Map<string, Set<HumanGateListener>>();
  const results = new Map<string, Deferred.Deferred<AgentResult, ExecutionError>>();

  const remove = (waiter: Waiter): void => {
    const list = waiters.get(waiter.request.runId);
    if (list === undefined) return;
    const next = list.filter((w) => w !== waiter);
    if (next.length === 0) waiters.delete(waiter.request.runId);
    else waiters.set(waiter.request.runId, next);
  };

  const resultOf = (runId: string): Effect.Effect<Deferred.Deferred<AgentResult, ExecutionError>> =>
    Effect.suspend(() => {
      const existing = results.get(runId);
      if (existing !== undefined) return Effect.succeed(existing);
      return Deferred.make<AgentResult, ExecutionError>().pipe(Effect.tap((d) => Effect.sync(() => results.set(runId, d))));
    });

  const ask: HumanGateService["ask"] = (request, options) =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<HumanGateOutcome>();
      const waiter: Waiter = { request, deferred };
      const result = yield* resultOf(request.runId);
      yield* Effect.sync(() => waiters.set(request.runId, [...(waiters.get(request.runId) ?? []), waiter]));
      for (const listener of listeners.get(request.runId) ?? []) yield* listener(request);

      const ended = runEnded(yield* getRunSlot(runControllerSlot));
      const timeoutMs = options?.timeoutMs;
      const racers: Effect.Effect<HumanGateOutcome>[] = [
        Deferred.await(deferred),
        ...(ended !== undefined
          ? [ended.pipe(Effect.map((reason): HumanGateOutcome => ({ kind: "abandoned", reason })))]
          : []),
        ...(timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0
          ? [
              Effect.sleep(timeoutMs).pipe(
                Effect.as<HumanGateOutcome>({
                  kind: "abandoned",
                  reason: `no answer within ${timeoutMs}ms`,
                }),
              ),
            ]
          : []),
      ];
      return yield* Effect.raceAll(racers).pipe(
        Effect.onInterrupt(() =>
          Deferred.fail(
            result,
            new ExecutionError({
              message: `Run ${request.runId} was cancelled while waiting for a person.`,
              taskId: request.runId,
              phase: "human-gate",
            }),
          ).pipe(Effect.zipRight(Effect.sync(() => results.delete(request.runId)))),
        ),
        Effect.ensuring(Effect.sync(() => remove(waiter))),
      );
    });

  const answer: HumanGateService["answer"] = (runId, ans) =>
    Effect.suspend(() => {
      const waiter = (waiters.get(runId) ?? []).find((w) => matches(w.request, ans));
      if (waiter === undefined) return Effect.succeed(Option.none());
      // Every asking run has a result cell (`ask` makes it first); take it
      // BEFORE releasing the waiter so the run cannot settle in between.
      const result = results.get(runId);
      remove(waiter);
      return Deferred.succeed(waiter.deferred, ans).pipe(
        Effect.as(Option.some(result !== undefined ? Deferred.await(result) : Effect.never)),
      );
    });

  return {
    ask,
    answer,
    pending: () => Effect.sync(() => [...waiters.values()].flat().map((w) => w.request)),
    subscribe: (runId, listener) =>
      Effect.sync(() => {
        const set = listeners.get(runId) ?? new Set<HumanGateListener>();
        set.add(listener);
        listeners.set(runId, set);
        return Effect.sync(() => {
          set.delete(listener);
          if (set.size === 0) listeners.delete(runId);
        });
      }),
    settle: (runId, exit) =>
      Effect.suspend(() => {
        const result = results.get(runId);
        if (result === undefined) return Effect.void;
        results.delete(runId);
        return Deferred.done(result, exit).pipe(Effect.asVoid);
      }),
  };
};

/** The agent's live gate layer (one registry per agent runtime). */
export const HumanGateLive: Layer.Layer<HumanGate> = Layer.sync(HumanGate, makeHumanGate);

const NO_LIVE_GATE_REASON =
  "this run has no live approval channel (no agent runtime gate in scope) - add .withDurableRuns() " +
  "to pause for a cross-process decision, or supply onApprove";

/**
 * The kernel-facing decider for a live `detach` wait: asks the agent's
 * {@link HumanGate} for this run and maps the outcome to an approval decision.
 * Outside an agent runtime (no gate, no run scope) it denies, the same
 * fail-closed direction as the kernel's own no-decider branch.
 */
export const liveApprovalDecider =
  (options: { readonly task?: string; readonly timeoutMs?: number } = {}): BlockApprovalDecider =>
  (pending) =>
    Effect.gen(function* () {
      const gate = yield* Effect.serviceOption(HumanGate);
      const ctx = yield* currentRunContext;
      if (Option.isNone(gate) || ctx === null) return { approve: false, reason: NO_LIVE_GATE_REASON };
      const outcome = yield* gate.value.ask(
        {
          kind: "approval",
          runId: ctx.runId,
          gateId: crypto.randomUUID(),
          toolName: pending.toolName,
          args: pending.args,
          ...(options.task !== undefined ? { task: options.task } : {}),
          requestedAt: Date.now(),
        },
        options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined,
      );
      if (outcome.kind === "approval") {
        return { approve: outcome.approve, ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}) };
      }
      if (outcome.kind === "abandoned") return { approve: false, reason: outcome.reason };
      return { approve: false, reason: "an interaction answer cannot approve a tool call" };
    });

/**
 * Settle a run's live-gate result from an Effect's exit (the `run()`
 * pipeline). Failures and interrupts become an {@link ExecutionError}.
 */
export const settleFromExit = (
  runId: string,
  exit: Exit.Exit<AgentResult, unknown>,
): Effect.Effect<void> =>
  Effect.serviceOption(HumanGate).pipe(
    Effect.flatMap((gate) => {
      if (Option.isNone(gate)) return Effect.void;
      const mapped: Exit.Exit<AgentResult, ExecutionError> = Exit.isSuccess(exit)
        ? Exit.succeed(exit.value)
        : Exit.fail(
            new ExecutionError({
              message: `Run ${runId} ended without a result.`,
              taskId: runId,
              phase: "human-gate",
              cause: exit.cause,
            }),
          );
      return gate.value.settle(runId, mapped);
    }),
  );

/** `run(task, { onApproval })`'s callback (same shape as on the durable path). */
export type LiveApprovalCallback = (pending: {
  readonly runId: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
}) => boolean | { approve: boolean; reason?: string } | Promise<boolean | { approve: boolean; reason?: string }>;

/**
 * Answer `runId`'s live approval waits with `onApproval` for the duration of
 * `effect` (the `run()` pipeline). Without it a `run()` caller on a live agent
 * would wait for an `approveRun` nobody sends. A throwing or rejecting
 * callback denies (fail-closed). A no-op without a gate in scope.
 */
export const withLiveApprover =
  (runId: string, onApproval: LiveApprovalCallback | undefined) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    if (onApproval === undefined) return effect;
    return Effect.flatMap(Effect.serviceOption(HumanGate), (gate) => {
      if (Option.isNone(gate)) return effect;
      const decide = (request: Extract<HumanGateRequest, { kind: "approval" }>) =>
        Effect.tryPromise(() =>
          Promise.resolve(
            onApproval({
              runId: request.runId,
              gateId: request.gateId,
              toolName: request.toolName,
              args: request.args,
            }),
          ),
        ).pipe(
          Effect.map((d) => (typeof d === "boolean" ? { approve: d } : d)),
          Effect.orElseSucceed(() => ({ approve: false, reason: "onApproval threw - denied (fail-closed)" })),
          Effect.flatMap((d) =>
            gate.value.answer(request.runId, {
              kind: "approval",
              approve: d.approve,
              ...(d.reason !== undefined ? { reason: d.reason } : {}),
            }),
          ),
          Effect.asVoid,
        );
      return Effect.acquireUseRelease(
        gate.value.subscribe(runId, (request) =>
          request.kind === "approval" ? Effect.forkDaemon(decide(request)).pipe(Effect.asVoid) : Effect.void,
        ),
        () => effect,
        (unsubscribe) => unsubscribe,
      );
    });
  };

type StreamCompleted = Extract<AgentStreamEvent, { _tag: "StreamCompleted" }>;

/** What one `runStream()` run calls when its stream ends (see {@link watchLiveGate}). */
export interface LiveGateStreamHooks {
  readonly completed: (event: StreamCompleted) => Effect.Effect<void>;
  readonly failed: (cause: string) => Effect.Effect<void>;
}

/** The `AgentResult` a streamed run's `StreamCompleted` stands for (same fields, same values). */
const resultOfStream = (event: StreamCompleted, runId: string, agentId: string): AgentResult => ({
  output: event.output,
  success: event.success ?? true,
  taskId: event.taskId ?? runId,
  agentId: event.agentId ?? agentId,
  metadata: event.metadata,
  goalAchieved: event.goalAchieved ?? null,
  ...(event.outcome !== undefined ? { outcome: event.outcome } : {}),
  ...(event.terminatedBy !== undefined ? { terminatedBy: event.terminatedBy } : {}),
  ...(event.receipt !== undefined ? { receipt: event.receipt } : {}),
  ...(event.error !== undefined ? { error: event.error } : {}),
  ...(event.evidenceDelta !== undefined ? { evidenceDelta: event.evidenceDelta } : {}),
  ...(event.abstention !== undefined
    ? { abstention: { reason: event.abstention.reason, missing: event.abstention.missing ?? [] } }
    : {}),
});

/**
 * The stream side of the live gate for one `runStream()` run: projects each
 * request onto the stream as `ApprovalRequested` / `InteractionRequested`
 * (both densities: a UI must render it), and settles the run's result when the
 * stream ends. A no-op without a gate in scope.
 */
export const watchLiveGate = (
  runId: string,
  agentId: string,
  offer: (event: AgentStreamEvent) => Effect.Effect<void>,
): Effect.Effect<LiveGateStreamHooks> =>
  Effect.gen(function* () {
    const gate = yield* Effect.serviceOption(HumanGate);
    const none: LiveGateStreamHooks = { completed: () => Effect.void, failed: () => Effect.void };
    if (Option.isNone(gate)) return none;
    const unsubscribe = yield* gate.value.subscribe(runId, (request) =>
      offer(
        request.kind === "approval"
          ? {
              _tag: "ApprovalRequested",
              runId: request.runId,
              gateId: request.gateId,
              toolName: request.toolName,
              args: request.args,
            }
          : {
              _tag: "InteractionRequested",
              runId: request.runId,
              interactionId: request.interactionId,
              kind: request.interactionKind,
              prompt: request.prompt,
              schema: request.schema,
            },
      ),
    );
    const hooks: LiveGateStreamHooks = {
      completed: (event) =>
        unsubscribe.pipe(Effect.zipRight(gate.value.settle(runId, Exit.succeed(resultOfStream(event, runId, agentId))))),
      failed: (cause) =>
        unsubscribe.pipe(
          Effect.zipRight(
            gate.value.settle(
              runId,
              Exit.fail(new ExecutionError({ message: cause, taskId: runId, phase: "human-gate" })),
            ),
          ),
        ),
    };
    return hooks;
  });
