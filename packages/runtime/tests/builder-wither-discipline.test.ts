/**
 * WS-2 Phase 3 — builder wither discipline gate (anti-mission #3).
 *
 * Master plan §8.1 + architecture-model §11.2 cap the builder at ≤24
 * methods total ("24 named override methods IS the failure mode").
 * The current `builder.ts` ships 59 withers — 2.4× the ceiling.
 *
 * Phase 3 reduces the EFFECTIVE wither count by marking redundant
 * methods as `@deprecated alias for HarnessProfile.X()` or
 * `@deprecated alias for .compose(...)`. The runtime API surface
 * gets smaller as the capability registry grows; new defaults flow
 * through `HarnessProfile` presets + `CapabilityRegistry`, not new
 * builder methods.
 *
 * Source-of-truth grep counts (mirror Phase 3 §verification protocol):
 *   - `grep -cE "^\\s*public\\s+with[A-Z]|^\\s*with[A-Z].*\\(.*\\):"
 *      packages/runtime/src/builder.ts` ≤ 30 (was 59)
 *   - `grep -c "@deprecated" packages/runtime/src/builder.ts` ≥ 20
 *
 * RED phase: baseline shows 59 withers + 0 @deprecated — test FAILS.
 * GREEN phase: ≥20 redundant withers annotated @deprecated; signature
 *   count drops to ≤30 — test PASSES. Behaviour unchanged (backward
 *   compat: every wither remains callable; deprecation is a JSDoc
 *   marker only).
 *
 * Spec: wiki/Planning/Implementation-Plans/2026-05-28-ws-2-runtime-canonical-seam.md §Phase 3
 * Architecture: wiki/Architecture/Design-Specs/2026-05-28-canonical-architecture-model.md §11.2
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

/**
 * Mirrors the spec's `grep -cE` pattern. Matches public wither
 * signatures (overloads + impl all count, by design — overloads
 * surface in IDE intellisense and inflate the user-facing API).
 */
function countWitherSignatures(src: string): number {
  return src
    .split("\n")
    .filter((line) => /^\s*public\s+with[A-Z]|^\s*with[A-Z].*\(.*\):/.test(line))
    .length;
}

function countDeprecatedTags(src: string): number {
  return (src.match(/@deprecated/g) ?? []).length;
}

describe("builder.ts wither discipline (WS-2 Phase 3)", () => {
  it("publishes ≤30 wither signatures (anti-mission #3 ≤24 ceiling + ~6 overload tolerance)", () => {
    const count = countWitherSignatures(SOURCE);
    expect(count).toBeLessThanOrEqual(30);
  });

  it("annotates ≥20 redundant withers with @deprecated (HarnessProfile / compose aliases)", () => {
    const count = countDeprecatedTags(SOURCE);
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it("preserves backward compatibility — withProfile remains the canonical entry point", () => {
    // withProfile() must NOT be deprecated; it's the master-plan §11.1 primary path.
    const withProfileBlock = SOURCE.slice(
      Math.max(0, SOURCE.indexOf("withProfile(") - 800),
      SOURCE.indexOf("withProfile(") + 200,
    );
    // Strip out any `@deprecated` references that belong to neighbouring
    // method JSDoc blocks by scoping to the immediate withProfile JSDoc.
    const jsdocStart = withProfileBlock.lastIndexOf("/**");
    const jsdocEnd = withProfileBlock.indexOf("*/", jsdocStart);
    const withProfileJsdoc = withProfileBlock.slice(jsdocStart, jsdocEnd);
    expect(withProfileJsdoc).not.toContain("@deprecated");
  });
});
