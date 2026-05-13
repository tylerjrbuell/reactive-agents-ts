import type { AgentStreamEvent } from "./stream-types.js";
import type { RunControllerLike } from "@reactive-agents/core";

// Re-export for consumers who import from runtime rather than core
export type { RunControllerLike };

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
