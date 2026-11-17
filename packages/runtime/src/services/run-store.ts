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
 * `db.query(sql).run(...params)` for writes, `db.query(sql).get(...params)`
 * for single-row reads (verified against runtime-shim/src/database.ts).
 * `query` (not `prepare`): Bun caches `query` statements and finalizes them on
 * `close()`, so the handle really closes; an un-finalized `prepare` statement
 * keeps the file open after `close()` until garbage collection.
 */
import { Context, Effect, Layer } from "effect";
import { Database, hash, type DatabaseLike } from "@reactive-agents/runtime-shim";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseLoopStopSummary, type LoopStopSummary } from "../loop-stop-summary.js";

/**
 * The default durable-runs directory of an agent: `~/.reactive-agents/<agentId>`.
 * The store file is `runs.db` inside it. `.withDurableRuns({ dir })` overrides it.
 *
 * The one resolver for this default: the write path (`execute-stream`), the
 * resume path (`agent.resumeRun` / `listRuns`) and hosts that read an agent's
 * store from outside (e.g. Cortex crash recovery) all call it, so they cannot
 * disagree on where a run lives.
 *
 * @param agentId - The agent id the runs belong to.
 * @param home - Home directory override (tests). Default: `os.homedir()`.
 * @returns The absolute default directory for the agent's `runs.db`.
 *
 * @example
 * ```typescript
 * const dbPath = join(defaultDurableRunsDir("my-agent"), "runs.db");
 * ```
 */
export const defaultDurableRunsDir = (agentId: string, home: string = homedir()): string =>
  join(home, ".reactive-agents", safeAgentPathSegment(agentId));

/**
 * Contain an agent id to a single inert path segment so it can never escape
 * the base directory it is joined into (`../x`, absolute paths, backslashes).
 * Percent-encodes separators; `.`, `..` and empty are neutralised. Ordinary
 * ids (letters, digits, `-`, `_`) pass through unchanged.
 *
 * @param agentId - Untrusted agent id.
 * @returns A single path segment safe to `join` under a base directory.
 */
export const safeAgentPathSegment = (agentId: string): string => {
  const seg = encodeURIComponent(agentId);
  if (seg === "") return "_";
  if (seg === "." || seg === "..") return seg.replace(/\./g, "%2E");
  return seg;
};

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
  /**
   * Counterfactual-restart provenance (Arc 1 Task 6): the source run this one
   * was forked from, and the iteration its checkpoint was forked at. Absent on
   * every non-forked run. Consumed by `rax ps` (Task 7) and `result.receipt`
   * (Task 8) to surface fork lineage — never framed as "time travel".
   */
  readonly forkedFrom?: string;
  readonly forkedAtIteration?: number;
  /**
   * The run's own working directory (`run(task, { workspace })` /
   * `runStream(task, { workspace })`), absolute. Resume, approve/deny,
   * respond and fork run in it again. Absent when the run used the
   * builder's workspace or the ambient file root.
   */
  readonly workspace?: string;
  /**
   * Why a loop guard stopped this run (reason, repeated tool, tools done,
   * unfinished rows). Present only while the run is loop-stopped; a resume
   * recreates the row and clears it.
   */
  readonly loopStop?: LoopStopSummary;
  /** True when `agent.resumeRun(runId)` can continue this run: it is loop-stopped with a final checkpoint. */
  readonly resumable?: boolean;
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

/**
 * Durable record of one side-effecting tool call (GH #262). Row statuses:
 * `executing` = pre-effect write committed, no terminal write yet (the
 * AMBIGUOUS crash window — the effect may or may not have happened);
 * `succeeded`/`failed` = the awaited terminal write committed too. Identity
 * for recovery is (tool name, canonical args JSON) — see core's
 * `toolEffectIdentityKey` — NOT the provider call id, which a resume re-mints.
 */
export interface ToolEffectRow {
  readonly runId: string;
  readonly effectId: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly argsJson: string;
  readonly status: "executing" | "succeeded" | "failed";
  readonly resultContent?: string;
  readonly errorText?: string;
  readonly createdAt: number;
  readonly committedAt?: number;
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
    /** Fork lineage (Task 6) — see {@link RunRecord.forkedFrom}. */
    forkedFrom?: string;
    forkedAtIteration?: number;
    /** The run's own working directory — see {@link RunRecord.workspace}. */
    workspace?: string;
  }) => Effect.Effect<void, never>;
  /** Transition a run to a new lifecycle status. */
  readonly setStatus: (
    runId: string,
    status: RunStatus,
  ) => Effect.Effect<void, never>;
  /** Record why a loop guard stopped a run (marks it resumable). Idempotent. */
  readonly setLoopStop: (
    runId: string,
    summary: LoopStopSummary,
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
  /**
   * Highest-iteration checkpoint at or below `iteration`, or undefined if none
   * qualifies. Used by `agent.fork()` (Task 6) to restart from ANY prior
   * checkpoint, not just the latest — unlike `latestCheckpoint` (crash-resume).
   */
  readonly checkpointAt: (
    runId: string,
    iteration: number,
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
  /**
   * Insert the pre-effect `executing` row for one side-effecting tool call
   * (GH #262). Must be awaited by the caller BEFORE the tool dispatches —
   * a crash between here and the terminal write is precisely the ambiguity
   * the `executing` status encodes.
   */
  readonly putToolEffect: (r: {
    runId: string;
    effectId: string;
    toolName: string;
    toolCallId: string;
    iteration: number;
    argsJson: string;
  }) => Effect.Effect<void, never>;
  /**
   * Record the terminal outcome of one previously inserted effect row.
   * Returns false when no matching `executing` row exists (e.g. the
   * pre-effect write was lost) — a lost `executing` row degrades to "row
   * absent", which is safe: an unknown effect is never skipped.
   */
  readonly updateToolEffectOutcome: (r: {
    runId: string;
    effectId: string;
    status: "succeeded" | "failed";
    resultContent?: string;
    errorText?: string;
  }) => Effect.Effect<boolean, never>;
  /** All effect rows for a run, oldest first. Used by the resume path. */
  readonly listToolEffects: (
    runId: string,
  ) => Effect.Effect<readonly ToolEffectRow[], never>;
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
  forked_from: string | null;
  forked_at_iteration: number | null;
  workspace: string | null;
  loop_stop_json: string | null;
}

/** Map a `runs` row to its public record. */
const runRecordOf = (row: RunRow): RunRecord => {
  const loopStop = parseLoopStopSummary(row.loop_stop_json);
  return {
  runId: row.run_id,
  agentId: row.agent_id,
  task: row.task,
  status: row.status as RunStatus,
  configHash: row.config_hash,
  updatedAt: row.updated_at,
  userId: row.user_id ?? undefined,
  orgId: row.org_id ?? undefined,
  forkedFrom: row.forked_from ?? undefined,
  forkedAtIteration: row.forked_at_iteration ?? undefined,
  workspace: row.workspace ?? undefined,
  ...(loopStop !== undefined ? { loopStop, resumable: true } : {}),
  };
};

/** Columns selected for a {@link RunRow}. */
const RUN_COLUMNS =
  "run_id, agent_id, task, status, config_hash, updated_at, user_id, org_id, forked_from, forked_at_iteration, workspace, loop_stop_json";

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

interface ToolEffectDbRow {
  run_id: string;
  effect_id: string;
  tool_name: string;
  tool_call_id: string;
  iteration: number;
  args_json: string;
  status: string;
  result_content: string | null;
  error_text: string | null;
  created_at: number;
  committed_at: number | null;
}

/**
 * Live RunStore backed by SQLite at `dbPath` (use `":memory:"` for tests).
 * Schema is created idempotently when the layer is constructed.
 *
 * Scoped: the SQLite handle opens when the layer is built and closes when its
 * scope ends (`Effect.provide(RunStoreLive(path))` closes it as the provided
 * effect finishes). Each build opens its own handle, so a host that polls the
 * store does not accumulate open files.
 */
export function RunStoreLive(dbPath: string): Layer.Layer<RunStoreService> {
  return Layer.scoped(
    RunStoreService,
    Effect.map(
      Effect.acquireRelease(
        Effect.sync(() => openRunStoreDb(dbPath)),
        (db) => Effect.sync(() => db.close()),
      ),
      makeRunStore,
    ),
  );
}

/** Open the SQLite file at `dbPath` and create the schema idempotently. */
function openRunStoreDb(dbPath: string): DatabaseLike {
    // Ensure the parent dir exists before opening. The write path (execute-stream)
    // mkdirs, but the READ path (listRuns / listPendingApprovals / resumeRun /
    // approveRun) opens the same db on a fresh agent that has never persisted a
    // run — without this, SQLite fails with "unable to open database file".
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    }
    const db = new Database(dbPath);
    if (dbPath !== ":memory:") {
      try {
        chmodSync(dbPath, 0o600); // run state holds task text + checkpoints: owner-only
      } catch {
        // best effort: filesystems without POSIX modes (e.g. Windows) ignore chmod
      }
    }
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
      .query("PRAGMA table_info(runs)")
      .all()
      .map((c) => (c as { name: string }).name);
    if (!runsCols.includes("user_id")) {
      db.exec("ALTER TABLE runs ADD COLUMN user_id TEXT");
    }
    if (!runsCols.includes("org_id")) {
      db.exec("ALTER TABLE runs ADD COLUMN org_id TEXT");
    }
    // Fork lineage columns (Arc 1 Task 6) — guarded ALTER for the same reason
    // as user_id/org_id above: pre-existing DBs predate fork() support.
    if (!runsCols.includes("forked_from")) {
      db.exec("ALTER TABLE runs ADD COLUMN forked_from TEXT");
    }
    if (!runsCols.includes("forked_at_iteration")) {
      db.exec("ALTER TABLE runs ADD COLUMN forked_at_iteration INTEGER");
    }
    // Per-run working directory — guarded ALTER, same reason as above.
    if (!runsCols.includes("workspace")) {
      db.exec("ALTER TABLE runs ADD COLUMN workspace TEXT");
    }
    // Loop-stop summary (resume of a loop-stopped run) — guarded ALTER, additive.
    if (!runsCols.includes("loop_stop_json")) {
      db.exec("ALTER TABLE runs ADD COLUMN loop_stop_json TEXT");
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
    db.exec(
      `CREATE TABLE IF NOT EXISTS run_effects (
        run_id         TEXT NOT NULL,
        effect_id      TEXT NOT NULL,
        tool_name      TEXT NOT NULL,
        tool_call_id   TEXT NOT NULL,
        iteration      INTEGER NOT NULL,
        args_json      TEXT NOT NULL,
        status         TEXT NOT NULL,
        result_content TEXT,
        error_text     TEXT,
        created_at     INTEGER NOT NULL,
        committed_at   INTEGER,
        PRIMARY KEY (run_id, effect_id)
      )`,
    );
    return db;
}

/** The RunStore operations over an open database. */
function makeRunStore(db: DatabaseLike): RunStore {
    const now = (): number => Date.now();

    return {
      createRun: ({ runId, agentId, task, configHash, userId, orgId, forkedFrom, forkedAtIteration, workspace }) =>
        Effect.sync(() => {
          const ts = now();
          db.query(
            `INSERT OR REPLACE INTO runs
               (run_id, agent_id, task, status, config_hash, created_at, updated_at, user_id, org_id, forked_from, forked_at_iteration, workspace)
             VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            runId,
            agentId,
            task,
            configHash,
            ts,
            ts,
            userId ?? null,
            orgId ?? null,
            forkedFrom ?? null,
            forkedAtIteration ?? null,
            workspace ?? null,
          );
        }),

      setStatus: (runId, status) =>
        Effect.sync(() => {
          db.query(
            `UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ?`,
          ).run(status, now(), runId);
        }),

      setLoopStop: (runId, summary) =>
        Effect.sync(() => {
          db.query(
            `UPDATE runs SET loop_stop_json = ?, updated_at = ? WHERE run_id = ?`,
          ).run(JSON.stringify(summary), now(), runId);
        }),

      putCheckpoint: (runId, iteration, stateJson) =>
        Effect.sync(() => {
          const ts = now();
          db.query(
            `INSERT OR REPLACE INTO run_checkpoints
               (run_id, iteration, state_json, created_at)
             VALUES (?, ?, ?, ?)`,
          ).run(runId, iteration, stateJson, ts);
          db.query(
            `UPDATE runs SET updated_at = ? WHERE run_id = ?`,
          ).run(ts, runId);
        }),

      latestCheckpoint: (runId) =>
        Effect.sync(() => {
          const row = db
            .query(
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

      checkpointAt: (runId, iteration) =>
        Effect.sync(() => {
          const row = db
            .query(
              `SELECT iteration, state_json, created_at
                 FROM run_checkpoints
                WHERE run_id = ? AND iteration <= ?
             ORDER BY iteration DESC
                LIMIT 1`,
            )
            .get(runId, iteration) as CheckpointRow | undefined;
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
            .query(`SELECT ${RUN_COLUMNS} FROM runs WHERE run_id = ?`)
            .get(runId) as RunRow | undefined;
          return row ? runRecordOf(row) : undefined;
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
            .query(`SELECT ${RUN_COLUMNS} FROM runs${whereClause} ORDER BY updated_at DESC`)
            .all(...params) as RunRow[];
          return rows.map(runRecordOf);
        }),

      putApproval: ({ runId, gateId, toolName, argsJson }) =>
        Effect.sync(() => {
          db.query(
            `INSERT OR REPLACE INTO run_approvals
               (run_id, gate_id, tool_name, args_json, status, reason, created_at, decided_at)
             VALUES (?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
          ).run(runId, gateId, toolName, argsJson, now());
        }),

      getPendingApproval: (runId) =>
        Effect.sync(() => {
          const row = db
            .query(
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
            .query(
              `UPDATE run_approvals
                  SET status = ?, reason = ?, decided_at = ?
                WHERE run_id = ? AND gate_id = ? AND status = 'pending'`,
            )
            .run(status, reason ?? null, now(), runId, gateId);
          return res.changes > 0;
        }),

      appendRunEvent: (runId, seq, eventJson) =>
        Effect.sync(() => {
          db.query(
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
                  .query(
                    `SELECT seq, event_json, created_at
                       FROM run_events
                      WHERE run_id = ?
                   ORDER BY seq ASC`,
                  )
                  .all(runId)
              : db
                  .query(
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
            .query(
              `SELECT COALESCE(MAX(seq), 0) + 1 AS next
                 FROM run_events
                WHERE run_id = ?`,
            )
            .get(runId) as { next: number };
          return row.next;
        }),

      putInteraction: ({ runId, interactionId, kind, schemaJson, prompt }) =>
        Effect.sync(() => {
          db.query(
            `INSERT OR REPLACE INTO run_interactions
               (run_id, interaction_id, kind, schema_json, prompt, status, value_json, created_at, decided_at)
             VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
          ).run(runId, interactionId, kind, schemaJson, prompt, now());
        }),

      getPendingInteraction: (runId) =>
        Effect.sync(() => {
          const row = db
            .query(
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
            .query(
              `UPDATE run_interactions
                  SET status = 'answered', value_json = ?, decided_at = ?
                WHERE run_id = ? AND interaction_id = ? AND status = 'pending'`,
            )
            .run(valueJson, now(), runId, interactionId);
          return res.changes > 0;
        }),

      putToolEffect: ({ runId, effectId, toolName, toolCallId, iteration, argsJson }) =>
        Effect.sync(() => {
          db.query(
            `INSERT OR REPLACE INTO run_effects
               (run_id, effect_id, tool_name, tool_call_id, iteration, args_json, status, result_content, error_text, created_at, committed_at)
             VALUES (?, ?, ?, ?, ?, ?, 'executing', NULL, NULL, ?, NULL)`,
          ).run(runId, effectId, toolName, toolCallId, iteration, argsJson, now());
        }),

      updateToolEffectOutcome: ({ runId, effectId, status, resultContent, errorText }) =>
        Effect.sync(() => {
          const res = db
            .query(
              `UPDATE run_effects
                  SET status = ?, result_content = ?, error_text = ?, committed_at = ?
                WHERE run_id = ? AND effect_id = ? AND status = 'executing'`,
            )
            .run(
              status,
              status === "succeeded" ? (resultContent ?? null) : null,
              status === "failed" ? (errorText ?? null) : null,
              now(),
              runId,
              effectId,
            );
          return res.changes > 0;
        }),

      listToolEffects: (runId) =>
        Effect.sync(() => {
          const rows = db
            .query(
              `SELECT run_id, effect_id, tool_name, tool_call_id, iteration, args_json, status,
                      result_content, error_text, created_at, committed_at
                 FROM run_effects
                WHERE run_id = ?
             ORDER BY created_at ASC, iteration ASC`,
            )
            .all(runId) as ToolEffectDbRow[];
          return rows.map((row) => ({
            runId: row.run_id,
            effectId: row.effect_id,
            toolName: row.tool_name,
            toolCallId: row.tool_call_id,
            iteration: row.iteration,
            argsJson: row.args_json,
            status: row.status as ToolEffectRow["status"],
            ...(row.result_content !== null ? { resultContent: row.result_content } : {}),
            ...(row.error_text !== null ? { errorText: row.error_text } : {}),
            createdAt: row.created_at,
            ...(row.committed_at !== null ? { committedAt: row.committed_at } : {}),
          }));
        }),
    };
}
