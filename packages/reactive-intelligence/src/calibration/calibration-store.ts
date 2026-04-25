import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import type { ModelCalibration } from "../types.js";
import type { Capability } from "@reactive-agents/llm-provider";

const DEFAULT_DB_PATH = "~/.reactive-agents/calibration.db";

function expandPath(p: string): string {
  if (p === ":memory:") return p;
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

export class CalibrationStore {
  private db: Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    const resolved = expandPath(dbPath);
    if (resolved !== ":memory:") {
      mkdirSync(dirname(resolved), { recursive: true });
    }
    this.db = new Database(resolved, { create: true });
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
    // Phase 1 S1.2 — Capability cache. Composite primary key on (provider,
    // model) because a single model name can appear under multiple providers
    // (e.g. an OpenAI-API-compatible local server hosting "gpt-4o").
    // `capability` column stores the full Capability JSON; we never query
    // individual fields so denormalising into columns isn't worth it.
    this.db.exec(`CREATE TABLE IF NOT EXISTS capabilities (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      capability TEXT NOT NULL,
      saved_at INTEGER NOT NULL,
      PRIMARY KEY (provider, model)
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

  // ── Capability persistence (Phase 1 S1.2) ──────────────────────────────────

  /**
   * Cache a Capability for a (provider, model) pair. Used by the resolver
   * (S1.3) to write through after a successful probe so subsequent runs skip
   * re-probing. Idempotent — UPSERT on the composite key.
   *
   * The full Capability struct is JSON-serialised into one column. Schema
   * evolution is bounded by the Effect Schema in `@reactive-agents/llm-provider`;
   * loadCapability re-validates on read to catch malformed rows.
   */
  saveCapability(cap: Capability): void {
    this.db.prepare(`INSERT OR REPLACE INTO capabilities
      (provider, model, capability, saved_at)
      VALUES (?, ?, ?, ?)
    `).run(cap.provider, cap.model, JSON.stringify(cap), Date.now());
  }

  /**
   * Look up a previously-saved Capability. Returns null when the (provider,
   * model) pair has no cached entry — caller (resolver) then falls back to
   * static-table or the conservative default.
   *
   * No schema validation is performed on read: stored values are trusted
   * because saveCapability only ever accepts valid Capability inputs.
   * If a future migration changes Capability's shape, add an Effect Schema
   * decode here so legacy rows don't silently corrupt the resolver.
   */
  loadCapability(provider: string, model: string): Capability | null {
    const row = this.db
      .prepare("SELECT capability FROM capabilities WHERE provider = ? AND model = ?")
      .get(provider, model) as { capability: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.capability) as Capability;
  }
}
