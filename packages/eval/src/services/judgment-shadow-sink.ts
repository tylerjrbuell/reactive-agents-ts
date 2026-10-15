/**
 * JudgmentShadow sink — Wave 7.1.
 *
 * EvalStore-shaped SQLite recorder consuming the existing shadow-site events
 * (no new emitters): every `JudgmentShadow` event on the bus lands as one row
 * (site, judged, current, agreement, confidence, timestamp). Agreement
 * analytics query per site against the recorded ground-truth protocol — the
 * automated form of the n=30-32 gate methodology. Inversion decisions (e.g.
 * task-comprehension) read measurements here, not probe-campaign folklore.
 *
 * Shadow mode never consumes a decision — `judged` is recorded next to the
 * actually-used `current`, never substituted. This sink only stores that
 * pairing durably.
 */
import { Effect } from "effect";
import type { JudgmentShadow } from "@reactive-agents/core";

export interface ShadowAgreement {
  readonly site: string;
  readonly samples: number;
  /** Fraction of non-null agreements that agree (0-1). */
  readonly agreementRate: number | null;
  /** High-confidence disagreements (judged confident, yet differs) — the real routing gaps. */
  readonly highConfidenceDisagreements: number;
  /** Samples where the backend produced no answer. */
  readonly nullJudgments: number;
}

export interface JudgmentShadowSink {
  readonly record: (event: JudgmentShadow) => Effect.Effect<void, never>;
  readonly agreementBySite: (site: string) => Effect.Effect<ShadowAgreement, never>;
  readonly sites: () => Effect.Effect<readonly string[], never>;
}

/**
 * Create a SQLite-backed shadow sink (same bun:sqlite pattern as eval-store).
 *
 * @param dbPath - Path to the SQLite database file.
 */
export const createJudgmentShadowSink = (dbPath: string = "judgment-shadow.db"): JudgmentShadowSink => {
  type BunDatabase = {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...params: unknown[]) => void;
      all: (...params: unknown[]) => Record<string, unknown>[];
    };
  };
  let db: BunDatabase | null = null;

  const getDb = (): BunDatabase => {
    if (db) return db;
    // Dynamic import to work in environments without bun:sqlite (mirrors eval-store).
    const bunSqlite = require("bun:sqlite") as {
      Database: new (path: string) => BunDatabase;
    };
    db = new bunSqlite.Database(dbPath);
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS judgment_shadow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site TEXT NOT NULL,
        judged TEXT,
        current TEXT NOT NULL,
        agreement INTEGER,
        confidence REAL,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_site ON judgment_shadow(site);
    `);
    return db;
  };

  const toAgreement = (site: string, rows: Record<string, unknown>[]): ShadowAgreement => {
    const samples = rows.length;
    const decided = rows.filter((r) => r.agreement !== null);
    const agreed = decided.filter((r) => r.agreement === 1).length;
    return {
      site,
      samples,
      agreementRate: decided.length > 0 ? agreed / decided.length : null,
      highConfidenceDisagreements: rows.filter(
        (r) =>
          r.agreement === 0 &&
          typeof r.confidence === "number" &&
          (r.confidence as number) >= 0.7 &&
          r.judged !== null,
      ).length,
      nullJudgments: rows.filter((r) => r.judged === null).length,
    };
  };

  return {
    record: (event) =>
      Effect.sync(() => {
        try {
          getDb().prepare(
            `INSERT INTO judgment_shadow (site, judged, current, agreement, confidence, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(
            event.site,
            event.judged,
            event.current,
            event.agreement === null ? null : event.agreement ? 1 : 0,
            event.confidence,
            new Date().toISOString(),
          );
        } catch {
          // Sink must never break a run — record is best-effort by design.
        }
      }),
    agreementBySite: (site) =>
      Effect.sync(() => {
        try {
          const rows = getDb()
            .prepare(`SELECT judged, current, agreement, confidence FROM judgment_shadow WHERE site = ?`)
            .all(site);
          return toAgreement(site, rows);
        } catch {
          return { site, samples: 0, agreementRate: null, highConfidenceDisagreements: 0, nullJudgments: 0 };
        }
      }),
    sites: () =>
      Effect.sync(() => {
        try {
          return getDb()
            .prepare(`SELECT DISTINCT site FROM judgment_shadow`)
            .all()
            .map((r) => String(r.site));
        } catch {
          return [];
        }
      }),
  };
};
