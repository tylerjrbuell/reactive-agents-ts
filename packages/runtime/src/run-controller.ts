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
