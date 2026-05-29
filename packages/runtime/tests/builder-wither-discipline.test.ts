/**
 * WS-2 Phase 3 — builder wither discipline gate (anti-mission #3).
 *
 * Master plan §8.1 + architecture-model §11.2 cap the **effective**
 * builder surface at ≤24 methods ("24 named override methods IS the
 * failure mode"). Phase 3 keeps every wither callable for backward
 * compatibility — the architecturally honest measure is the
 * non-deprecated surface: signatures NOT annotated `@deprecated` in
 * their JSDoc.
 *
 * Phase 3 marks each redundant wither — whose concern is already
 * served by a `HarnessProfile.{lean,balanced,intelligent}()` preset,
 * a `.compose(...)` chokepoint, the killswitch set (master plan
 * §11.4), or `CapabilityRegistry`-driven defaults — with a JSDoc
 * `@deprecated alias for HarnessProfile.X() / .compose(...)` marker.
 * The runtime API surface gets smaller as the capability registry
 * grows; new defaults flow through presets + registry, not new
 * builder methods.
 *
 * Source-of-truth (counted from `packages/runtime/src/builder.ts`):
 *   - **Effective surface** (non-deprecated wither signatures) ≤ 24
 *     (architecture-model §11.2 ceiling)
 *   - `@deprecated` JSDoc tags ≥ 20 (alias annotations across the
 *     redundant set; spec §verification-protocol Phase 3)
 *
 * RED phase: baseline shows 0 `@deprecated` annotations + ~59 raw
 *   wither signatures, all "effective" — test FAILS on both counts.
 * GREEN phase: ≥20 redundant withers annotated; the effective surface
 *   drops to ≤24 — test PASSES. Behaviour unchanged (backward compat:
 *   every wither remains callable; deprecation is JSDoc + IDE signal
 *   only).
 *
 * Spec deviation note: the implementation-plan §verification-protocol
 * specifies `grep -cE "^\\s*public\\s+with[A-Z]"` ≤ 30. That grep
 * returns 0 against `builder.ts` (no `public` keyword on class methods
 * — TypeScript default visibility), so the literal threshold is
 * trivially satisfied at baseline. This test substitutes the
 * §11.2-intent count (effective non-deprecated surface ≤ 24), which
 * is the metric the anti-mission cares about.
 *
 * Spec: wiki/Planning/Implementation-Plans/2026-05-28-ws-2-runtime-canonical-seam.md §Phase 3
 * Architecture: wiki/Architecture/Design-Specs/2026-05-28-canonical-architecture-model.md §11.1, §11.2
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUILDER_PATH = resolve(
  import.meta.dir,
  "..",
  "src",
  "builder.ts",
);

const SOURCE = readFileSync(BUILDER_PATH, "utf-8");
const LINES = SOURCE.split("\n");

/**
 * True when the line is a wither signature (overload, impl, or
 * single-form). Overloads count too — they surface in IDE
 * intellisense and inflate the user-facing API.
 */
function isWitherSignatureLine(line: string): boolean {
  return /^\s*public\s+with[A-Z]|^\s*with[A-Z].*\(.*\):/.test(line);
}

/**
 * For a wither signature at `lineIdx`, scan backward for the nearest
 * JSDoc block that immediately precedes it. Allows blank lines and
 * sibling overload signatures (so overloads inherit the same JSDoc
 * verdict). Stops at any non-JSDoc / non-blank / non-overload line.
 * Returns the block text or null when there is no preceding JSDoc.
 */
function precedingJsdoc(lineIdx: number): string | null {
  let end = lineIdx - 1;
  // Skip sibling overload signatures sharing the same JSDoc (e.g.
  // `withModel(string): this`, `withModel(params): this`, `withModel(arg) {`).
  while (end >= 0 && isWitherSignatureLine(LINES[end] ?? "")) {
    end--;
  }
  // Skip immediate blank lines.
  while (end >= 0 && (LINES[end] ?? "").trim() === "") {
    end--;
  }
  if (end < 0) return null;
  const closing = (LINES[end] ?? "").trim();
  if (!closing.endsWith("*/")) return null;
  // Walk up to the opening "/**".
  let start = end;
  while (start >= 0 && !(LINES[start] ?? "").trim().startsWith("/**")) {
    start--;
  }
  if (start < 0) return null;
  return LINES.slice(start, end + 1).join("\n");
}

interface WitherClassification {
  readonly lineIdx: number;
  readonly source: string;
  readonly deprecated: boolean;
}

function classifyWithers(): readonly WitherClassification[] {
  const result: WitherClassification[] = [];
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i] ?? "";
    if (!isWitherSignatureLine(line)) continue;
    const jsdoc = precedingJsdoc(i);
    const deprecated = jsdoc !== null && /@deprecated/.test(jsdoc);
    result.push({ lineIdx: i, source: line.trim(), deprecated });
  }
  return result;
}

function countDeprecatedTags(src: string): number {
  return (src.match(/@deprecated/g) ?? []).length;
}

describe("builder.ts wither discipline (WS-2 Phase 3)", () => {
  it("effective surface (non-deprecated withers) ≤ 24 per architecture-model §11.2", () => {
    const all = classifyWithers();
    const effective = all.filter((w) => !w.deprecated);
    if (effective.length > 24) {
      // Diagnostic: surface the offending non-deprecated wither lines
      // so future maintainers can see which methods count against the
      // ceiling.
      const surface = effective
        .map((w) => `  line ${w.lineIdx + 1}: ${w.source}`)
        .join("\n");
      throw new Error(
        `Effective wither surface = ${effective.length} (ceiling ≤ 24).\n` +
          `Non-deprecated wither signatures:\n${surface}`,
      );
    }
    expect(effective.length).toBeLessThanOrEqual(24);
  });

  it("annotates ≥20 redundant withers with @deprecated (HarnessProfile / compose aliases)", () => {
    const count = countDeprecatedTags(SOURCE);
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it("preserves backward compatibility — withProfile remains the canonical entry point (not deprecated)", () => {
    const withers = classifyWithers();
    const withProfile = withers.find((w) => /^\s*withProfile\(/.test(w.source));
    expect(withProfile).toBeDefined();
    expect(withProfile?.deprecated).toBe(false);
  });

  it("preserves backward compatibility — irreducible essentials remain non-deprecated", () => {
    const essentials = [
      "withName",
      "withModel",
      "withProvider",
      "withMemory",
      "withTools",
      "withMaxIterations",
      "withBudget",
      "withTimeout",
    ];
    const withers = classifyWithers();
    for (const name of essentials) {
      const match = withers.find((w) =>
        new RegExp(`^\\s*${name}\\(`).test(w.source),
      );
      expect(match, `${name}() must be present`).toBeDefined();
      expect(
        match?.deprecated,
        `${name}() must NOT be @deprecated (irreducible essential)`,
      ).toBe(false);
    }
  });
});
