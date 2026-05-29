// Run: bun test packages/runtime/test/builder-loc-ceiling.test.ts --timeout 10000
//
// WS-6 Phase 1 — builder.ts LOC ceiling (anti-regression).
//
// PREMISE
// -------
// `packages/runtime/src/builder.ts` is the public fluent builder surface. Each
// of its ~75 wither methods carries load-bearing JSDoc (the migration / API
// documentation the package ships). The JSDoc IS the API surface; the wither
// signatures + JSDoc must remain in `builder.ts`. What CAN move is the wither
// body — the `_field = value` mutation block.
//
// WS-6 Phase 1 bucket-extracts wither BODIES (only the heavy ones, ≥4 lines)
// into `packages/runtime/src/builder/withers/<domain>.ts` modules following
// the pre-existing `applyMemoryOptions(builder, opts)` shape established in
// `builder/wither-applies.ts`. Each method becomes a one-line delegation:
//
//     withX(opts): this { applyX(this, opts); return this }
//
// This ceiling protects the LOC reduction so future edits don't silently
// re-inline withers and re-monolithize `builder.ts`.
//
// CEILING DERIVATION
// ------------------
// Pre-Phase-1 baseline: 2193 LOC (967 code + 1093 JSDoc + 133 blank).
// JSDoc dominates because @deprecated migration notes are LOAD-BEARING for
// every wither — they document the canonical compose / profile replacement.
//
// Target: 2050 LOC (≈ -143 LOC; aligns with high-yield wither bodies summing
// to ~150 LOC of mutation logic). The original "1500 LOC" sketch was rejected
// as not measurable against code-LOC once JSDoc is properly accounted for.
//
// Headroom is intentionally thin (~7 LOC) so post-Phase-1 drift triggers this
// ceiling before it accumulates. If a legitimate wither needs to grow back,
// raise CEILING in this file AND rationale-comment the new addition.

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const BUILDER_PATH = resolve(
  REPO_ROOT,
  "packages/runtime/src/builder.ts",
);

const CEILING = 2050;

describe("WS-6 Phase 1 — builder.ts LOC ceiling", () => {
  it(`builder.ts stays ≤ ${CEILING} LOC after wither-body extraction`, () => {
    const src = readFileSync(BUILDER_PATH, "utf-8");
    // Count lines the same way `wc -l` does — trailing newline notwithstanding,
    // the `split("\n").length - 1` of a file that ends in "\n" equals the
    // `wc -l` count for that file.
    const trimmed = src.endsWith("\n") ? src.slice(0, -1) : src;
    const lines = trimmed.split("\n").length;

    if (lines > CEILING) {
      throw new Error(
        `builder.ts is ${lines} LOC (ceiling: ${CEILING}).\n` +
          `Either:\n` +
          `  1. Bucket-extract additional wither bodies to ` +
          `builder/withers/<domain>.ts following the applyMemoryOptions pattern, OR\n` +
          `  2. If the addition is a legitimate new public API surface ` +
          `(new wither + JSDoc), raise CEILING in this test and add a ` +
          `rationale comment referencing the WS-6 follow-up plan.`,
      );
    }
    expect(lines).toBeLessThanOrEqual(CEILING);
  });
});
