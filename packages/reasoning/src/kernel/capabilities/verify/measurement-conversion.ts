/**
 * Verify capability — a measurement the answer DERIVED from tool values
 * (ablation 2026-11-10, wiki/Research/Ablations/2026-11-10-stable-tool-list-ablation.md).
 *
 * The fabrication guard (`detectFabricatedMeasurement`) grounds a claimed
 * measurement by magnitude against the tool corpus. A correct unit conversion
 * of a tool value has a different magnitude, so it was rejected: a tool
 * reported `totaltime: 611400` (seconds) and the answers "10,190 minutes" and
 * "169.8 hours" failed every mimo@8k umami run. Some conversions were wrong
 * ("167 hours", "172 hours"), and those must still be caught.
 *
 * The rule: a claim is derived when a conversion of an observed value equals it
 * within the ROUNDING the claim prints (half a unit of its last digit: 169.8
 * allows ±0.05, 170 allows ±0.5; a whole unit when hedged, "~118"). No
 * relative slack, so a wrong conversion stays a violation.
 *
 *   - one value:  a time unit conversion (ns..weeks, into the claim's unit), a
 *                 fraction as a percent, a size-rate (KB/MB/GB, 1000 or 1024)
 *                 or per-minute/per-hour rate conversion.
 *   - two values: a time rate (a value the answer prints with a time unit,
 *                 over a count, into the claim's unit), a ratio a/b, and a
 *                 percent a/b or percent change. Both operands must be values
 *                 the answer itself reports AND a tool produced, so an
 *                 invented number cannot be passed off as some ratio of
 *                 unrelated corpus numbers.
 *
 * Pure, deterministic, no LLM.
 */

/** Which conversions can derive a claim. */
export type MeasurementKind =
  | { readonly tag: "time"; readonly seconds: number }
  | { readonly tag: "percent" }
  | { readonly tag: "size-rate" }
  | { readonly tag: "op-rate" }
  | { readonly tag: "speedup" }
  | { readonly tag: "other" };

/** The parts of a scraped claim the conversion check reads. */
export interface ConvertibleClaim {
  readonly value: number;
  /** The number as printed, e.g. `"169.8"` or `"10,190"`. */
  readonly raw: string;
  readonly kind: MeasurementKind;
  /** Printed with a hedge (`~`, `≈`, "about", "roughly", "approx."): see {@link roundingTolerance}. */
  readonly hedged?: boolean;
}

/**
 * A value the answer prints with a time unit AND a tool produced (e.g.
 * "611,400 s"). Only such a value may be the numerator of a time rate.
 */
export interface TimeOperand {
  readonly value: number;
  /** Seconds in the unit the answer printed it in. */
  readonly seconds: number;
}

/** Seconds per time unit, every unit a source value may be in. */
const SOURCE_UNIT_SECONDS: readonly number[] = [1e-9, 1e-6, 1e-3, 1, 60, 3600, 86_400, 604_800];

/**
 * Seconds in one claimed time unit (the unit text a timing pattern matched).
 * Short forms count: `s`, `sec`, `min`, `h`, `hr`, `hrs`, `d`.
 */
export function timeUnitSeconds(unit: string): number | undefined {
  const u = unit.toLowerCase();
  if (u === "ns" || u.startsWith("nanosecond")) return 1e-9;
  if (u === "µs" || u === "us" || u.startsWith("microsecond")) return 1e-6;
  if (u === "ms" || u.startsWith("millisecond")) return 1e-3;
  if (u === "s" || u.startsWith("sec") || u.startsWith("second")) return 1;
  if (u.startsWith("min")) return 60;
  if (u === "h" || u === "hr" || u === "hrs" || u.startsWith("hour")) return 3600;
  if (u === "d" || u.startsWith("day")) return 86_400;
  if (u.startsWith("week")) return 604_800;
  return undefined;
}

/** A hedge printed right before a number: `~`, `≈`, "about", "roughly", "approx.", "around". */
const HEDGE_BEFORE_RE = /(?:~|≈|\babout|\broughly|\bapprox(?:\.|imately)?|\baround)\s*$/i;

/** True when `before` (the text just ahead of a number) ends in a hedge. */
export function endsInHedge(before: string): boolean {
  return HEDGE_BEFORE_RE.test(before);
}

/** The kind of a throughput claim from the unit text it matched. */
export function throughputKind(unit: string): MeasurementKind {
  const u = unit.toLowerCase();
  if (/^[kmg]b\/s$/.test(u)) return { tag: "size-rate" };
  if (u.startsWith("x")) return { tag: "speedup" };
  return { tag: "op-rate" };
}

const SIZE_FACTORS: readonly number[] = [1e3, 1e6, 1e9, 1024, 1_048_576, 1_073_741_824];
const OP_RATE_FACTORS: readonly number[] = [60, 3600];

/** Both directions of each factor. */
const bothWays = (factors: readonly number[]): readonly number[] => factors.flatMap((f) => [f, 1 / f]);

/** Factors that turn ONE observed value into the claim's unit. */
function unaryFactors(kind: MeasurementKind): readonly number[] {
  switch (kind.tag) {
    case "time":
      return SOURCE_UNIT_SECONDS.filter((s) => s !== kind.seconds).map((s) => s / kind.seconds);
    case "percent":
      return [100];
    case "size-rate":
      return bothWays(SIZE_FACTORS);
    case "op-rate":
      return bothWays(OP_RATE_FACTORS);
    default:
      return [];
  }
}

/**
 * Candidate values two observed values derive for a non-time claim. A time
 * claim derives only from a {@link TimeOperand} numerator (see
 * {@link isDerivedMeasurement}).
 */
function binaryCandidates(kind: MeasurementKind, a: number, b: number): readonly number[] {
  if (b === 0) return [];
  const ratio = a / b;
  switch (kind.tag) {
    case "percent":
      return [ratio * 100, ((a - b) / b) * 100, ((b - a) / b) * 100];
    case "speedup":
    case "op-rate":
    case "size-rate":
      return [ratio];
    default:
      return [];
  }
}

/**
 * The rounding a correct conversion may differ by: half a unit of the claim's
 * last printed digit, or a whole unit for a hedged rate (`hedged`: "~118
 * seconds" per visit for 117.4 is an honest approximation; "~172 hours" for
 * 169.8 is not).
 */
export function roundingTolerance(raw: string, hedged = false): number {
  const decimals = raw.split(".")[1]?.length ?? 0;
  return (hedged ? 1 : 0.5) * 10 ** -decimals + 1e-9;
}

/**
 * True when `claim` is a correct conversion of observed values: one corpus
 * value converted, or two `cited` values (reported in the answer and produced
 * by a tool) combined, equal to the claim within its printed rounding.
 *
 * A time claim's two-value form is a rate: a `timeOperands` value (printed
 * with a time unit) over any other cited value, converted into the claim's
 * unit. Why (audit 2026-11-10): with every cited pair and every unit factor
 * allowed, chance matches grounded wrong conversions. "~172 hours" passed as
 * 690 / 4, and as 2025 / 1980 x 168 (a year over a count, times hours per week).
 *
 * A hedge widens the tolerance for a time rate only. A rate is a quotient the
 * answer rounds; a one-value conversion has no such excuse, and widening it
 * let "≈167 hours" match 1 week (168 hours) off a stray "1" in the corpus.
 */
export function isDerivedMeasurement(
  claim: ConvertibleClaim,
  corpus: ReadonlySet<number>,
  cited: readonly number[],
  timeOperands: readonly TimeOperand[] = [],
): boolean {
  const within = (tolerance: number) => (v: number): boolean =>
    Number.isFinite(v) && Math.abs(v - claim.value) <= tolerance;
  const near = within(roundingTolerance(claim.raw));
  const factors = unaryFactors(claim.kind);
  for (const e of corpus) {
    for (const f of factors) if (near(e * f)) return true;
  }
  if (claim.kind.tag === "time") {
    const claimSeconds = claim.kind.seconds;
    const nearRate = within(roundingTolerance(claim.raw, claim.hedged === true));
    for (const a of timeOperands) {
      for (const b of cited) {
        if (b === 0 || b === a.value) continue;
        if (nearRate((a.value * a.seconds) / b / claimSeconds)) return true;
      }
    }
    return false;
  }
  for (const a of cited) {
    for (const b of cited) {
      if (a === b) continue;
      for (const v of binaryCandidates(claim.kind, a, b)) if (near(v)) return true;
    }
  }
  return false;
}
