// Run: bun test packages/runtime/test/composable-layer-ceiling.test.ts --timeout 30000
//
// WS-5c — ComposableLayer cast-site ceiling test (anti-regression).
//
// PREMISE
// -------
// `ComposableLayer = Layer.Layer<unknown, unknown, unknown>` is the single
// erasure boundary inside `runtime.ts` that prevents the dynamic optional-
// layer union from exploding (~25 conditional layers per runtime build).
// See the doc-block at `packages/runtime/src/runtime.ts:55` for full
// rationale (HS-03 / GH #69 / W25).
//
// Master plan §8.1 (`wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md`)
// fixes the target at "1 in runtime.ts (terminal cast at Layer.mergeAll); = 0
// elsewhere". WS-2 Phase 3 collapsed the merge chain to a single Layer.mergeAll
// and reduced the cast count from ~33 → 6. WS-5c finished the helper-internal
// sweep, taking the count from 6 → 2 (one terminal cast per runtime factory).
//
// WS-5d reaches the §8.1 "= 1" target WITHOUT converging the two factories.
// Instead of re-architecting createLightRuntime through createRuntime (which
// would change hot-path behavior — isolated MetricsCollector, Tier-1 memory),
// both factories now route their terminal Layer.mergeAll(...) result through a
// single `finalizeComposition()` widening helper. The lone `as ComposableLayer`
// lives exactly once, inside that helper; both call sites carry ZERO casts.
//
// CEILING RATIONALE
// -----------------
// Each remaining cast MUST sit at a terminal `Layer.mergeAll(...)` call. Any
// cast inside a helper, before merge, or inside a Layer.effect block is a
// regression — diagnose the variance issue and let the proper Layer.Layer<...>
// type flow through, OR document the narrow cast and leave it for WS-5b sweep.

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const RUNTIME_FILE = join(REPO_ROOT, "packages/runtime/src/runtime.ts");

// Verified ceiling at WS-5d GREEN (2026-05-29):
//   • runtime.ts (~line 80) — the SINGLE `as ComposableLayer` lives inside the
//     `finalizeComposition()` widening helper. Both `createRuntime` and
//     `createLightRuntime` route their terminal `Layer.mergeAll(...)` result
//     through that helper, so each call site carries ZERO casts. §8.1 "= 1" met.
//
// WHY THE HELPER (and not factory convergence)
// --------------------------------------------
// Reaching "= 1" by composing createLightRuntime through createRuntime would
// change hot-path behavior — createLightRuntime intentionally gives the engine
// an isolated MetricsCollector and uses Tier-1 working memory only. The helper
// is a pure generic identity-wrap: it consolidates the type widening without
// touching any layer set, config default, or MetricsCollector wiring.
//
// COUNTER DISCIPLINE
// ------------------
// Naive grep is sufficient here — both cast spellings (`as ComposableLayer`
// and `as unknown as ComposableLayer`) live exclusively in `runtime.ts` and
// the ComposableLayer type alias is declared once at runtime.ts:76. No
// docstring/comment hits because the type only appears in real type
// positions (the call sites and the type alias declaration itself).
const CEILING = 1;

interface Hit {
  line: number;
  snippet: string;
}

function countComposableCasts(file: string): Hit[] {
  const src = readFileSync(file, "utf-8");
  const lines = src.split("\n");
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    // Two spellings:
    //   1. `as ComposableLayer` (used at terminal Layer.mergeAll sites)
    //   2. `as unknown as ComposableLayer` (helper-internal casts WS-5c removes)
    // Exclude the type-alias declaration line itself.
    if (raw.includes("type ComposableLayer =")) continue;
    // Exclude JSDoc / line-comment mentions — the cast spelling appears in
    // the buildToolsLayer docstring at runtime.ts:~106 explaining the WS-5c
    // invariant. Real cast sites live in code positions; comment mentions
    // don't trigger TS semantics and shouldn't count.
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
    if (
      raw.includes("as ComposableLayer") ||
      raw.includes("as unknown as ComposableLayer")
    ) {
      hits.push({
        line: i + 1,
        snippet: trimmed.length > 140 ? trimmed.slice(0, 140) + "…" : trimmed,
      });
    }
  }
  return hits;
}

describe("WS-5d — ComposableLayer cast-site ceiling", () => {
  it(`ComposableLayer casts in runtime.ts stay ≤ ${CEILING}`, () => {
    const hits = countComposableCasts(RUNTIME_FILE);
    if (hits.length > CEILING) {
      const sample = hits
        .map((h) => `  runtime.ts:${h.line} — ${h.snippet}`)
        .join("\n");
      const msg =
        `Found ${hits.length} ComposableLayer cast sites in packages/runtime/src/runtime.ts ` +
        `(ceiling: ${CEILING}).\n` +
        `Each remaining cast MUST sit at a terminal Layer.mergeAll(...) call.\n` +
        `Either:\n` +
        `  1. Move the cast to terminal merge position (let proper Layer.Layer<...> ` +
        `types flow through the helper / intermediate composition), OR\n` +
        `  2. If this is a documented architectural exception, raise CEILING in this\n` +
        `     test AND add a rationale block citing the master plan §8.1 location.\n\n` +
        `Sites:\n${sample}`;
      throw new Error(msg);
    }
    expect(hits.length).toBeLessThanOrEqual(CEILING);
  }, 30000);

  it("ComposableLayer cast spelling 'as unknown as ComposableLayer' is gone from code positions", () => {
    // Anti-regression sanity check: the only acceptable spelling at the
    // ceiling is the clean `) as ComposableLayer;` at a Layer.mergeAll terminus.
    // Helper-internal `as unknown as ComposableLayer` casts (the 4 sites
    // WS-5c removed) must NOT come back in code positions. Comment / docstring
    // mentions are exempt (no TS semantics).
    const src = readFileSync(RUNTIME_FILE, "utf-8");
    const codeLines = src.split("\n").filter((l) => {
      const t = l.trim();
      if (l.includes("type ComposableLayer =")) return false;
      if (t.startsWith("*") || t.startsWith("//")) return false;
      return true;
    });
    const filteredSrc = codeLines.join("\n");
    const helperInternalCount = (
      filteredSrc.match(/as unknown as ComposableLayer/g) ?? []
    ).length;
    expect(helperInternalCount).toBe(0);
  }, 30000);
});
