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
//   • Baseline pre-sweep: 76 (production src + tests under packages/*/src)
//   • Helpers extracted in this tranche:
//       1. asBuilderState (runtime/src/__tests__/_helpers.ts)
//          — collapses 8 builder-state casts in 2 test files → 1
//       2. getOriginalTaggedError / setOriginalTaggedError (runtime/src/errors.ts)
//          — collapses 3 `_originalTaggedError` widenings → 2 (one inside each
//          helper). Caller sites at 276/299/313 lose their inline casts.
//          Net: 3 → 2.
//       3. asToolServiceTag (runtime/src/reactive-agent.ts)
//          — collapses 3 identical ToolService dynamic-import widenings → 1
//       4. asStrategyFn (reasoning/src/services/strategy-registry.ts)
//          — collapses 2 StrategyFn function-variance widenings → 1
//
//   • Total reduction: 76 → 64 (-12, ~16%).
//
// Residual disposition (top sites, in priority order — all LEGITIMATE):
//   • packages/runtime-shim/src/database.ts (4)
//       — Bun/Node Database constructor interop. Dynamic-runtime shim; the
//       cast is the shim's purpose. Out of scope.
//   • packages/runtime/src/builder/build-effect/runtime-construction.ts (1)
//       — baseRuntime → Layer.Layer<unknown, unknown, unknown> widen at the
//       runtime-factory boundary. Documented rationale in source.
//   • packages/runtime/src/builder/build-effect/sub-agent-executor.ts (2)
//       — sub-runtime ToolService import + Layer.Layer<never> widen. Same
//       pattern as reactive-agent.ts but in a separate sub-agent scope; the
//       helper extraction would require a cross-file import that buys back
//       the cleanup. Deferred to a follow-up tranche.
//   • packages/llm-provider/src/providers/anthropic.ts (3)
//       — Anthropic SDK module + content-block narrow widening. SDK types
//       intentionally widen at ingest. Out of scope.
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
//   • Long tail (~17 sites across 14 files at 1 each).
//
// FOLLOW-UPS TO REACH §5.5 "≤40" TARGET
// -------------------------------------
//  (a) Expand `AgentEvent` union with channels events       — collapses 2 sites
//  (b) Extend `LLMConfig` schema with litellm fields        — collapses 2 sites
//  (c) Sub-agent-executor: import + reuse asToolServiceTag  — collapses 1 site
//  (d) Investigate reasoning-think `ReasoningExecuteRequest` shape — owner: reasoning
//  (e) errors.ts site 355 (`Cause.left` narrowing) — use Effect.Cause types — collapses 1
//
// Reaching 40 requires (a)–(e) and ~5 more long-tail extractions; each is its
// own honest piece of work, not a cast sweep. The §5.5 target's "≥50% drop"
// scoring should re-baseline against the helper-concentrated count (64), not
// the pre-sweep raw count.
// RED phase: pinned 1 below current actual (73 after comment-line exclusion)
// to prove the test wires up. GREEN phase will lower to the post-sweep floor.
const CEILING = 72;

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
