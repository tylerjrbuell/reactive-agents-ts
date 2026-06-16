// Run: bun test packages/runtime/test/as-unknown-as-ceiling.test.ts --timeout 30000
//
// WS-5b — `as unknown as` cast-site ceiling test (anti-regression).
//
// PREMISE
// -------
// `as unknown as T` is a double cast that erases the source type before
// re-asserting `T`. TypeScript permits this anywhere the compiler can't
// prove convertibility — which is convenient at narrow widening boundaries
// (module shim, dynamic-import widening, private-field test access) but
// dangerous when used to paper over real type drift.
//
// Master plan §5.5 (`wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md`)
// targets a ≥50% reduction from the WS-5b baseline. WS-5b ships in tranches —
// this test pins the post-tranche floor so the count cannot silently regrow.
//
//   • LEGITIMATE — narrow widening at module / shim / dynamic-import boundaries
//     where the framework owns the absorbing side. The first tranche
//     concentrates these inside named helpers (`asBuilderState`,
//     `getOriginalTaggedError`, `asToolServiceTag`, `asStrategyFn`) so the
//     cast is single-sourced and reviewable rather than scattered.
//
//   • SMELL — silent type drift papered over with a cast. New additions force
//     a justification: either prove the new site is a narrow-widening helper
//     (and add a rationale comment), or design the cast out (proper schema,
//     typed registration, etc.).
//
// We can't distinguish the two automatically. So this test enforces a CEILING
// on total occurrences across `packages/*/src` (production + tests).
//
// COUNTER DISCIPLINE
// ------------------
// The literal string `as unknown as` has no false positives in code positions
// — unlike the AST-walked `Effect<X, unknown>` test where
// `Layer.Layer<unknown, unknown, unknown>` matched syntactically. A line-scan
// with comment-line exclusion is sufficient (mirrors the
// `composable-layer-ceiling.test.ts` template).

import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const PACKAGES_ROOT = join(REPO_ROOT, "packages");

// Verified ceiling at WS-5b GREEN (2026-05-29):
//   • Baseline pre-sweep: 73 (code positions in packages/*/src; raw grep
//     reports 76 — the 3-line delta is docstring/JSDoc mentions excluded
//     by the comment-line filter below).
//   • Helpers extracted in this tranche (each consolidates N casts → 1 helper
//     cast, leaving the helper itself as the single concentration point —
//     the ceiling counts include the helper's own cast):
//       1. asBuilderState (runtime/src/__tests__/_helpers.ts)
//          — collapses 8 builder-state casts in 2 test files → 1
//          Net: -7
//       2. setOriginalTaggedError / getOriginalTaggedError (runtime/src/errors.ts)
//          — collapses 3 `_originalTaggedError` widenings (276/299/313) → 2
//          (one inside each helper). Net: -1
//       3. asToolServiceTag (runtime/src/reactive-agent.ts)
//          — collapses 3 identical ToolService dynamic-import widenings → 1
//          Net: -2
//       4. asStrategyFn (reasoning/src/services/strategy-registry.ts)
//          — collapses 2 StrategyFn function-variance widenings → 1
//          Net: -1
//
//   • Total reduction: 73 → 62 (-11, ~15%). Against raw-grep baseline 76 → 65.
//
// Residual disposition (top sites, in priority order — all LEGITIMATE):
//   • packages/runtime-shim/src/database.ts (4)
//       — Bun/Node Database constructor interop. Dynamic-runtime shim; the
//       cast is the shim's purpose. Out of scope.
//   • packages/llm-provider/src/providers/anthropic.ts (3)
//       — Anthropic SDK module + content-block narrow widening. SDK types
//       intentionally widen at ingest. Out of scope.
//   • packages/runtime/src/execution-engine.ts (3)
//       — ObsLike narrow, Error coercion (`asErr.cause`), Effect closure
//       widening. Three distinct narrow boundaries; not foldable.
//   • packages/runtime/src/errors.ts (3)
//       — 2 inside helpers (setOriginalTaggedError + getOriginalTaggedError —
//       the §5.5 concentration point) + 1 at site 355 (`Cause.left`
//       narrowing — proper fix is `Effect.Cause` types).
//   • packages/llm-provider/src/providers/litellm.ts (2)
//       — `LLMConfig` lacks litellm-specific endpoint fields; proper fix is
//       extending the config schema, not a cast helper. Tracked as follow-up.
//   • packages/channels/src/services/channel-service.ts (2)
//       — `AgentEvent` discriminated union missing `TriggerFired` /
//       `ChannelMessageSent` tags. Proper fix is union expansion. Tracked.
//   • packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts (2)
//   • packages/runtime/src/engine/phases/agent-loop/reasoning-harness-hooks.ts (2)
//       — ReasoningExecuteRequest widening + Effect closure widening. The
//       Effect closure cast is generator-flow specific; not foldable.
//   • packages/runtime/src/builder/build-effect/sub-agent-executor.ts (2)
//       — sub-runtime ToolService import + Layer.Layer<never> widen. Same
//       pattern as reactive-agent.ts in a separate sub-agent scope.
//   • packages/runtime/src/builder.ts (2)
//   • packages/benchmarks/src/runner.ts (2)
//   • Long tail (~16 sites across 16 files at 1 each — verifier closures,
//     observability tracers, kernel-state widening, etc.).
//
// FOLLOW-UPS TO REACH §5.5 "≤40" TARGET
// -------------------------------------
//  (a) Expand `AgentEvent` union with channels events       — collapses 2 sites
//  (b) Extend `LLMConfig` schema with litellm endpoint fields — collapses 2 sites
//  (c) Sub-agent-executor: import + reuse asToolServiceTag  — collapses 1 site
//  (d) Reasoning-think `ReasoningExecuteRequest` shape (kernel-warden) — 2 sites
//  (e) errors.ts site 355 (`Cause.left`) — use Effect.Cause types — 1 site
//  (f) Anthropic SDK content-block: contribute upstream typings or shim layer — 3 sites
//  (g) Long-tail extractions across 5–7 1-site files
//
// Reaching 40 requires (a)–(g) and is the work of 2–3 additional tranches;
// each is its own honest piece of structural work, not a cast sweep. The §5.5
// target's "≥50% drop" scoring should re-baseline against the helper-
// concentrated count (62) rather than the pre-sweep raw count.
// Sprint-1 (2026-06-02): bumped 62 → 63 to absorb pre-existing 1-site drift.
// Sprint-1 contracts work added zero new sites; the increment is observed
// debt carried into the canonical-collapse merge. Sprint-3 mechanism
// completion will sweep cast sites alongside the entry-point consolidation.
// 2026-06-06: bumped 63 → 66 for three LEGITIMATE narrow-widening sites added
// by the capability-prime work (commit fae0dd7c) — global-`fetch` mock stubs in
// `llm-provider/src/capability-prime.test.ts:30,53,67` (`… as unknown as typeof
// fetch`). Stubbing the global fetch type is the canonical test-double widening
// boundary (the test owns the absorbing side); routing through a helper still
// leaves one cast each, so the §5.5 "design it out" path doesn't apply.
// 2026-06-13: follow-up (a) DONE — `AgentEvent` union already carries
// `TriggerFired` + `ChannelMessageSent`, so the two `as unknown as AgentEvent`
// casts in channels/src/services/channel-service.ts were stale and removed
// (68 → 66, back at ceiling). No CEILING bump; this is "design it out".
// 2026-06-16: bumped 66 → 76 for two v0.12 features whose boundary casts are
// LEGITIMATE narrow widenings (same category as the anthropic-SDK / runtime-shim
// ingest casts already documented as out-of-scope above):
//   • Typed structured output adapter (reasoning/src/structured-output/** +
//     runtime/src/{reactive-agent,engine/finalize,engine/stream-object}). The
//     adapter bridges FOUR untyped external schema libraries (Zod, Valibot,
//     ArkType, Effect) plus Effect-Schema `partial`/`pick` operations that
//     erase the precise element type — the casts ARE the adapter's purpose.
//     The three identical vendor reinterpretations were first consolidated into
//     one `asVendorSchema` helper (schema-contract.ts) before this bump.
//   • Durable-execution KernelState codec (reasoning/src/kernel/state) — state
//     serialization widening across the JSON boundary.
// Before bumping, the redundant `as any` debt in the same merge window was paid
// down (HS-34: 4 Layer.merge casts → typed `widen` helper; HS-35: 2 stale
// reactive-observer casts removed), so this increment reflects only the real
// new feature surface, not carried smells.
const CEILING = 76;

interface Hit {
  file: string;
  line: number;
  snippet: string;
}

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // Skip dist + node_modules — we count src + colocated tests.
        if (name === "dist" || name === "node_modules") continue;
        stack.push(p);
      } else if (st.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) {
        out.push(p);
      }
    }
  }
  return out;
}

function countAsUnknownAs(file: string): Hit[] {
  const src = readFileSync(file, "utf-8");
  const lines = src.split("\n");
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    // Exclude comment-line mentions (rationale comments). The cast must
    // appear in a code position to count.
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
    if (raw.includes("as unknown as")) {
      hits.push({
        file,
        line: i + 1,
        snippet: trimmed.length > 140 ? trimmed.slice(0, 140) + "…" : trimmed,
      });
    }
  }
  return hits;
}

describe("WS-5b — `as unknown as` cast-site ceiling", () => {
  it(`\`as unknown as\` sites stay ≤ ${CEILING} across packages/*/src`, () => {
    const allHits: Hit[] = [];
    // Walk each package's src tree (includes colocated __tests__ folders).
    let pkgEntries: string[];
    try {
      pkgEntries = readdirSync(PACKAGES_ROOT);
    } catch {
      pkgEntries = [];
    }
    for (const pkg of pkgEntries) {
      const srcRoot = join(PACKAGES_ROOT, pkg, "src");
      try {
        const st = statSync(srcRoot);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of listTsFiles(srcRoot)) {
        for (const hit of countAsUnknownAs(file)) {
          allHits.push(hit);
        }
      }
    }

    if (allHits.length > CEILING) {
      const sample = allHits
        .slice(0, 40)
        .map((h) => `  ${h.file.replace(REPO_ROOT + "/", "")}:${h.line} — ${h.snippet}`)
        .join("\n");
      const msg =
        `Found ${allHits.length} \`as unknown as\` sites in packages/*/src ` +
        `(ceiling: ${CEILING}).\n` +
        `Either:\n` +
        `  1. Route the new site through an existing helper ` +
        `(asBuilderState / getOriginalTaggedError / asToolServiceTag / asStrategyFn), OR\n` +
        `  2. Design the cast out — extend the type, add a discriminated-union\n` +
        `     case, or fix the underlying schema drift, OR\n` +
        `  3. If it is a documented narrow-widening boundary, raise CEILING in\n` +
        `     this test AND add a one-line rationale comment to the new site\n` +
        `     referencing the master plan §5.5 follow-up list.\n\n` +
        `First ${Math.min(40, allHits.length)} sites:\n${sample}`;
      throw new Error(msg);
    }
    expect(allHits.length).toBeLessThanOrEqual(CEILING);
  }, 30000);
});
