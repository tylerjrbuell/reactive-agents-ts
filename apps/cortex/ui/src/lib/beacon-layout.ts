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

/**
 * Per-viewer store of positions the viewer dragged. v2 holds drags only: v1
 * also stored computed positions, which froze an overlapping layout in place.
 */
export const POSITIONS_KEY = "cortex.beacon.positions.v2";
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

/** Canvas size in CSS pixels. */
export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/**
 * One Field node's footprint plus breathing room, in px: the node is 168px
 * wide (label chip) and at most ~104px tall (tile, gap, name, status,
 * "sub-agent"). Slots are this size, so two slotted nodes never overlap.
 */
export const FIELD_NODE = { width: 180, height: 116 } as const;

/** Canvas the layout assumes before the Field has been measured. */
export const DEFAULT_CANVAS: CanvasSize = { width: 1200, height: 560 };

/** Room kept clear for the Arrange button (top) and the legend (bottom). */
const PAD = { x: 12, top: 44, bottom: 30 } as const;

/** The slot grid for a canvas: columns, rows and each slot's centre in percent. */
export interface FieldGrid {
  readonly cols: number;
  readonly rows: number;
  /** Slot centres, row-major (row 0 first, left to right). */
  readonly slots: readonly Pos[];
}

/** Slot grid for a canvas size (always at least one slot). */
export function fieldGrid(canvas: CanvasSize): FieldGrid {
  const w = Math.max(canvas.width, FIELD_NODE.width);
  const h = Math.max(canvas.height, FIELD_NODE.height);
  const cols = Math.max(1, Math.floor((w - PAD.x * 2) / FIELD_NODE.width));
  const rows = Math.max(1, Math.floor((h - PAD.top - PAD.bottom) / FIELD_NODE.height));
  const offX = (w - cols * FIELD_NODE.width) / 2;
  const offY = PAD.top +Math.max(0, (h - PAD.top - PAD.bottom - rows * FIELD_NODE.height) / 2);
  const slots: Pos[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({
        x: ((offX + FIELD_NODE.width * (c + 0.5)) / w) * 100,
        y: ((offY + FIELD_NODE.height * (r + 0.5)) / h) * 100,
      });
    }
  }
  return { cols, rows, slots };
}

/**
 * Height in px a Field of `width` needs to give `count` nodes their own slot.
 * The Field grows to at least this and scrolls, so a large desk never stacks.
 */
export function fieldHeightFor(count: number, width: number): number {
  const cols = fieldGrid({ width, height: FIELD_NODE.height }).cols;
  const rows = Math.max(1, Math.ceil(count / cols));
  return PAD.top + PAD.bottom + rows * FIELD_NODE.height;
}

/** Options for {@link layoutPositions}. */
export interface LayoutOptions {
  /** Measured canvas; defaults to {@link DEFAULT_CANVAS}. */
  readonly canvas?: CanvasSize;
  /**
   * Sort key for roots, lower first (Arrange: delegation trees, then state
   * lanes). Ties and the default order fall back to start time, then runId.
   */
  readonly rootRank?: (runId: string) => number;
}

/**
 * Compute positions for every agent. `placed` entries (restored or dragged)
 * are returned untouched; unplaced agents are filled in deterministically
 * into free slots of a pixel grid sized for the canvas, so no two placed-by-
 * layout nodes overlap while slots remain. Roots fill slots in reading order;
 * a sub-agent takes the free slot nearest under its parent. Past capacity,
 * extra nodes stack on slots with a small offset (Board is the view for very
 * large desks). `parentOf` maps child runId to resolved parent runId.
 */
export function layoutPositions(
  agents: readonly LayoutAgent[],
  parentOf: ReadonlyMap<string, string>,
  placed: ReadonlyMap<string, Pos>,
  options: LayoutOptions = {},
): Map<string, Pos> {
  const canvas = options.canvas ?? DEFAULT_CANVAS;
  const grid = fieldGrid(canvas);
  const rank = options.rootRank;
  const sorted = [...agents].sort(byStart);
  const ids = new Set(sorted.map((s) => s.runId));
  const out = new Map<string, Pos>();
  const taken = new Set<number>();
  const slotOf = (p: Pos): number => {
    const x = (p.x / 100) * canvas.width;
    const y = (p.y / 100) * canvas.height;
    let best = -1;
    let bestD = Infinity;
    grid.slots.forEach((s, i) => {
      const dx = Math.abs((s.x / 100) * canvas.width - x);
      const dy = Math.abs((s.y / 100) * canvas.height - y);
      if (dx < FIELD_NODE.width && dy < FIELD_NODE.height) {
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    });
    return best;
  };
  for (const s of sorted) {
    const p = placed.get(s.runId);
    if (!p) continue;
    out.set(s.runId, p);
    // A placed node blocks every slot its footprint touches.
    grid.slots.forEach((slot, i) => {
      const dx = Math.abs(((slot.x - p.x) / 100) * canvas.width);
      const dy = Math.abs(((slot.y - p.y) / 100) * canvas.height);
      if (dx < FIELD_NODE.width && dy < FIELD_NODE.height) taken.add(i);
    });
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
  if (rank) roots.sort((x, y) => rank(x.runId) - rank(y.runId) || byStart(x, y));

  let overflow = 0;
  /** Take the best free slot by `score` (lower wins), or stack past capacity. */
  const take = (score: (row: number, col: number) => number): Pos => {
    let best = -1;
    let bestScore = Infinity;
    grid.slots.forEach((_, i) => {
      if (taken.has(i)) return;
      const sc = score(Math.floor(i / grid.cols), i % grid.cols);
      if (sc < bestScore) {
        bestScore = sc;
        best = i;
      }
    });
    if (best >= 0) {
      taken.add(best);
      return grid.slots[best]!;
    }
    const base = grid.slots[overflow % grid.slots.length]!;
    const layer = 1 + Math.floor(overflow / grid.slots.length);
    overflow += 1;
    return { x: clamp(base.x + layer * 1.5, 2, 98), y: clamp(base.y + layer * 3, 2, 98) };
  };

  const visit = (node: LayoutAgent): void => {
    const base = out.get(node.runId);
    const at = base ? slotOf(base) : -1;
    const pr = at >= 0 ? Math.floor(at / grid.cols) : 0;
    const pc = at >= 0 ? at % grid.cols : Math.floor(grid.cols / 2);
    const children = kids.get(node.runId) ?? [];
    // Children spread under the parent: child i aims at its own column, the
    // set centred on the parent's column (shifted in from the grid edges).
    const span = Math.min(children.length, grid.cols);
    const first = clamp(pc - Math.floor((span - 1) / 2), 0, Math.max(0, grid.cols - span));
    children.forEach((child, i) => {
      if (!out.has(child.runId)) {
        const target = first + (i % span);
        // Rows below the parent first (nearest row, then nearest column, left
        // before right); rows at or above only when nothing below is free.
        out.set(
          child.runId,
          take((row, col) => {
            const below = row > pr;
            const rowCost = below ? row - pr - 1 : grid.rows + (pr - row);
            return rowCost * 1000 + Math.abs(col - target) * 2 + (col < target ? 0 : 1);
          }),
        );
      }
      visit(child);
    });
  };

  for (const root of roots) {
    if (!out.has(root.runId)) {
      // A parent sits where its sub-agents can centre under it.
      const n = Math.min((kids.get(root.runId) ?? []).length, grid.cols);
      const minCol = Math.floor((n - 1) / 2);
      out.set(root.runId, take((row, col) => row * 1000 + col + (n > 1 && col < minCol ? 500 : 0)));
    }
    visit(root);
  }
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
