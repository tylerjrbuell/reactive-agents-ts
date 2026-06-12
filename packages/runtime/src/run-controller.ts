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
 * snapshot to the RunStore. Writes go through `Effect.runFork` — fire-and-forget,
 * never blocking the reasoning loop and never failing it (errors are swallowed
 * non-silently via `emitErrorSwallowed`, R11). Returns a `finish(success)`
 * callback the caller invokes at run end to flip the run status to
 * `completed` / `failed`.
 *
 * Only called when `.withDurableRuns()` was set, so absent that opt-in the
 * controller's `onCheckpoint` stays undefined and the kernel pays zero cost.
 */
export function installDurableCheckpointing(
    controller: RunControllerLike,
    deps: DurableCheckpointDeps,
): { finish: (success: boolean) => void } {
    const { runId, runStoreLayer, checkpointEvery } = deps;
    const every = checkpointEvery >= 1 ? checkpointEvery : 1;

    const runWrite = (
        effect: Effect.Effect<void, never, RunStoreService>,
        site: string,
    ): void => {
        Effect.runFork(
            effect.pipe(
                Effect.provide(runStoreLayer),
                Effect.catchAllDefect((defect) =>
                    emitErrorSwallowed({ site, tag: errorTag(defect) }),
                ),
            ),
        );
    };

    controller.onCheckpoint = (serializedState: string, iteration: number): void => {
        if (iteration % every !== 0) return;
        runWrite(
            Effect.gen(function* () {
                const store = yield* RunStoreService;
                yield* store.putCheckpoint(runId, iteration, serializedState);
            }),
            "runtime/src/run-controller.ts:putCheckpoint",
        );
    };

    return {
        finish: (success: boolean): void => {
            const status: RunStoreStatus = success ? "completed" : "failed";
            runWrite(
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
