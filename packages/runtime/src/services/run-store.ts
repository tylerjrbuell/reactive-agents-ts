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
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
  | "awaiting-interaction"
  | "completed"
  | "failed";

export interface RunRecord {
  readonly runId: string;
  readonly agentId: string;
  readonly task: string;
  readonly status: RunStatus;
  readonly configHash: string;
  readonly updatedAt: number;
  readonly userId?: string;
  readonly orgId?: string;
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

export interface RunEventRecord {
  readonly seq: number;
  readonly eventJson: string;
  readonly createdAt: number;
}

export interface InteractionRecord {
  readonly runId: string;
  readonly interactionId: string;
  readonly kind: string;
  readonly schemaJson: string;
  readonly prompt: string;
  readonly status: "pending" | "answered";
  readonly valueJson?: string;
}

export interface RunStore {
  /** Insert (or replace) a run row, status seeded to `running`. */
  readonly createRun: (r: {
    runId: string;
    agentId: string;
    task: string;
    configHash: string;
    userId?: string;
    orgId?: string;
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
   * only runs in that lifecycle state are returned; when `userId` is supplied,
   * only runs owned by that user are returned. Used by `agent.listRuns()`
   * (Phase C) to enumerate resumable / completed / failed runs.
   */
  readonly listRuns: (filter?: {
    status?: RunStatus;
    userId?: string;
  }) => Effect.Effect<readonly RunRecord[], never>;
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
  /** Append one stream-event journal row at the given sequence number. */
  readonly appendRunEvent: (
    runId: string,
    seq: number,
    eventJson: string,
  ) => Effect.Effect<void, never>;
  /**
   * Journal rows for a run, ordered by `seq` ASC. When `afterSeq` is supplied,
   * only rows with `seq > afterSeq` are returned (resume-from-cursor).
   */
  readonly listRunEvents: (
    runId: string,
    afterSeq?: number,
  ) => Effect.Effect<readonly RunEventRecord[], never>;
  /** Next journal sequence number for a run (max(seq)+1, starts at 1). */
  readonly nextEventSeq: (runId: string) => Effect.Effect<number, never>;
  /** Insert a pending agent-initiated interaction row. */
  readonly putInteraction: (r: {
    runId: string;
    interactionId: string;
    kind: string;
    schemaJson: string;
    prompt: string;
  }) => Effect.Effect<void, never>;
  /** The single pending interaction for a run, or undefined if none pending. */
  readonly getPendingInteraction: (
    runId: string,
  ) => Effect.Effect<InteractionRecord | undefined, never>;
  /** Flip a pending interaction to answered. Returns false if no pending row matched. */
  readonly decideInteraction: (
    runId: string,
    interactionId: string,
    valueJson: string,
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
  user_id: string | null;
  org_id: string | null;
}

interface ApprovalRow {
  run_id: string;
  gate_id: string;
  tool_name: string;
  args_json: string;
  status: string;
  reason: string | null;
}

interface RunEventRow {
  seq: number;
  event_json: string;
  created_at: number;
}

interface InteractionRow {
  run_id: string;
  interaction_id: string;
  kind: string;
  schema_json: string;
  prompt: string;
  status: string;
  value_json: string | null;
}

/**
 * Live RunStore backed by SQLite at `dbPath` (use `":memory:"` for tests).
 * Schema is created idempotently when the layer is constructed.
 */
export function RunStoreLive(dbPath: string): Layer.Layer<RunStoreService> {
  return Layer.sync(RunStoreService, () => {
    // Ensure the parent dir exists before opening. The write path (execute-stream)
    // mkdirs, but the READ path (listRuns / listPendingApprovals / resumeRun /
    // approveRun) opens the same db on a fresh agent that has never persisted a
    // run — without this, SQLite fails with "unable to open database file".
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
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
    // Identity columns on `runs` — guarded ALTER so pre-existing DBs (created
    // before per-user/per-org identity was tracked) pick them up idempotently.
    const runsCols = db
      .prepare("PRAGMA table_info(runs)")
      .all()
      .map((c) => (c as { name: string }).name);
    if (!runsCols.includes("user_id")) {
      db.exec("ALTER TABLE runs ADD COLUMN user_id TEXT");
    }
    if (!runsCols.includes("org_id")) {
      db.exec("ALTER TABLE runs ADD COLUMN org_id TEXT");
    }
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
    db.exec(
      `CREATE TABLE IF NOT EXISTS run_events (
        run_id     TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, seq)
      )`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS run_interactions (
        run_id        TEXT NOT NULL,
        interaction_id TEXT NOT NULL,
        kind          TEXT NOT NULL,
        schema_json   TEXT NOT NULL,
        prompt        TEXT NOT NULL,
        status        TEXT NOT NULL,
        value_json    TEXT,
        created_at    INTEGER NOT NULL,
        decided_at    INTEGER,
        PRIMARY KEY (run_id, interaction_id)
      )`,
    );

    const now = (): number => Date.now();

    return {
      createRun: ({ runId, agentId, task, configHash, userId, orgId }) =>
        Effect.sync(() => {
          const ts = now();
          db.prepare(
            `INSERT OR REPLACE INTO runs
               (run_id, agent_id, task, status, config_hash, created_at, updated_at, user_id, org_id)
             VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
          ).run(
            runId,
            agentId,
            task,
            configHash,
            ts,
            ts,
            userId ?? null,
            orgId ?? null,
          );
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
              `SELECT run_id, agent_id, task, status, config_hash, updated_at, user_id, org_id
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
                userId: row.user_id ?? undefined,
                orgId: row.org_id ?? undefined,
              }
            : undefined;
        }),

      listRuns: (filter) =>
        Effect.sync(() => {
          const status = filter?.status;
          const userId = filter?.userId;
          const conditions: string[] = [];
          const params: string[] = [];
          if (status !== undefined) {
            conditions.push("status = ?");
            params.push(status);
          }
          if (userId !== undefined) {
            conditions.push("user_id = ?");
            params.push(userId);
          }
          const whereClause =
            conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
          const rows = db
            .prepare(
              `SELECT run_id, agent_id, task, status, config_hash, updated_at, user_id, org_id
                 FROM runs${whereClause}
             ORDER BY updated_at DESC`,
            )
            .all(...params) as RunRow[];
          return rows.map((row) => ({
            runId: row.run_id,
            agentId: row.agent_id,
            task: row.task,
            status: row.status as RunStatus,
            configHash: row.config_hash,
            updatedAt: row.updated_at,
            userId: row.user_id ?? undefined,
            orgId: row.org_id ?? undefined,
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

      appendRunEvent: (runId, seq, eventJson) =>
        Effect.sync(() => {
          db.prepare(
            `INSERT OR REPLACE INTO run_events
               (run_id, seq, event_json, created_at)
             VALUES (?, ?, ?, ?)`,
          ).run(runId, seq, eventJson, now());
        }),

      listRunEvents: (runId, afterSeq) =>
        Effect.sync(() => {
          const rows = (
            afterSeq === undefined
              ? db
                  .prepare(
                    `SELECT seq, event_json, created_at
                       FROM run_events
                      WHERE run_id = ?
                   ORDER BY seq ASC`,
                  )
                  .all(runId)
              : db
                  .prepare(
                    `SELECT seq, event_json, created_at
                       FROM run_events
                      WHERE run_id = ? AND seq > ?
                   ORDER BY seq ASC`,
                  )
                  .all(runId, afterSeq)
          ) as RunEventRow[];
          return rows.map((row) => ({
            seq: row.seq,
            eventJson: row.event_json,
            createdAt: row.created_at,
          }));
        }),

      nextEventSeq: (runId) =>
        Effect.sync(() => {
          const row = db
            .prepare(
              `SELECT COALESCE(MAX(seq), 0) + 1 AS next
                 FROM run_events
                WHERE run_id = ?`,
            )
            .get(runId) as { next: number };
          return row.next;
        }),

      putInteraction: ({ runId, interactionId, kind, schemaJson, prompt }) =>
        Effect.sync(() => {
          db.prepare(
            `INSERT OR REPLACE INTO run_interactions
               (run_id, interaction_id, kind, schema_json, prompt, status, value_json, created_at, decided_at)
             VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
          ).run(runId, interactionId, kind, schemaJson, prompt, now());
        }),

      getPendingInteraction: (runId) =>
        Effect.sync(() => {
          const row = db
            .prepare(
              `SELECT run_id, interaction_id, kind, schema_json, prompt, status, value_json
                 FROM run_interactions
                WHERE run_id = ? AND status = 'pending'
             ORDER BY created_at DESC
                LIMIT 1`,
            )
            .get(runId) as InteractionRow | undefined;
          return row
            ? {
                runId: row.run_id,
                interactionId: row.interaction_id,
                kind: row.kind,
                schemaJson: row.schema_json,
                prompt: row.prompt,
                status: row.status as InteractionRecord["status"],
                valueJson: row.value_json ?? undefined,
              }
            : undefined;
        }),

      decideInteraction: (runId, interactionId, valueJson) =>
        Effect.sync(() => {
          const res = db
            .prepare(
              `UPDATE run_interactions
                  SET status = 'answered', value_json = ?, decided_at = ?
                WHERE run_id = ? AND interaction_id = ? AND status = 'pending'`,
            )
            .run(valueJson, now(), runId, interactionId);
          return res.changes > 0;
        }),
    };
  });
}
