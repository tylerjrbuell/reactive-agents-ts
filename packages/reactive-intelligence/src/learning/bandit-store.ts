import { Database } from "bun:sqlite";

export type ArmStats = {
  readonly contextBucket: string;
  readonly armId: string;
  readonly alpha: number;  // Beta distribution success param
  readonly beta: number;   // Beta distribution failure param
  readonly pulls: number;
};

export class BanditStore {
  private db: Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
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
    this.db.run(
      `INSERT OR REPLACE INTO bandit_arms (context_bucket, arm_id, alpha, beta, pulls, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [stats.contextBucket, stats.armId, stats.alpha, stats.beta, stats.pulls],
    );
  }

  load(contextBucket: string, armId: string): ArmStats | null {
    const row = this.db.query(
      "SELECT context_bucket, arm_id, alpha, beta, pulls FROM bandit_arms WHERE context_bucket = ? AND arm_id = ?",
    ).get(contextBucket, armId) as { context_bucket: string; arm_id: string; alpha: number; beta: number; pulls: number } | null;
    if (!row) return null;
    return {
      contextBucket: row.context_bucket,
      armId: row.arm_id,
      alpha: row.alpha,
      beta: row.beta,
      pulls: row.pulls,
    };
  }

  listArms(contextBucket: string): readonly ArmStats[] {
    return (this.db.query(
      "SELECT context_bucket, arm_id, alpha, beta, pulls FROM bandit_arms WHERE context_bucket = ?",
    ).all(contextBucket) as Array<{ context_bucket: string; arm_id: string; alpha: number; beta: number; pulls: number }>).map((r) => ({
      contextBucket: r.context_bucket,
      armId: r.arm_id,
      alpha: r.alpha,
      beta: r.beta,
      pulls: r.pulls,
    }));
  }
}
