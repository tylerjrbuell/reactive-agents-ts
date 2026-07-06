/**
 * durable-resume.ts — store-side logic for `ReactiveAgent.resume(runId)` and
 * `agent.listRuns()` (v0.12.0 track 1, Phase C).
 *
 * Keeps the SQLite/RunStore interaction out of `reactive-agent.ts`: load the
 * latest checkpoint for a run, guard against config drift, and expose status /
 * listing helpers. The actual re-execution (seeding `ResumeStateRef` and
 * running the agent to completion) stays in `reactive-agent.ts`, which owns the
 * ManagedRuntime — this module only opens a self-contained RunStore layer.
 *
 * The config-hash guard compares the run's stored identity hash (written by
 * `execute-stream.ts` via `durableConfigHash`) against the resuming agent's
 * recomputed hash; a mismatch means the agent config changed since the run was
 * captured (e.g. a different system prompt) and resuming would be incoherent.
 */
import { Effect } from "effect";
import {
  RunStoreLive,
  RunStoreService,
  type RunRecord,
  type RunStatus,
  type ApprovalRecord,
  type InteractionRecord,
} from "../services/run-store.js";
import {
  DurableRunNotFoundError,
  DurableConfigMismatchError,
  ApprovalStateError,
  InteractionStateError,
} from "../errors.js";

/** The data needed to continue a crashed/paused run from its last checkpoint. */
export interface ResumePayload {
  readonly run: RunRecord;
  /** Codec-serialized `KernelState` from the highest-iteration checkpoint. */
  readonly stateJson: string;
}

/**
 * Load + validate the resume payload for `runId` from the RunStore at `dbPath`.
 *
 * Fails `DurableRunNotFoundError` when the run row or any checkpoint is missing,
 * and `DurableConfigMismatchError` when the stored config hash differs from the
 * resuming agent's `currentConfigHash`.
 */
export const loadResumePayload = (params: {
  readonly runId: string;
  readonly dbPath: string;
  readonly currentConfigHash: string;
}): Effect.Effect<
  ResumePayload,
  DurableRunNotFoundError | DurableConfigMismatchError
> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    const run = yield* store.getRun(params.runId);
    if (!run) {
      return yield* Effect.fail(
        new DurableRunNotFoundError({ runId: params.runId }),
      );
    }
    const checkpoint = yield* store.latestCheckpoint(params.runId);
    if (!checkpoint) {
      return yield* Effect.fail(
        new DurableRunNotFoundError({ runId: params.runId }),
      );
    }
    if (run.configHash !== params.currentConfigHash) {
      return yield* Effect.fail(
        new DurableConfigMismatchError({
          runId: params.runId,
          storedHash: run.configHash,
          currentHash: params.currentConfigHash,
        }),
      );
    }
    return { run, stateJson: checkpoint.stateJson };
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

/**
 * The data needed to fork a NEW run from any checkpoint of a prior run
 * (Arc 1 Task 6). Unlike {@link ResumePayload}, also carries the checkpoint's
 * own `iteration` — the caller threads it into the new run's
 * `{ forkedFrom, forkedAtIteration }` provenance.
 */
export interface ForkPayload {
  readonly run: RunRecord;
  /** Codec-serialized `KernelState` from the checkpoint at-or-below `at`. */
  readonly stateJson: string;
  /** The iteration the returned checkpoint was captured at. */
  readonly iteration: number;
}

/**
 * Load the fork payload for `runId` from the RunStore at `dbPath` — the
 * checkpoint at-or-below `params.at` (defaults to the latest checkpoint, same
 * as resume, when `at` is omitted).
 *
 * Deliberately NO config-hash guard (contrast {@link loadResumePayload}): a
 * fork is an intentional counterfactual restart, not a crash recovery, so
 * restarting under a different agent config (or with `opts.model` applied by
 * the caller) is expected and desired, not an error condition.
 *
 * Fails `DurableRunNotFoundError` when the run row or a qualifying checkpoint
 * is missing.
 */
export const loadForkPayload = (params: {
  readonly runId: string;
  readonly dbPath: string;
  readonly at?: number;
}): Effect.Effect<ForkPayload, DurableRunNotFoundError> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    const run = yield* store.getRun(params.runId);
    if (!run) {
      return yield* Effect.fail(
        new DurableRunNotFoundError({ runId: params.runId }),
      );
    }
    const checkpoint =
      params.at === undefined
        ? yield* store.latestCheckpoint(params.runId)
        : yield* store.checkpointAt(params.runId, params.at);
    if (!checkpoint) {
      return yield* Effect.fail(
        new DurableRunNotFoundError({ runId: params.runId }),
      );
    }
    return { run, stateJson: checkpoint.stateJson, iteration: checkpoint.iteration };
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

/** Enumerate persisted runs (newest-updated first), optionally filtered by status/userId. */
export const listDurableRuns = (params: {
  readonly dbPath: string;
  readonly status?: RunStatus;
  readonly userId?: string;
}): Effect.Effect<readonly RunRecord[], never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    return yield* store.listRuns({ status: params.status, userId: params.userId });
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

/** Flip a run's lifecycle status (best-effort; never fails the caller). */
export const markRunStatus = (params: {
  readonly dbPath: string;
  readonly runId: string;
  readonly status: RunStatus;
}): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    yield* store.setStatus(params.runId, params.status);
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

/**
 * Durable HITL (Phase D): record a human's approve/deny on a run's pending
 * approval. Fails `ApprovalStateError` when the run has no pending approval (e.g.
 * already decided, completed, or never paused). Returns the decided gateId so the
 * caller can seed `ApprovalDecisionRef` for the resumed run.
 */
export const decideApprovalRecord = (params: {
  readonly dbPath: string;
  readonly runId: string;
  readonly status: "approved" | "denied";
  readonly reason?: string;
}): Effect.Effect<{ gateId: string }, ApprovalStateError> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    const pending = yield* store.getPendingApproval(params.runId);
    if (!pending) {
      return yield* Effect.fail(
        new ApprovalStateError({ runId: params.runId, detail: "no pending approval" }),
      );
    }
    yield* store.decideApproval(params.runId, pending.gateId, params.status, params.reason);
    return { gateId: pending.gateId };
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

/** The single pending approval for a run (or undefined). Used by `listPendingApprovals`. */
export const getPendingApprovalAt = (params: {
  readonly dbPath: string;
  readonly runId: string;
}): Effect.Effect<ApprovalRecord | undefined, never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    return yield* store.getPendingApproval(params.runId);
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

/**
 * Durable HITL (Phase D): create (or replace) a run row for the non-streaming
 * `run()` durable path. Mirrors execute-stream's createRun so `run()` and
 * `runStream()` produce identical run rows (same config-hash guard on resume).
 * Idempotent (INSERT OR REPLACE) — safe to call again when resuming the same id.
 */
export const createDurableRun = (params: {
  readonly dbPath: string;
  readonly runId: string;
  readonly agentId: string;
  readonly task: string;
  readonly configHash: string;
  /** Fork lineage (Arc 1 Task 6) — see {@link RunRecord.forkedFrom}. */
  readonly forkedFrom?: string;
  readonly forkedAtIteration?: number;
}): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    yield* store.createRun({
      runId: params.runId,
      agentId: params.agentId,
      task: params.task,
      configHash: params.configHash,
      ...(params.forkedFrom !== undefined ? { forkedFrom: params.forkedFrom } : {}),
      ...(params.forkedAtIteration !== undefined ? { forkedAtIteration: params.forkedAtIteration } : {}),
    });
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

/**
 * Durable HITL (Phase D): persist a paused run — status → awaiting-approval + a
 * pending approval row. Mirrors execute-stream's `persistApprovalPause` for the
 * `run()` path.
 */
export const persistApprovalPauseAt = (params: {
  readonly dbPath: string;
  readonly runId: string;
  readonly gate: { gateId: string; toolName: string; args: unknown };
}): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    yield* store.setStatus(params.runId, "awaiting-approval");
    yield* store.putApproval({
      runId: params.runId,
      gateId: params.gate.gateId,
      toolName: params.gate.toolName,
      argsJson: JSON.stringify(params.gate.args ?? null),
    });
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

// ── Agentic-UI durable interaction rail (Task 10) ────────────────────────────
// Mirror of the approval helpers above (persistApprovalPauseAt /
// decideApprovalRecord / getPendingApprovalAt) for the `request_user_input`
// pause. Semantic difference: an interaction always injects the human's value as
// the pending call's result on resume; there is no approve/deny branch.

/**
 * Persist a paused-for-interaction run — status → awaiting-interaction + a pending
 * interaction row. Mirrors {@link persistApprovalPauseAt} for the `run()` path.
 */
export const persistInteractionPauseAt = (params: {
  readonly dbPath: string;
  readonly runId: string;
  readonly interaction: {
    interactionId: string;
    kind: string;
    prompt: string;
    schemaJson: string;
  };
}): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    yield* store.setStatus(params.runId, "awaiting-interaction");
    yield* store.putInteraction({
      runId: params.runId,
      interactionId: params.interaction.interactionId,
      kind: params.interaction.kind,
      prompt: params.interaction.prompt,
      schemaJson: params.interaction.schemaJson,
    });
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

/**
 * Record a human's response on a run's pending interaction. Fails
 * `InteractionStateError` when the run has no pending interaction (e.g. already
 * answered, completed, or never paused) OR when the supplied `interactionId`
 * does not match the pending one (wrong/stale id) — the store UPDATE in that
 * case matches 0 rows, which must not be treated as success. Mirrors
 * {@link decideApprovalRecord}.
 */
export const decideInteractionRecord = (params: {
  readonly dbPath: string;
  readonly runId: string;
  readonly interactionId: string;
  readonly valueJson: string;
}): Effect.Effect<void, InteractionStateError> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    const pending = yield* store.getPendingInteraction(params.runId);
    if (!pending || pending.interactionId !== params.interactionId) {
      return yield* Effect.fail(
        new InteractionStateError({
          runId: params.runId,
          detail: pending
            ? `interactionId mismatch: pending is ${pending.interactionId}, got ${params.interactionId}`
            : "no pending interaction",
        }),
      );
    }
    const changed = yield* store.decideInteraction(params.runId, params.interactionId, params.valueJson);
    if (!changed) {
      return yield* Effect.fail(
        new InteractionStateError({ runId: params.runId, detail: "interaction already answered" }),
      );
    }
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));

/** The single pending interaction for a run (or undefined). Used by `listPendingInteractions`. */
export const getPendingInteractionAt = (params: {
  readonly dbPath: string;
  readonly runId: string;
}): Effect.Effect<InteractionRecord | undefined, never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    return yield* store.getPendingInteraction(params.runId);
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));
