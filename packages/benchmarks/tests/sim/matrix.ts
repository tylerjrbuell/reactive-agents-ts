/**
 * Phase Z: the matrix. Shapes x mechanisms x {off, on}, each cell a verdict plus
 * turn and token deltas. With one seed and no tier the model is the shape's own
 * naive script (deterministic: a `hurts` here is veto-class evidence). With several
 * seeds and a tier the policy is wrapped in that tier's failure rates and the
 * verdict is a paired win/loss count over seeds (advisory: tier parameters are
 * UNCALIBRATED). Zero tokens, no live model.
 */
import { armConfig, type Mechanism } from "../../src/sim/mechanisms.js";
import type { Shape } from "../../src/sim/shape.js";
import type { Tier } from "../../src/sim/tier.js";
import { runArm, type ArmResult } from "./run-shape.js";

/** How turning the mechanism on changed the outcome. */
export type Verdict = "helps" | "hurts" | "neutral" | "inert";

/** Verdict for one off/on pair. Inert = identical request log (the mechanism changed nothing). */
export function verdictOf(off: ArmResult, on: ArmResult): Verdict {
  if (off.trace === on.trace) return "inert";
  if (on.distance < off.distance) return "helps";
  if (on.distance > off.distance) return "hurts";
  return "neutral";
}

/** One matrix cell. */
export interface Cell {
  readonly shape: string;
  readonly mechanism: string;
  readonly verdict: Verdict;
  /** Seeds run (1 = deterministic). */
  readonly seeds: number;
  /** Seeds where on beat / lost to off (paired). */
  readonly wins: number;
  readonly losses: number;
  /** Share of seeds meeting the ideal, per arm. */
  readonly offMeets: number;
  readonly onMeets: number;
  /** Mean agent turns, per arm. */
  readonly offTurns: number;
  readonly onTurns: number;
  /** Mean request-derived input tokens, per arm. */
  readonly offTokens: number;
  readonly onTokens: number;
  /** On minus off. */
  readonly turnsDelta: number;
  readonly tokensDelta: number;
  /** Tokens delta as a fraction of the off arm. */
  readonly tokensDeltaPct: number;
}

/** What to run. */
export interface MatrixOptions {
  readonly shapes: readonly Shape[];
  readonly mechanisms: readonly Mechanism[];
  /** Seeds per cell; the seeds are `1..seeds`. Default 1. */
  readonly seeds?: number;
  readonly tier?: Tier;
  /** Overrides the tier's compliance. Default: the tier's, else 1. */
  readonly compliance?: number;
}

/** Two-sided exact sign-test threshold for a many-seed direction. */
const SIGN_TEST_ALPHA = 0.1;

/** Two-sided exact sign test p-value for `wins` vs `losses` among discordant pairs (ties ignored). */
export function signTestP(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let tail = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) {
    tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Run one shape x mechanism cell over its seeds. */
export async function runCell(
  shape: Shape,
  mechanism: Mechanism,
  opts: Pick<MatrixOptions, "seeds" | "tier" | "compliance">,
  offCache: Map<string, ArmResult> = new Map(),
): Promise<Cell> {
  const seeds = opts.seeds ?? 1;
  const offs: ArmResult[] = [];
  const ons: ArmResult[] = [];
  const verdicts: Verdict[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const armOpts = { seed, tier: opts.tier, compliance: opts.compliance };
    const key = `${shape.id}|${seed}|${opts.tier?.name ?? "-"}|${opts.compliance ?? "-"}`;
    const cached = offCache.get(key);
    const off = cached ?? (await runArm(shape, armConfig(), armOpts));
    if (cached === undefined) offCache.set(key, off);
    const on = await runArm(shape, armConfig(mechanism), armOpts);
    offs.push(off);
    ons.push(on);
    verdicts.push(verdictOf(off, on));
  }
  const wins = verdicts.filter((v) => v === "helps").length;
  const losses = verdicts.filter((v) => v === "hurts").length;
  // One seed is the deterministic tier: a single paired loss is the verdict. Over
  // many seeds a direction needs a sign test (p <= 0.1) so a lone loss is not "hurts".
  const decisive = seeds === 1 || signTestP(wins, losses) <= SIGN_TEST_ALPHA;
  const verdict: Verdict = verdicts.every((v) => v === "inert")
    ? "inert"
    : decisive && wins > losses
      ? "helps"
      : decisive && losses > wins
        ? "hurts"
        : "neutral";
  const offTokens = mean(offs.map((r) => r.requestTokens));
  const onTokens = mean(ons.map((r) => r.requestTokens));
  return {
    shape: shape.id,
    mechanism: mechanism.name,
    verdict,
    seeds,
    wins,
    losses,
    offMeets: mean(offs.map((r) => Number(r.meetsIdeal))),
    onMeets: mean(ons.map((r) => Number(r.meetsIdeal))),
    offTurns: mean(offs.map((r) => r.turns)),
    onTurns: mean(ons.map((r) => r.turns)),
    offTokens,
    onTokens,
    turnsDelta: mean(ons.map((r) => r.turns)) - mean(offs.map((r) => r.turns)),
    tokensDelta: onTokens - offTokens,
    tokensDeltaPct: offTokens === 0 ? 0 : (onTokens - offTokens) / offTokens,
  };
}

/** Shapes x mechanisms, in shape-major order. */
export async function matrix(opts: MatrixOptions): Promise<readonly Cell[]> {
  const cells: Cell[] = [];
  const offCache = new Map<string, ArmResult>();
  for (const shape of opts.shapes) {
    for (const mechanism of opts.mechanisms) cells.push(await runCell(shape, mechanism, opts, offCache));
  }
  return cells;
}

/** One compliance level of a sweep. */
export interface SweepRow {
  readonly compliance: number;
  readonly cell: Cell;
}

/** How a mechanism's verdict moves with compliance. */
export type SweepPattern =
  | "inert"
  | "never-harmful"
  | "harmful-everywhere"
  | "flips-to-helpful"
  | "mixed";

/** A compliance sweep of one shape x mechanism. */
export interface Sweep {
  readonly shape: string;
  readonly mechanism: string;
  readonly rows: readonly SweepRow[];
  readonly pattern: SweepPattern;
  /** Lowest swept compliance at which the verdict is `helps` after `hurts` below it (flips only). */
  readonly flipAt?: number;
}

/** Evenly spaced compliance levels 0..1. */
export const COMPLIANCE_LEVELS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/**
 * Vary the probability the model follows steering from 0 to 1 and report where the
 * mechanism flips from harmful to helpful. Needs a tier (the stochastic layer);
 * results are advisory while the tier is uncalibrated.
 */
export async function sweep(
  shape: Shape,
  mechanism: Mechanism,
  opts: { readonly tier: Tier; readonly seeds?: number; readonly levels?: readonly number[] },
): Promise<Sweep> {
  const rows: SweepRow[] = [];
  for (const compliance of opts.levels ?? COMPLIANCE_LEVELS) {
    rows.push({ compliance, cell: await runCell(shape, mechanism, { seeds: opts.seeds ?? 30, tier: opts.tier, compliance }) });
  }
  const { pattern, flipAt } = classifySweep(rows.map((r) => ({ compliance: r.compliance, verdict: r.cell.verdict })));
  return { shape: shape.id, mechanism: mechanism.name, rows, pattern, ...(flipAt === undefined ? {} : { flipAt }) };
}

/**
 * Pattern of verdicts over ascending compliance. `flips-to-helpful` means a
 * `hurts` level is followed by a `helps` level; `flipAt` is the first such level.
 */
export function classifySweep(
  points: readonly { readonly compliance: number; readonly verdict: Verdict }[],
): { readonly pattern: SweepPattern; readonly flipAt?: number } {
  const verdicts = points.map((p) => p.verdict);
  const hurtIdx = verdicts.indexOf("hurts");
  const flip = points.find((p, i) => hurtIdx !== -1 && i > hurtIdx && p.verdict === "helps");
  if (verdicts.every((v) => v === "inert")) return { pattern: "inert" };
  if (hurtIdx === -1) return { pattern: "never-harmful" };
  if (verdicts.every((v) => v === "hurts")) return { pattern: "harmful-everywhere" };
  return flip === undefined ? { pattern: "mixed" } : { pattern: "flips-to-helpful", flipAt: flip.compliance };
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const pct = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const num = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** Compact table of cells: verdict, ideal-met rates, turn and token deltas. */
export function formatMatrix(cells: readonly Cell[]): string {
  const header = [pad("shape", 26), pad("mechanism", 21), pad("verdict", 8), pad("ideal off>on", 13), pad("turns off>on", 13), pad("tokens off>on", 16), "tok%", "W/L"].join(" ");
  const rows = cells.map((c) =>
    [
      pad(c.shape, 26),
      pad(c.mechanism, 21),
      pad(c.verdict.toUpperCase(), 8),
      pad(`${num(c.offMeets)}>${num(c.onMeets)}`, 13),
      pad(`${num(c.offTurns)}>${num(c.onTurns)}`, 13),
      pad(`${Math.round(c.offTokens)}>${Math.round(c.onTokens)}`, 16),
      pad(pct(c.tokensDeltaPct), 7),
      `${c.wins}/${c.losses}`,
    ].join(" "),
  );
  return [header, ...rows].join("\n");
}

/** Compact table of sweeps: verdict per compliance level, pattern, flip point. */
export function formatSweeps(sweeps: readonly Sweep[]): string {
  return sweeps
    .map((s) => {
      const cols = s.rows.map((r) => `c=${r.compliance}:${r.cell.verdict}`).join("  ");
      const flip = s.flipAt === undefined ? "" : `  (flips at c>=${s.flipAt})`;
      return `${pad(s.shape, 26)} ${pad(s.mechanism, 21)} ${pad(s.pattern, 18)} ${cols}${flip}`;
    })
    .join("\n");
}
