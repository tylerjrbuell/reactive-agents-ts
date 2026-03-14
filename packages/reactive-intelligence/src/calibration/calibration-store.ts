import { Database } from "bun:sqlite";
import type { ModelCalibration } from "../types.js";

export class CalibrationStore {
  private db: Database;

  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS calibrations (
      model_id TEXT PRIMARY KEY,
      scores TEXT NOT NULL,
      sample_count INTEGER NOT NULL,
      high_entropy_threshold REAL NOT NULL,
      convergence_threshold REAL NOT NULL,
      calibrated INTEGER NOT NULL DEFAULT 0,
      last_updated INTEGER NOT NULL,
      drift_detected INTEGER NOT NULL DEFAULT 0
    )`);
  }

  save(cal: ModelCalibration): void {
    this.db.prepare(`INSERT OR REPLACE INTO calibrations
      (model_id, scores, sample_count, high_entropy_threshold, convergence_threshold, calibrated, last_updated, drift_detected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cal.modelId,
      JSON.stringify(cal.calibrationScores),
      cal.sampleCount,
      cal.highEntropyThreshold,
      cal.convergenceThreshold,
      cal.calibrated ? 1 : 0,
      cal.lastUpdated,
      cal.driftDetected ? 1 : 0,
    );
  }

  load(modelId: string): ModelCalibration | null {
    const row = this.db.prepare("SELECT * FROM calibrations WHERE model_id = ?").get(modelId) as any;
    if (!row) return null;
    return {
      modelId: row.model_id,
      calibrationScores: JSON.parse(row.scores),
      sampleCount: row.sample_count,
      highEntropyThreshold: row.high_entropy_threshold,
      convergenceThreshold: row.convergence_threshold,
      calibrated: !!row.calibrated,
      lastUpdated: row.last_updated,
      driftDetected: !!row.drift_detected,
    };
  }
}
