import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  emptyObservations,
  OBSERVATIONS_SCHEMA_VERSION,
  OBSERVATIONS_WINDOW,
  type ModelObservations,
  type RunObservation,
} from "./observations-types.js";

export interface StoreOptions {
  /** Override the base directory (test hook). Defaults to ~/.reactive-agents/observations. */
  readonly baseDir?: string;
}

function defaultBaseDir(): string {
  return join(homedir(), ".reactive-agents", "observations");
}

export function normalizeModelIdForFile(modelId: string): string {
  return modelId.toLowerCase().replace(/:/g, "-").replace(/\s+/g, "-");
}

export function observationsPath(modelId: string, baseDir?: string): string {
  const root = baseDir ?? defaultBaseDir();
  return join(root, `${normalizeModelIdForFile(modelId)}.json`);
}

export function loadObservations(modelId: string, opts: StoreOptions = {}): ModelObservations {
  const path = observationsPath(modelId, opts.baseDir);
  if (!existsSync(path)) return emptyObservations(modelId);
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as ModelObservations;
    if (parsed.schemaVersion !== OBSERVATIONS_SCHEMA_VERSION) {
      // Schema drift — treat as empty, don't crash
      return emptyObservations(modelId);
    }
    return parsed;
  } catch {
    // Corrupt file — fall back to empty
    return emptyObservations(modelId);
  }
}

export function appendObservation(
  modelId: string,
  run: RunObservation,
  opts: StoreOptions = {},
): void {
  const path = observationsPath(modelId, opts.baseDir);
  const current = loadObservations(modelId, opts);
  const runs = [...current.runs, run].slice(-OBSERVATIONS_WINDOW);
  const next: ModelObservations = {
    schemaVersion: OBSERVATIONS_SCHEMA_VERSION,
    modelId,
    sampleCount: current.sampleCount + 1,
    runs,
  };
  writeAtomic(path, JSON.stringify(next, null, 2));
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}
