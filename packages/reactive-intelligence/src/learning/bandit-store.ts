import { Database } from "@reactive-agents/runtime-shim";
import type { DatabaseLike } from "@reactive-agents/runtime-shim";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

export type ArmStats = {
  readonly contextBucket: string;
  readonly armId: string;
  readonly alpha: number;  // Beta distribution success param
  readonly beta: number;   // Beta distribution failure param
  readonly pulls: number;
};

/**
 * One bandit arm with its context bucket split into the two parts the
 * learning engine composes it from (`${modelId}:${taskCategory}`, see
 * `deriveContextBucket`). Model ids may themselves contain `:` (e.g.
 * `qwen3:14b`); task categories never do, so the split is at the LAST colon.
 */
export type ArmStatsView = ArmStats & {
  readonly modelId: string;
  readonly taskCategory: string;
  /** Posterior mean success rate, `alpha / (alpha + beta)`. */
  readonly meanReward: number;
  /** Last write time, ISO-8601 UTC. */
  readonly updatedAt: string;
};

/** Filter for {@link BanditStore.listArmStats}. Omitted fields match everything. */
export type ArmStatsFilter = {
  readonly modelId?: string;
  readonly taskCategory?: string;
};

type ArmRow = {
  context_bucket: string;
  arm_id: string;
  alpha: number;
  beta: number;
  pulls: number;
  updated_at: string;
};

const expandPath = (p: string): string => {
  if (p === ":memory:") return p;
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
};

/** Split a `${modelId}:${taskCategory}` bucket at its last colon. */
export const splitContextBucket = (
  bucket: string,
): { readonly modelId: string; readonly taskCategory: string } => {
  const i = bucket.lastIndexOf(":");
  return i < 0
    ? { modelId: bucket, taskCategory: "" }
    : { modelId: bucket.slice(0, i), taskCategory: bucket.slice(i + 1) };
};

const toStats = (r: ArmRow): ArmStats => ({
  contextBucket: r.context_bucket,
  armId: r.arm_id,
  alpha: r.alpha,
  beta: r.beta,
  pulls: r.pulls,
});

/**
 * SQLite store for the strategy-selection bandit's per-arm Beta posteriors.
 *
 * `":memory:"` (the default) keeps learning per-process. A file path
 * persists it across restarts; `createReactiveIntelligenceLayer` passes the
 * calibration DB path, so arm stats live in the same file as calibration
 * (table `bandit_arms`) and persist exactly when calibration does.
 */
export class BanditStore {
  private db: DatabaseLike;

  constructor(dbPath: string = ":memory:") {
    const resolved = expandPath(dbPath);
    if (resolved !== ":memory:") {
      try {
        mkdirSync(dirname(resolved), { recursive: true });
      } catch {
        /* best effort — filesystem-less runtimes fall through to Database's own error */
      }
    }
    this.db = new Database(resolved, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    // The calibration store may hold a second connection to the same file.
    this.db.exec("PRAGMA busy_timeout = 2000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bandit_arms (
        context_bucket TEXT NOT NULL,
        arm_id TEXT NOT NULL,
        alpha REAL NOT NULL DEFAULT 1.0,
        beta REAL NOT NULL DEFAULT 1.0,
        pulls INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (context_bucket, arm_id)
      )
    `);
  }

  save(stats: ArmStats): void {
    this.db.prepare(
      `INSERT INTO bandit_arms (context_bucket, arm_id, alpha, beta, pulls, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (context_bucket, arm_id) DO UPDATE SET
         alpha = excluded.alpha, beta = excluded.beta, pulls = excluded.pulls,
         updated_at = excluded.updated_at`,
    ).run(stats.contextBucket, stats.armId, stats.alpha, stats.beta, stats.pulls);
  }

  load(contextBucket: string, armId: string): ArmStats | null {
    const row = this.db.query(
      "SELECT context_bucket, arm_id, alpha, beta, pulls, updated_at FROM bandit_arms WHERE context_bucket = ? AND arm_id = ?",
    ).get(contextBucket, armId) as ArmRow | null;
    return row ? toStats(row) : null;
  }

  listArms(contextBucket: string): readonly ArmStats[] {
    return (this.db.query(
      "SELECT context_bucket, arm_id, alpha, beta, pulls, updated_at FROM bandit_arms WHERE context_bucket = ?",
    ).all(contextBucket) as ArmRow[]).map(toStats);
  }

  /**
   * Every learned arm, grouped by model and task category, optionally
   * filtered. Ordered by model, category, then most pulls first.
   */
  listArmStats(filter: ArmStatsFilter = {}): readonly ArmStatsView[] {
    return toArmStatsViews(
      this.db.query(SELECT_ALL_ARMS).all() as ArmRow[],
      filter,
    );
  }

  /** Release the underlying database handle. */
  close(): void {
    this.db.close();
  }
}

const SELECT_ALL_ARMS =
  "SELECT context_bucket, arm_id, alpha, beta, pulls, updated_at FROM bandit_arms";

/** Rows to grouped, filtered, ordered views (see {@link BanditStore.listArmStats}). */
const toArmStatsViews = (
  rows: readonly ArmRow[],
  filter: ArmStatsFilter,
): readonly ArmStatsView[] =>
    rows
      .map((r): ArmStatsView => {
        const { modelId, taskCategory } = splitContextBucket(r.context_bucket);
        return {
          ...toStats(r),
          modelId,
          taskCategory,
          meanReward: r.alpha / (r.alpha + r.beta),
          updatedAt: r.updated_at.replace(" ", "T") + "Z",
        };
      })
      .filter(
        (v) =>
          (filter.modelId === undefined || v.modelId === filter.modelId) &&
          (filter.taskCategory === undefined || v.taskCategory === filter.taskCategory),
      )
      .sort(
        (a, b) =>
          a.modelId.localeCompare(b.modelId) ||
          a.taskCategory.localeCompare(b.taskCategory) ||
          b.pulls - a.pulls ||
          a.armId.localeCompare(b.armId),
      );

/**
 * Read the persisted bandit arm stats from a DB file without keeping it open
 * (for dashboards such as Cortex's Model page). Pass the same path given to
 * `calibrationDbPath`.
 *
 * The read never writes: the file is opened read-only, no table is created
 * and no pragma is set. Returns an empty list for `":memory:"`, for a path
 * that does not exist (nothing is created), and for a DB that has no
 * `bandit_arms` table yet.
 */
export const readBanditArmStats = (
  dbPath: string,
  filter: ArmStatsFilter = {},
): readonly ArmStatsView[] => {
  const resolved = expandPath(dbPath);
  if (resolved === ":memory:" || !existsSync(resolved)) return [];
  const db = new Database(resolved, { readonly: true });
  try {
    const table = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bandit_arms'")
      .get();
    if (table === null || table === undefined) return [];
    return toArmStatsViews(db.query(SELECT_ALL_ARMS).all() as ArmRow[], filter);
  } finally {
    db.close();
  }
};
