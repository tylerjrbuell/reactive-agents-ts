import { Effect, Layer } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { AgentStreamEvent } from "./stream-types.js";
import type { RunControllerLike } from "@reactive-agents/core";
import {
    RunStoreService,
    type RunStatus as RunStoreStatus,
} from "./services/run-store.js";

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
export function installDurableCheckpointing(
    controller: RunControllerLike,
    deps: DurableCheckpointDeps,
): { finish: (success: boolean) => Promise<void>; flush: () => Promise<void> } {
    const { runId, runStoreLayer, checkpointEvery } = deps;
    const every = checkpointEvery >= 1 ? checkpointEvery : 1;

    // In-flight write promises. `runWrite`'s Effect already swallows its own
    // errors (catchAllDefect below), so every entry settles via fulfillment —
    // the `.catch` here is defensive only, guarding against a future change
    // that reintroduces a rejection path from leaving a dangling entry.
    const inflight = new Set<Promise<void>>();

    const runWrite = (
        effect: Effect.Effect<void, never, RunStoreService>,
        site: string,
    ): Promise<void> => {
        const write = Effect.runPromise(
            effect.pipe(
                Effect.provide(runStoreLayer),
                Effect.catchAllDefect((defect) =>
                    emitErrorSwallowed({ site, tag: errorTag(defect) }),
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

    const flush = (): Promise<void> =>
        Promise.allSettled([...inflight]).then(() => undefined);

    return {
        flush,
        finish: async (success: boolean): Promise<void> => {
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
        },
    };
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
};

export type RunStatus =
    | "running"
    | "paused"
    | "stopped"
    | "terminated"
    | "completed";

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

    stop(): void {
        if (
            this._status === "terminated" ||
            this._status === "completed" ||
            this._status === "stopped"
        )
            return;
        this._stopRequested = true;
        this._status = "stopped";
        // Release any pending pause so checkpoint() can observe the stop
        this._releaseAnyPause();
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
     * Awaits resume() when paused, then signals whether a soft stop was requested.
     */
    async checkpoint(): Promise<{ stop: true } | undefined> {
        if (this._pausePromise) {
            await this._pausePromise;
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
}
