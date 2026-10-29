/**
 * skills/arg-healing.ts — shared, pure argument-healing helpers for meta-tools.
 *
 * Convention ("healing built into tool design"): models of varying capability
 * drift on enum-like values and parameter names. Handlers heal the drift with
 * CLOSED alias tables (never fuzzy-widening a value into one the tool did not
 * list), report what was healed so callers can surface it (`healedFrom`), and
 * leave the tool definition as the single source of truth for the canonical form.
 */

/** Result of healing one value: the (possibly rewritten) value plus the raw input iff rewritten. */
export interface HealedValue {
  readonly value: string;
  readonly healedFrom?: string;
}

/**
 * Heal an enum-like string. Case/whitespace tolerant; exact canonical values
 * pass through unmarked; closed `aliases` rewrite to canonical; anything else
 * passes through unchanged (the caller decides how to reject it).
 */
export function healEnumArg(
  raw: string,
  canonical: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): HealedValue {
  if (canonical.includes(raw)) return { value: raw };
  const key = raw.trim().toLowerCase();
  const direct = canonical.find((c) => c.toLowerCase() === key);
  if (direct !== undefined) return { value: direct, healedFrom: raw };
  if (Object.prototype.hasOwnProperty.call(aliases, key)) {
    return { value: aliases[key] as string, healedFrom: raw };
  }
  return { value: raw };
}

/** Result of renaming drifted parameter names to canonical ones. */
export interface HealedParams {
  readonly args: Record<string, unknown>;
  /** `alias->canonical` entries for each rename applied. */
  readonly healed: readonly string[];
}

/**
 * Rename drifted parameter names. `aliases` maps canonical name -> accepted
 * alternates (checked in order). A canonical key that is already present wins;
 * alternates are never merged into it. Input is not mutated.
 */
export function healParamNames(
  args: Readonly<Record<string, unknown>>,
  aliases: Readonly<Record<string, readonly string[]>>,
): HealedParams {
  const out: Record<string, unknown> = { ...args };
  const healed: string[] = [];
  for (const [canonical, alternates] of Object.entries(aliases)) {
    if (out[canonical] != null) continue;
    for (const alt of alternates) {
      if (out[alt] != null) {
        out[canonical] = out[alt];
        healed.push(`${alt}->${canonical}`);
        break;
      }
    }
  }
  return { args: out, healed };
}

/** Levenshtein distance (small inputs only: action / enum names). */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number;
      prev[j] = Math.min(up + 1, (prev[j - 1] as number) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] as number;
}

/** Closest valid value to `raw` (prefix/substring first, then edit distance); never undefined for a non-empty `valid`. */
export function closestValid(raw: string, valid: readonly string[]): string {
  const key = raw.trim().toLowerCase();
  const sub = valid.find((v) => key.length > 0 && (v.startsWith(key) || key.startsWith(v) || key.includes(v)));
  if (sub !== undefined) return sub;
  let best = valid[0] as string;
  let bestD = Infinity;
  for (const v of valid) {
    const d = editDistance(key, v);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}
