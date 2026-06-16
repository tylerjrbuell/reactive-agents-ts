/**
 * run-store.ts — Durable run persistence (v0.12.0 track 1, Phase B).
 *
 * SQLite-backed store for live run state + per-iteration checkpoints. Mirrors
 * `SessionStoreService` (memory pkg) — a `Context.Tag` service plus a `Live`
 * Layer, schema created via `CREATE TABLE IF NOT EXISTS`. Opt-in via
 * `.withDurableRuns()` (Phase B3); resume reads these rows (Phase C).
 *
 * `state_json` holds a codec-serialized `KernelState` snapshot
 * (`serializeKernelState`) so a crashed run can be rehydrated.
 *
 * DB API: `@reactive-agents/runtime-shim` `Database` — `db.exec(sql)` for DDL,
 * `db.prepare(sql).run(...params)` for writes, `db.prepare(sql).get(...params)`
 * for single-row reads (verified against runtime-shim/src/database.ts).
 */
import { Context, Effect, Layer } from "effect";
import { Database, hash } from "@reactive-agents/runtime-shim";

/**
 * Canonical durable config hash (Phase C config-hash guard).
 *
 * Hashes a STABLE agent-identity descriptor — system prompt + provider — rather
 * than the whole runtime config. The full config cannot be reproduced from a
 * built agent at `resume()` time (it lives inside the engine layer), so both the
 * write side (`execute-stream.ts`, at run start) and the resume side
 * (`ReactiveAgent.resumeRun`) must derive the hash from the same reproducible
 * descriptor. A mismatch (e.g. the system prompt changed between the original
 * run and the resume) trips `DurableConfigMismatchError`.
 *
 * Model is deliberately excluded: the resolved default model lives only inside
 * the engine config (e.g. a provider default like "test-model") and is not
 * reproducible from a freshly-built agent that never called `.withModel()`, so
 * hashing it would make every same-config resume spuriously mismatch.
 */
export const durableConfigHash = (d: {
  readonly systemPrompt?: string;
  readonly provider?: string;
}): string =>
  hash(
    JSON.stringify({
      systemPrompt: d.systemPrompt ?? "",
      provider: d.provider ?? "",
    }),
  ).toString(36);

export type RunStatus =
  | "running"
  | "paused"
  | "awaiting-approval"
  | "completed"
  | "failed";

export interface RunRecord {
  readonly runId: string;
  readonly agentId: string;
  readonly task: string;
  readonly status: RunStatus;
  readonly configHash: string;
  readonly updatedAt: number;
}

export interface CheckpointRecord {
  readonly iteration: number;
  readonly stateJson: string;
  readonly createdAt: number;
}

export interface ApprovalRecord {
  readonly runId: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly argsJson: string;
  readonly status: "pending" | "approved" | "denied";
  readonly reason?: string;
}

export interface RunStore {
  /** Insert (or replace) a run row, status seeded to `running`. */
  readonly createRun: (r: {
    runId: string;
    agentId: string;
    task: string;
    configHash: string;
  }) => Effect.Effect<void, never>;
  /** Transition a run to a new lifecycle status. */
  readonly setStatus: (
    runId: string,
    status: RunStatus,
  ) => Effect.Effect<void, never>;
  /** Upsert the serialized snapshot for one iteration (idempotent per iteration). */
  readonly putCheckpoint: (
    runId: string,
    iteration: number,
    stateJson: string,
  ) => Effect.Effect<void, never>;
  /** Highest-iteration checkpoint for a run, or undefined if none. */
  readonly latestCheckpoint: (
    runId: string,
  ) => Effect.Effect<CheckpointRecord | undefined, never>;
  /** The run row, or undefined if unknown. */
  readonly getRun: (
    runId: string,
  ) => Effect.Effect<RunRecord | undefined, never>;
  /**
   * All persisted run rows, newest-updated first. When `status` is supplied,
   * only runs in that lifecycle state are returned. Used by `agent.listRuns()`
   * (Phase C) to enumerate resumable / completed / failed runs.
   */
  readonly listRuns: (
    status?: RunStatus,
  ) => Effect.Effect<readonly RunRecord[], never>;
  /** Insert a pending approval row for a paused run. */
  readonly putApproval: (r: {
    runId: string;
    gateId: string;
    toolName: string;
    argsJson: string;
  }) => Effect.Effect<void, never>;
  /** The single pending approval for a run, or undefined if none pending. */
  readonly getPendingApproval: (
    runId: string,
  ) => Effect.Effect<ApprovalRecord | undefined, never>;
  /** Flip a pending approval to approved/denied. Returns false if no pending row matched. */
  readonly decideApproval: (
    runId: string,
    gateId: string,
    status: "approved" | "denied",
    reason?: string,
  ) => Effect.Effect<boolean, never>;
}

export class RunStoreService extends Context.Tag("RunStoreService")<
  RunStoreService,
  RunStore
>() {}

interface CheckpointRow {
  iteration: number;
  state_json: string;
  created_at: number;
}

interface RunRow {
  run_id: string;
  agent_id: string;
  task: string;
  status: string;
  config_hash: string;
  updated_at: number;
}

interface ApprovalRow {
  run_id: string;
  gate_id: string;
  tool_name: string;
  args_json: string;
  status: string;
  reason: string | null;
}

/**
 * Live RunStore backed by SQLite at `dbPath` (use `":memory:"` for tests).
 * Schema is created idempotently when the layer is constructed.
 */
export function RunStoreLive(dbPath: string): Layer.Layer<RunStoreService> {
  return Layer.sync(RunStoreService, () => {
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE IF NOT EXISTS runs (
        run_id      TEXT PRIMARY KEY,
        agent_id    TEXT NOT NULL,
        task        TEXT NOT NULL,
        status      TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      )`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS run_checkpoints (
        run_id     TEXT NOT NULL,
        iteration  INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, iteration)
      )`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS run_approvals (
        run_id     TEXT NOT NULL,
        gate_id    TEXT NOT NULL,
        tool_name  TEXT NOT NULL,
        args_json  TEXT NOT NULL,
        status     TEXT NOT NULL,
        reason     TEXT,
        created_at INTEGER NOT NULL,
        decided_at INTEGER,
        PRIMARY KEY (run_id, gate_id)
      )`,
    );

    const now = (): number => Date.now();

    return {
      createRun: ({ runId, agentId, task, configHash }) =>
        Effect.sync(() => {
          const ts = now();
          db.prepare(
            `INSERT OR REPLACE INTO runs
               (run_id, agent_id, task, status, config_hash, created_at, updated_at)
             VALUES (?, ?, ?, 'running', ?, ?, ?)`,
          ).run(runId, agentId, task, configHash, ts, ts);
        }),

      setStatus: (runId, status) =>
        Effect.sync(() => {
          db.prepare(
            `UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ?`,
          ).run(status, now(), runId);
        }),

      putCheckpoint: (runId, iteration, stateJson) =>
        Effect.sync(() => {
          const ts = now();
          db.prepare(
            `INSERT OR REPLACE INTO run_checkpoints
               (run_id, iteration, state_json, created_at)
             VALUES (?, ?, ?, ?)`,
          ).run(runId, iteration, stateJson, ts);
          db.prepare(
            `UPDATE runs SET updated_at = ? WHERE run_id = ?`,
          ).run(ts, runId);
        }),

      latestCheckpoint: (runId) =>
        Effect.sync(() => {
          const row = db
            .prepare(
              `SELECT iteration, state_json, created_at
                 FROM run_checkpoints
                WHERE run_id = ?
             ORDER BY iteration DESC
                LIMIT 1`,
            )
            .get(runId) as CheckpointRow | undefined;
          return row
            ? {
                iteration: row.iteration,
                stateJson: row.state_json,
                createdAt: row.created_at,
              }
            : undefined;
        }),

      getRun: (runId) =>
        Effect.sync(() => {
          const row = db
            .prepare(
              `SELECT run_id, agent_id, task, status, config_hash, updated_at
                 FROM runs
                WHERE run_id = ?`,
            )
            .get(runId) as RunRow | undefined;
          return row
            ? {
                runId: row.run_id,
                agentId: row.agent_id,
                task: row.task,
                status: row.status as RunStatus,
                configHash: row.config_hash,
                updatedAt: row.updated_at,
              }
            : undefined;
        }),

      listRuns: (status) =>
        Effect.sync(() => {
          const rows = (
            status === undefined
              ? db
                  .prepare(
                    `SELECT run_id, agent_id, task, status, config_hash, updated_at
                       FROM runs
                   ORDER BY updated_at DESC`,
                  )
                  .all()
              : db
                  .prepare(
                    `SELECT run_id, agent_id, task, status, config_hash, updated_at
                       FROM runs
                      WHERE status = ?
                   ORDER BY updated_at DESC`,
                  )
                  .all(status)
          ) as RunRow[];
          return rows.map((row) => ({
            runId: row.run_id,
            agentId: row.agent_id,
            task: row.task,
            status: row.status as RunStatus,
            configHash: row.config_hash,
            updatedAt: row.updated_at,
          }));
        }),

      putApproval: ({ runId, gateId, toolName, argsJson }) =>
        Effect.sync(() => {
          db.prepare(
            `INSERT OR REPLACE INTO run_approvals
               (run_id, gate_id, tool_name, args_json, status, reason, created_at, decided_at)
             VALUES (?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
          ).run(runId, gateId, toolName, argsJson, now());
        }),

      getPendingApproval: (runId) =>
        Effect.sync(() => {
          const row = db
            .prepare(
              `SELECT run_id, gate_id, tool_name, args_json, status, reason
                 FROM run_approvals
                WHERE run_id = ? AND status = 'pending'
             ORDER BY created_at DESC
                LIMIT 1`,
            )
            .get(runId) as ApprovalRow | undefined;
          return row
            ? {
                runId: row.run_id,
                gateId: row.gate_id,
                toolName: row.tool_name,
                argsJson: row.args_json,
                status: row.status as ApprovalRecord["status"],
                reason: row.reason ?? undefined,
              }
            : undefined;
        }),

      decideApproval: (runId, gateId, status, reason) =>
        Effect.sync(() => {
          const res = db
            .prepare(
              `UPDATE run_approvals
                  SET status = ?, reason = ?, decided_at = ?
                WHERE run_id = ? AND gate_id = ? AND status = 'pending'`,
            )
            .run(status, reason ?? null, now(), runId, gateId);
          return res.changes > 0;
        }),
    };
  });
}
