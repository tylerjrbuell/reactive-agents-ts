// Spikes S3/S4 (2026-11-18 measurement overhaul): typed loader for saved per-cell
// bench results (`cells[]` in the h3 / long-horizon results JSON). Zero tokens.
import { readFileSync } from "node:fs";

/** One saved bench cell (a single run of one task on one tier), the fields the spikes read. */
export interface SavedCell {
  readonly tier: string;
  readonly taskId: string;
  readonly run: number;
  /** Graded accuracy 0..1 (what the v1 lift gate scores); null when not measured. */
  readonly accuracy: number | null;
  /** Binary solve (what pass^k and the v2 risk difference use). */
  readonly solved: boolean;
  readonly inconclusive: boolean;
  readonly tokens: number;
  readonly billedTokens: number | null;
  readonly durationMs: number;
  readonly iterations: number | null;
  readonly status: string;
  readonly traceFile: string | null;
  /** How the run ended (`controller_early_stop:dispatcher_early_stop`, ...); null when absent. */
  readonly terminatedBy: string | null;
}

/** A parsed results file. */
export interface SavedResults {
  readonly path: string;
  readonly gitSha: string;
  readonly cells: readonly SavedCell[];
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Parse one results JSON. Cells missing `taskId`/`tier` are dropped, not guessed.
 *
 * @param text The file contents.
 * @param path Source path (kept for provenance).
 * @returns The parsed file, or undefined when it has no `cells[]`.
 */
export function parseResults(text: string, path: string): SavedResults | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || !Array.isArray(raw["cells"])) return undefined;
  const cells: SavedCell[] = [];
  for (const c of raw["cells"]) {
    if (!isRecord(c)) continue;
    const taskId = c["taskId"];
    const tier = c["tier"];
    if (typeof taskId !== "string" || typeof tier !== "string") continue;
    cells.push({
      tier,
      taskId,
      run: num(c["run"]) ?? 0,
      accuracy: num(c["accuracy"]),
      solved: c["solved"] === true,
      inconclusive: c["inconclusive"] === true,
      tokens: num(c["tokens"]) ?? 0,
      billedTokens: num(c["billedTokens"]),
      durationMs: num(c["durationMs"]) ?? 0,
      iterations: num(c["iterations"]),
      status: typeof c["status"] === "string" ? c["status"] : "unknown",
      traceFile: typeof c["traceFile"] === "string" ? c["traceFile"] : null,
      terminatedBy: typeof c["terminatedBy"] === "string" ? c["terminatedBy"] : null,
    });
  }
  return { path, gitSha: typeof raw["gitSha"] === "string" ? raw["gitSha"] : "unknown", cells };
}

/** Read and parse a results file from disk. */
export const loadResults = (path: string): SavedResults | undefined => parseResults(readFileSync(path, "utf8"), path);

/** A measured cell: it produced a score (not inconclusive, accuracy recorded). */
export const isMeasured = (c: SavedCell): boolean => !c.inconclusive && c.accuracy !== null;

/** Billed tokens when recorded, else raw tokens. */
export const billed = (c: SavedCell): number => c.billedTokens ?? c.tokens;

/**
 * Group cells by `tier|taskId`.
 *
 * @param cells Cells of one arm.
 * @returns Map keyed `tier\u0000taskId`.
 */
export function groupByTierTask(cells: readonly SavedCell[]): ReadonlyMap<string, readonly SavedCell[]> {
  const out = new Map<string, SavedCell[]>();
  for (const c of cells) {
    const key = `${c.tier}\u0000${c.taskId}`;
    const list = out.get(key);
    if (list) list.push(c);
    else out.set(key, [c]);
  }
  return out;
}
