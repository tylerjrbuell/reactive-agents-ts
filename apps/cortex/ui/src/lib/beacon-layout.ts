/**
 * Beacon node layout: pure, deterministic, and stable.
 *
 * Positions are percentages of the canvas. Existing (placed or dragged)
 * positions are never changed; only unplaced runs are computed, in a stable
 * order (connectedAt, then runId) with parents before children, so the result
 * does not depend on the order agents arrived (REST seed vs live WS).
 */

/** Canvas position in percent. */
export interface Pos {
  readonly x: number;
  readonly y: number;
}

/** Minimal agent shape the layout needs. */
export interface LayoutAgent {
  readonly runId: string;
  readonly connectedAt: number;
  readonly parentRunId?: string | undefined;
}

/** Subset of `Storage` used for per-viewer position persistence. */
export interface PositionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const POSITIONS_KEY = "cortex.beacon.positions.v1";
const MAX_STORED = 500;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Golden-angle spiral slot for the nth root (deterministic scatter). */
export function spiralPos(index: number): Pos {
  if (index === 0) return { x: 50, y: 42 };
  const angle = index * 2.399963;
  const r = 18 + Math.sqrt(index) * 12;
  return {
    x: clamp(50 + r * Math.cos(angle), 9, 89),
    y: clamp(42 + r * Math.sin(angle) * 0.6, 8, 76),
  };
}

const byStart = (x: LayoutAgent, y: LayoutAgent): number =>
  x.connectedAt - y.connectedAt || x.runId.localeCompare(y.runId);

/**
 * Compute positions for every agent. `placed` entries (restored or dragged)
 * are returned untouched; unplaced agents are filled in deterministically.
 * `parentOf` maps child runId to resolved parent runId (hierarchy edges).
 */
export function layoutPositions(
  agents: readonly LayoutAgent[],
  parentOf: ReadonlyMap<string, string>,
  placed: ReadonlyMap<string, Pos>,
): Map<string, Pos> {
  const sorted = [...agents].sort(byStart);
  const ids = new Set(sorted.map((s) => s.runId));
  const out = new Map<string, Pos>();
  for (const s of sorted) {
    const p = placed.get(s.runId);
    if (p) out.set(s.runId, p);
  }

  const kids = new Map<string, LayoutAgent[]>();
  const roots: LayoutAgent[] = [];
  for (const s of sorted) {
    const parent = parentOf.get(s.runId);
    if (parent !== undefined && ids.has(parent)) {
      const list = kids.get(parent) ?? [];
      list.push(s);
      kids.set(parent, list);
    } else roots.push(s);
  }

  const visit = (node: LayoutAgent): void => {
    const children = kids.get(node.runId) ?? [];
    const base = out.get(node.runId);
    children.forEach((child, i) => {
      if (base && !out.has(child.runId)) {
        out.set(child.runId, {
          x: clamp(base.x + (i - (children.length - 1) / 2) * 14, 8, 92),
          y: Math.min(80, base.y + 22),
        });
      }
      visit(child);
    });
  };

  roots.forEach((root, i) => {
    if (!out.has(root.runId)) out.set(root.runId, spiralPos(i));
    visit(root);
  });
  return out;
}

const isPos = (v: unknown): v is Pos =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { x?: unknown }).x === "number" &&
  typeof (v as { y?: unknown }).y === "number" &&
  Number.isFinite((v as { x: number }).x) &&
  Number.isFinite((v as { y: number }).y);

/** Read persisted positions; any failure yields an empty map. */
export function loadPositions(storage: PositionStorage | null | undefined): Map<string, Pos> {
  const out = new Map<string, Pos>();
  try {
    const raw = storage?.getItem(POSITIONS_KEY);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return out;
    for (const [id, v] of Object.entries(parsed)) if (isPos(v)) out.set(id, { x: v.x, y: v.y });
  } catch {
    /* per-viewer convenience only */
  }
  return out;
}

/** Persist positions (newest {@link MAX_STORED} kept); failures are swallowed. */
export function savePositions(
  storage: PositionStorage | null | undefined,
  positions: ReadonlyMap<string, Pos>,
): void {
  try {
    const entries = [...positions].slice(-MAX_STORED);
    storage?.setItem(POSITIONS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* per-viewer convenience only */
  }
}
