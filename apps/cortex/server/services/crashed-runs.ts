/**
 * Crashed durable desk runs (roadmap C13): a desk run built with durable runs
 * that was still going when Cortex stopped (process killed, machine slept,
 * crash). Its `cortex_runs` row stays `live` with nothing running it, while the
 * framework's durable store still holds its last checkpoint. Cortex finds those
 * runs and resumes them with the framework's `agent.resumeRun(durableRunId)`
 * (runner `resumeCrashed`), on an agent rebuilt from the run's stored launch
 * config under the same agent id, so the store, the config hash and the task
 * id all match the original.
 *
 * Reads go through framework readers only: `listDurableRuns` (the reader
 * behind `rax ps`) and `RunStoreService.latestCheckpoint`. Cortex never opens
 * `runs.db` with SQL.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { Effect } from "effect";
import { listDurableRuns, RunStoreLive, RunStoreService, type RunRecord } from "@reactive-agents/runtime";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";
import type { LaunchParams } from "./runner-service.js";

/**
 * True when a build checkpoints durably: durable runs on. A `detach` approval
 * policy alone does not: without durable runs its run waits live, in process,
 * for Approve / Deny (runtime 078365780, `durable-approvals.ts` live sources).
 * The one rule, shared with `buildCortexAgent`.
 */
export function isDurableBuild(p: Pick<BuildCortexAgentParams, "durableRuns" | "approvalPolicy">): boolean {
  return p.durableRuns?.enabled === true;
}

/**
 * The durable store file of an agent: `<dir>/runs.db`, where `dir` is the
 * configured `durableRuns.dir` or the framework default
 * `~/.reactive-agents/<agentId>/` (`withDurableRuns` JSDoc; the framework
 * exports no resolver for it).
 */
export function durableRunsDbPath(agentId: string, dir?: string, home: string = homedir()): string {
  return join(dir && dir.trim() !== "" ? dir : join(home, ".reactive-agents", agentId), "runs.db");
}

/** Durable statuses a crash leaves behind: the run was going, nobody is waiting on a person. */
const CRASH_STATUSES: ReadonlySet<string> = new Set(["running", "paused"]);

/** The newest record a crash left mid-run, if any. Pure. */
export function pickCrashedDurableRun(records: readonly RunRecord[]): RunRecord | undefined {
  return [...records]
    .filter((r) => CRASH_STATUSES.has(r.status))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** A desk run that can be resumed from its durable checkpoint. */
export interface CrashedRun {
  /** Cortex run id (the framework task id the run's events carry). */
  readonly runId: string;
  readonly agentId: string;
  readonly name: string | null;
  readonly startedAt: number;
  /** The framework's durable run id (`resumeRun` takes this). */
  readonly durableRunId: string;
  /** Loop of the last checkpoint (0-based, the framework's iteration). */
  readonly checkpointIteration: number;
  /** When the durable store last saw the run. */
  readonly updatedAt: number;
  /** The stored launch config the agent is rebuilt from. */
  readonly launch: LaunchParams;
}

/** Wire shape of a crashed run (`GET /api/crashed-runs`): no launch config. */
export type CrashedRunSummary = Omit<CrashedRun, "launch">;

/** Drop the launch config before a crashed run goes over the wire. */
export const crashedRunSummaryOf = ({ launch: _launch, ...rest }: CrashedRun): CrashedRunSummary => rest;

interface LiveDeskRunRow {
  readonly run_id: string;
  readonly agent_id: string;
  readonly started_at: number;
  readonly display_name: string | null;
  readonly launch_params_json: string;
}

const parseLaunch = (json: string): LaunchParams | null => {
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v !== "object" || v === null || typeof (v as { prompt?: unknown }).prompt !== "string") return null;
    return v as LaunchParams;
  } catch {
    return null;
  }
};

const latestCheckpointOf = (dbPath: string, durableRunId: string) =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    return yield* store.latestCheckpoint(durableRunId);
  }).pipe(Effect.provide(RunStoreLive(dbPath)));

/** Options for {@link findCrashedRuns}. */
export interface FindCrashedRunsOptions {
  /** Runs this process is running now (runner active map): never crashed. */
  readonly activeRunIds: ReadonlySet<string>;
  /** Only this run (the resume route). */
  readonly runId?: string;
  /** Home dir for the framework's default durable dir (tests). */
  readonly home?: string;
}

/**
 * Desk runs left `live` with nothing running them whose durable store holds a
 * mid-run record with a checkpoint. A run whose store file does not exist is
 * skipped without opening it, so looking never creates a store.
 */
export const findCrashedRuns = (
  db: Database,
  opts: FindCrashedRunsOptions,
): Effect.Effect<readonly CrashedRun[]> =>
  Effect.gen(function* () {
    const rows = db
      .prepare(
        `SELECT run_id, agent_id, started_at, display_name, launch_params_json FROM cortex_runs
         WHERE status = 'live' AND launch_params_json IS NOT NULL ${opts.runId ? "AND run_id = ?" : ""}
         ORDER BY started_at DESC`,
      )
      .all(...(opts.runId ? [opts.runId] : [])) as LiveDeskRunRow[];
    const out: CrashedRun[] = [];
    for (const row of rows) {
      if (opts.activeRunIds.has(row.run_id)) continue;
      const launch = parseLaunch(row.launch_params_json);
      if (!launch || !isDurableBuild(launch)) continue;
      const dbPath = durableRunsDbPath(row.agent_id, launch.durableRuns?.dir, opts.home);
      if (!existsSync(dbPath)) continue;
      const records = yield* listDurableRuns({ dbPath });
      const record = pickCrashedDurableRun(records.filter((r) => r.agentId === row.agent_id));
      if (!record) continue;
      const checkpoint = yield* latestCheckpointOf(dbPath, record.runId);
      if (!checkpoint) continue;
      out.push({
        runId: row.run_id,
        agentId: row.agent_id,
        name: row.display_name,
        startedAt: row.started_at,
        durableRunId: record.runId,
        checkpointIteration: checkpoint.iteration,
        updatedAt: record.updatedAt,
        launch,
      });
    }
    return out;
  });
