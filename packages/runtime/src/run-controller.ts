import { Effect, Layer } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type {
    ToolEffectSpec,
    ToolEffectOutcome,
} from "@reactive-agents/core";
import type { AgentStreamEvent } from "./stream-types.js";
import type { RunControllerLike } from "@reactive-agents/core";
import {
    RunStoreService,
    type RunStatus as RunStoreStatus,
} from "./services/run-store.js";
import type { RunStopKind, RunStopSummary } from "./loop-stop-summary.js";
import {
    classifyEnd,
    persistInterrupt,
    type EndedRun,
    type RunSnapshot,
    type UserStopKind,
} from "./engine/run-interrupt.js";

// Re-export for consumers who import from runtime rather than core
export type { RunControllerLike };

/**
 * Dependencies for {@link installDurableCheckpointing} — the write-side of
 * crash-resume (Phase B). The RunStore layer + runId are pre-resolved by the
 * caller (execute-stream) where the durable config and Effect runtime live.
 */
export interface DurableCheckpointDeps {
    /** Stable id for this run (also the RunStore primary key). */
    readonly runId: string;
    /** A `RunStoreLive(dbPath)` layer to provide on each fire-and-forget write. */
    readonly runStoreLayer: Layer.Layer<RunStoreService>;
    /** Persist a checkpoint every N iterations (>=1). */
    readonly checkpointEvery: number;
}

/**
 * Wire durable checkpoint persistence onto a {@link RunController}.
 *
 * Installs `controller.onCheckpoint` so the kernel seam (which already no-ops
 * when `onCheckpoint` is absent) hands every Nth iteration's serialized
 * snapshot to the RunStore. Writes go through `Effect.runPromise` — the
 * reasoning loop still never awaits them (still fire-and-forget from the
 * loop's perspective, still never failing it: errors are swallowed
 * non-silently via `emitErrorSwallowed`, R11) — but the resulting Promise is
 * tracked in an in-flight set so {@link flush} can await durability on demand.
 *
 * Durable checkpoint hardening (Arc 1 Task 4): a crash immediately after an
 * iteration used to lose the checkpoint silently because nothing ever waited
 * on the write. `flush()` closes that gap for any caller that needs a
 * durability boundary (run end, before a fork reads the latest checkpoint,
 * etc.) without slowing down the per-iteration hot path.
 *
 * Returns:
 *  - `flush()` — awaits every write started so far (checkpoints + any
 *    in-flight status write). Never throws (writes already swallow their own
 *    errors); resolves once everything currently in flight has settled.
 *  - `finish(success)` — awaits `flush()` first (so the last checkpoint is
 *    durable before the run flips to a terminal status), then persists the
 *    `completed` / `failed` status row.
 *
 * Only called when `.withDurableRuns()` was set, so absent that opt-in the
 * controller's `onCheckpoint` stays undefined and the kernel pays zero cost.
 */
/** How much of a tool result the `run_effects` row keeps (GH #262). The
 * kernel act phase passes the FULL pre-compression content as the effect
 * outcome; without a cap one huge tool result would make every resume pay
 * the full row-nonzero cost. 16384 covers a large file digest / page dump
 * while keeping the store bounded — the injected content is capped to the
 * same value, so a resumed run sees exactly what was persisted. */
const MAX_RESULT_CONTENT_CHARS = 16_384;

export function installDurableCheckpointing(
    controller: RunControllerLike,
    deps: DurableCheckpointDeps,
): DurableCheckpointing {
    const { runId, runStoreLayer, checkpointEvery } = deps;
    const every = checkpointEvery >= 1 ? checkpointEvery : 1;

    // In-flight write promises. `runWrite`'s Effect already swallows its own
    // errors (catchAllDefect below), so every entry settles via fulfillment —
    // the `.catch` here is defensive only, guarding against a future change
    // that reintroduces a rejection path from leaving a dangling entry.
    const inflight = new Set<Promise<unknown>>();

    const runWrite = <A = void>(
        effect: Effect.Effect<A, never, RunStoreService>,
        site: string,
    ): Promise<A | undefined> => {
        const write = Effect.runPromise(
            effect.pipe(
                Effect.provide(runStoreLayer),
                Effect.catchAllDefect((defect) =>
                    emitErrorSwallowed({ site, tag: errorTag(defect) }).pipe(Effect.as(undefined)),
                ),
            ),
        );
        inflight.add(write);
        write.catch(() => undefined).finally(() => inflight.delete(write));
        return write;
    };

    controller.onCheckpoint = (serializedState: string, iteration: number): void => {
        if (iteration % every !== 0) return;
        // The reasoning loop calls onCheckpoint synchronously and must never
        // await it — `void` makes the fire-and-forget intent explicit.
        // Durability is guaranteed via flush()/finish(), not here.
        void runWrite(
            Effect.gen(function* () {
                const store = yield* RunStoreService;
                yield* store.putCheckpoint(runId, iteration, serializedState);
            }),
            "runtime/src/run-controller.ts:putCheckpoint",
        );
    };

    // Durable tool-effect observers (GH #262). UNLIKE onCheckpoint these are
    // AWAITED (the kernel act phase awaits the returned promise before
    // dispatch / past the outcome), because a committed-but-never-observed
    // `executing` row documents nothing: the whole point is that a crash can
    // never fall between the world changing and the row existing. They must
    // NEVER reject though — a store failure must degrade the run to
    // "effect unrecorded" (never skipped, never failed), so each write is
    // swallow-and-resolve via runWrite's swallow + an explicit `.catch`
    // backstop. Writes still join the in-flight set so flush()/finish() waits
    // on them at run end.
    controller.onToolEffectStart = async (spec: ToolEffectSpec): Promise<void> => {
        try {
            await runWrite(
                Effect.gen(function* () {
                    const store = yield* RunStoreService;
                    yield* store.putToolEffect({
                        runId,
                        effectId: spec.effectId,
                        toolName: spec.toolName,
                        toolCallId: spec.toolCallId,
                        iteration: spec.iteration,
                        argsJson: spec.argsJson,
                    });
                }),
                "runtime/src/run-controller.ts:putToolEffect",
            );
        } catch {
            // Unreachable while runWrite keeps swallowing its own defects, but
            // the observer contract says "never throw" — degrade silently.
        }
    };

    controller.onToolEffectEnd = async (
        spec: ToolEffectSpec,
        outcome: ToolEffectOutcome,
    ): Promise<void> => {
        try {
            await runWrite(
                Effect.gen(function* () {
                    const store = yield* RunStoreService;
                    yield* store.updateToolEffectOutcome({
                        runId,
                        effectId: spec.effectId,
                        status: outcome.status,
                        ...(outcome.status === "succeeded"
                            ? {
                                  resultContent:
                                      outcome.resultContent.length > MAX_RESULT_CONTENT_CHARS
                                          ? `${outcome.resultContent.slice(0, MAX_RESULT_CONTENT_CHARS)}\n[…truncated in durable record]`
                                          : outcome.resultContent,
                              }
                            : { errorText: outcome.errorText }),
                    });
                }),
                "runtime/src/run-controller.ts:updateToolEffectOutcome",
            );
        } catch {
            // Same never-throw contract as onToolEffectStart.
        }
    };

    // The last state the kernel noted (every iteration, pre- and post-phase;
    // the thunk is lazy, so remembering it costs one reference per iteration).
    // An interruption persists it as the run's final checkpoint.
    let lastNoted: { readonly thunk: () => string; readonly iteration: number } | undefined;
    const innerNote = controller.noteCheckpoint?.bind(controller);
    controller.noteCheckpoint = (thunk: () => string, iteration: number): void => {
        lastNoted = { thunk, iteration };
        innerNote?.(thunk, iteration);
    };
    const snapshot = (): RunSnapshot | undefined => {
        if (lastNoted === undefined) return undefined;
        try {
            return { serialized: lastNoted.thunk(), iteration: lastNoted.iteration };
        } catch {
            return undefined;
        }
    };

    const flush = (): Promise<void> =>
        Promise.allSettled([...inflight]).then(() => undefined);

    const finish = async (success: boolean): Promise<void> => {
        // Await the last checkpoint's durability BEFORE flipping status —
        // otherwise a reader (resume, or agent.fork()) could observe a
        // `completed`/`failed` run whose latest checkpoint is still in
        // flight or lost to a crash.
        await flush();
        const status: RunStoreStatus = success ? "completed" : "failed";
        await runWrite(
            Effect.gen(function* () {
                const store = yield* RunStoreService;
                yield* store.setStatus(runId, status);
            }),
            "runtime/src/run-controller.ts:setStatus",
        );
    };

    const interrupt = async (
        kind: RunStopKind,
        reason: string,
        stop?: RunStopSummary,
    ): Promise<RunStopSummary | undefined> => {
        await flush();
        const final = stop === undefined ? snapshot() : undefined;
        return runWrite(
            persistInterrupt({ runId, kind, reason, ...(final !== undefined ? { snapshot: final } : {}), ...(stop !== undefined ? { stop } : {}) }),
            "runtime/src/run-controller.ts:persistInterrupt",
        );
    };

    return {
        flush,
        interrupt,
        settle: async (result: EndedRun): Promise<RunStopSummary | undefined> => {
            const requested = controller instanceof RunController ? controller.requestedStop() : undefined;
            const ended = classifyEnd(result, requested);
            if (ended === undefined) {
                await finish(true);
                return undefined;
            }
            return interrupt(ended.kind, ended.reason, ended.stop);
        },
        finish,
    };
}

/** What {@link installDurableCheckpointing} hands the run's end. */
export interface DurableCheckpointing {
    /** Await every checkpoint / status write started so far. */
    readonly flush: () => Promise<void>;
    /** Flush, then mark the run `completed` or `failed` (no stop record, no final snapshot). */
    readonly finish: (success: boolean) => Promise<void>;
    /**
     * Leave the run continuable: flush, persist the last noted state as the
     * final checkpoint, the stop record (`stop` when the run already carries
     * one, otherwise built from the journal) and the status the kind implies.
     */
    readonly interrupt: (kind: RunStopKind, reason: string, stop?: RunStopSummary) => Promise<RunStopSummary | undefined>;
    /**
     * End the run from its result: an interruption ({@link classifyEnd}: a
     * requested stop, a loop stop, a failed result) is {@link interrupt}ed
     * (the stop record written is returned), anything else is `finish(true)`.
     */
    readonly settle: (result: EndedRun) => Promise<RunStopSummary | undefined>;
}

/**
 * Return type of agent.runStream(). Extends AsyncGenerator<AgentStreamEvent>
 * so existing for-await and .next() call sites work without changes.
 */
export type RunHandle = AsyncGenerator<AgentStreamEvent> & {
    pause(): void;
    resume(): void;
    stop(opts?: { reason?: string }): void;
    terminate(opts?: { reason?: string }): void;
    status(): RunStatus;
    /**
     * Live kernel-state introspection (Arc 1 Task 5) — projects the most
     * recent iteration-boundary checkpoint into a small, stable shape.
     * `undefined` before the first iteration boundary or on non-kernel paths
     * (nothing has called `noteCheckpoint` yet); never throws.
     */
    inspect(): RunInspection | undefined;
};

export type RunStatus =
    | "running"
    | "paused"
    | "stopped"
    | "terminated"
    | "completed";

/**
 * Projection of the latest kernel-state checkpoint, produced by
 * {@link RunController.inspect}. Deliberately small and stable — NOT a
 * pass-through of the full (versioned, internal) `KernelState` codec
 * envelope, so this shape doesn't need to change every time internal kernel
 * fields do.
 */
export interface RunInspection {
    /** The controller's own run status (running/paused/stopped/...), NOT the kernel's internal thinking/acting/... FSM state. */
    readonly status: RunStatus;
    readonly iteration: number;
    readonly stepsCount: number;
    readonly messagesCount: number;
    /** Most recent thought text, truncated to 500 chars. Undefined if no thought has been recorded yet. */
    readonly lastThought?: string;
    /** Names of tool calls awaiting execution (native FC handoff between think → act). */
    readonly pendingToolCalls: readonly string[];
    /** Epoch ms when the underlying checkpoint was recorded (noteCheckpoint() time, not inspect() time). */
    readonly capturedAt: number;
}

/**
 * Per-call control plane for an agent run.
 *
 * Created in runStream() and threaded to the kernel via KernelInput.runController.
 * The kernel calls checkpoint() at each iteration boundary; transforms honor their
 * return value before the verb fires (§7.3 queue-on-verb semantics).
 *
 * Four verbs:
 *   pause()     — freeze at next phase boundary; await resume()
 *   resume()    — continue from paused state
 *   stop()      — graceful: run synthesis, emit StreamCompleted
 *   terminate() — hard: abort fiber, emit StreamCancelled
 */
export class RunController implements RunControllerLike { // RunControllerLike from @reactive-agents/core
    private _status: RunStatus = "running";
    private _pauseResolve: (() => void) | null = null;
    private _pausePromise: Promise<void> | null = null;
    private _stopRequested = false;
    private readonly _abortController: AbortController;
    /**
     * Optional durable-checkpoint observer (see {@link RunControllerLike}).
     * Declared here (not just inherited structurally from the interface) so
     * `installDurableCheckpointing`'s assignment — and callers reading it back
     * off a concrete `RunController` instance, e.g. in tests — typecheck.
     * Undefined until `installDurableCheckpointing` wires it; the kernel's
     * call site already no-ops when absent, so this stays zero-cost.
     */
    onCheckpoint?: (serializedState: string, iteration: number) => void;

    /**
     * Durable tool-effect observers (GH #262) — see
     * {@link installDurableCheckpointing}. Declared so the assignments and
     * kernel-act reads typecheck against the concrete instance. Undefined
     * until durable runs are enabled; the kernel's act phase already no-ops
     * when absent, so non-durable runs pay zero cost.
     */
    onToolEffectStart?: (spec: ToolEffectSpec) => Promise<void>;
    onToolEffectEnd?: (spec: ToolEffectSpec, outcome: ToolEffectOutcome) => Promise<void>;

    /**
     * Latest snapshot thunk noted by the kernel (Arc 1 Task 5). Stored, not
     * invoked — `inspect()` is the only caller of `thunk()`, so a non-durable
     * run that never calls `inspect()` pays zero serialization cost even
     * though `noteCheckpoint` fires every iteration.
     */
    private _lastSnapshot?: { thunk: () => string; iteration: number; at: number };

    constructor(abortController: AbortController) {
        this._abortController = abortController;
    }

    get signal(): AbortSignal {
        return this._abortController.signal;
    }

    status(): RunStatus {
        return this._status;
    }

    pause(): void {
        if (this._status !== "running") return;
        this._status = "paused";
        this._pausePromise = new Promise<void>((resolve) => {
            this._pauseResolve = resolve;
        });
    }

    resume(): void {
        if (this._status !== "paused") return;
        this._status = "running";
        this._pauseResolve?.();
        this._pauseResolve = null;
        this._pausePromise = null;
    }

    /**
     * The stop a person asked for: `stop(kind)` records it (`user-stopped` by
     * default), a hard `terminate()` counts as `user-stopped`. `undefined`
     * while nothing was requested. A durable run's end reads it
     * ({@link installDurableCheckpointing}'s `settle`).
     */
    requestedStop(): UserStopKind | undefined {
        if (this._status === "terminated") return "user-stopped";
        return this._stopRequested ? this._stopKind : undefined;
    }

    private _stopKind: UserStopKind = "user-stopped";

    stop(kind: UserStopKind = "user-stopped"): void {
        if (
            this._status === "terminated" ||
            this._status === "completed" ||
            this._status === "stopped"
        )
            return;
        this._stopKind = kind;
        this._stopRequested = true;
        this._status = "stopped";
        // Release any pending pause so checkpoint() can observe the stop
        this._releaseAnyPause();
        // A run waiting for a person (engine/human-gate.ts) gives up its wait.
        for (const listener of [...this._stopListeners]) listener();
    }

    private readonly _stopListeners = new Set<() => void>();

    /**
     * Call `listener` when stop() is requested. Returns the unsubscribe. The
     * live human gate uses it so a stopped run does not keep waiting for a
     * decision that will never matter.
     */
    onStopRequested(listener: () => void): () => void {
        this._stopListeners.add(listener);
        return () => {
            this._stopListeners.delete(listener);
        };
    }

    terminate(): void {
        this._status = "terminated";
        this._abortController.abort();
        this._releaseAnyPause();
    }

    markCompleted(): void {
        if (this._status === "running" || this._status === "paused") {
            this._status = "completed";
        }
    }

    /**
     * Called by runner.ts at each iteration boundary via Effect.promise().
     * Awaits resume() when paused, then signals whether a soft stop or a hard
     * terminate() was requested. `terminate` takes priority over `stop` — the
     * two are mutually exclusive statuses (terminate() never checks
     * `_stopRequested`) — so the loop's caller can route a hard terminate
     * through a distinct `terminatedBy` reason (FM-5) instead of the
     * graceful-stop one.
     */
    async checkpoint(): Promise<{ stop: true; terminate?: boolean } | undefined> {
        if (this._pausePromise) {
            await this._pausePromise;
        }
        if (this._status === "terminated") {
            return { stop: true, terminate: true };
        }
        if (this._stopRequested) {
            return { stop: true };
        }
        return undefined;
    }

    private _releaseAnyPause(): void {
        this._pauseResolve?.();
        this._pauseResolve = null;
        this._pausePromise = null;
    }

    /**
     * Store the latest iteration-boundary snapshot thunk (Arc 1 Task 5).
     * NO serialization happens here — `snapshot` is invoked lazily, only if
     * `inspect()` is later called. Called unconditionally by the kernel at
     * every iteration boundary, independent of `onCheckpoint`/durability.
     */
    noteCheckpoint(snapshot: () => string, iteration: number): void {
        this._lastSnapshot = { thunk: snapshot, iteration, at: Date.now() };
    }

    /**
     * Project the most recent checkpoint into a small, stable
     * {@link RunInspection}. Invokes the stored thunk (this is where the
     * deferred serialization/parse cost actually happens). Never throws —
     * a thrown thunk, corrupt JSON, or an envelope shape mismatch all
     * resolve to `undefined` rather than propagating.
     */
    inspect(): RunInspection | undefined {
        const snapshot = this._lastSnapshot;
        if (!snapshot) return undefined;

        let raw: string;
        try {
            raw = snapshot.thunk();
        } catch {
            return undefined;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return undefined;
        }
        if (typeof parsed !== "object" || parsed === null) return undefined;

        const state = (parsed as { state?: unknown }).state;
        if (typeof state !== "object" || state === null) return undefined;
        const s = state as Record<string, unknown>;

        const steps = Array.isArray(s["steps"]) ? (s["steps"] as unknown[]) : [];
        const messages = Array.isArray(s["messages"]) ? (s["messages"] as unknown[]) : [];
        const meta =
            typeof s["meta"] === "object" && s["meta"] !== null
                ? (s["meta"] as Record<string, unknown>)
                : {};

        // meta.lastThought is the canonical field, but the act phase clears
        // it to undefined once a thought has been acted on — fall back to
        // the most recent steps[] entry of type "thought".
        const metaLastThought = typeof meta["lastThought"] === "string" ? (meta["lastThought"] as string) : undefined;
        let lastThought = metaLastThought;
        if (lastThought === undefined) {
            for (let i = steps.length - 1; i >= 0; i--) {
                const step = steps[i];
                if (
                    step &&
                    typeof step === "object" &&
                    (step as Record<string, unknown>)["type"] === "thought"
                ) {
                    const content = (step as Record<string, unknown>)["content"];
                    if (typeof content === "string") {
                        lastThought = content;
                        break;
                    }
                }
            }
        }

        const pendingRaw = Array.isArray(meta["pendingNativeToolCalls"])
            ? (meta["pendingNativeToolCalls"] as unknown[])
            : [];
        const pendingToolCalls = pendingRaw
            .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>)["name"] : undefined))
            .filter((n): n is string => typeof n === "string");

        return {
            status: this._status,
            iteration: snapshot.iteration,
            stepsCount: steps.length,
            messagesCount: messages.length,
            lastThought: lastThought !== undefined ? lastThought.slice(0, 500) : undefined,
            pendingToolCalls,
            capturedAt: snapshot.at,
        };
    }
}
