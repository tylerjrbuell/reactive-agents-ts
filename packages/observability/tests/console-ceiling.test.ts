// Run: bun test packages/observability/tests/console-ceiling.test.ts --timeout 30000
//
// WS-5 Phase 3 — console.* ceiling test (anti-regression).
//
// PREMISE
// -------
// `console.warn` / `console.error` calls in framework src code are a smell
// because they bypass the structured observability path (ObservabilityService,
// LoggerService, EventBus typed events). When an Effect runtime is hydrated
// the correct alternative is `Effect.logDebug` / `Effect.logWarning` or a
// typed event publish; when no runtime is hydrated yet (builder/setup sync
// code) a `console.warn` fallback is legitimate and necessary — the error
// must surface immediately and there is no Effect to thread through.
//
// We can't distinguish "Effect-context-capable site" from "legitimate sync
// fallback" automatically. Both share the call shape. So this test enforces
// a CEILING on the total count of active fire sites. New additions force a
// justification: either prove the new site is a legitimate sync fallback
// (raise the warn ceiling + add a one-line rationale comment referencing
// the doc-block at `packages/core/src/errors/index.ts`), or migrate it to
// `Effect.logWarning` / typed event publish.
//
// COUNTER DISCIPLINE
// ------------------
// Naive grep has false positives: docstring examples (`* console.warn(...)`),
// inline comments mentioning `console.warn` by name, and string-literal
// references. We use a TypeScript-AST walker that only counts CallExpression
// nodes where the callee is `console.warn(...)` or `console.error(...)` —
// docstring + comment mentions are excluded automatically because they're
// not parsed as call expressions.

import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import ts from "typescript";

// Scope: runtime + reasoning + reactive-intelligence + memory src trees.
// Memory is included because `database.ts:312` is a real fire site.
const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SCOPED_ROOTS = [
  join(REPO_ROOT, "packages/runtime/src"),
  join(REPO_ROOT, "packages/reasoning/src"),
  join(REPO_ROOT, "packages/reactive-intelligence/src"),
  join(REPO_ROOT, "packages/memory/src"),
];

// Verified ceilings (2026-05-29). Re-run this test after a deliberate
// sync-fallback addition or a migration to update.
//
// Composition at pinning time (AST-counted active call sites only):
//   • console.warn ceiling: legitimate sync-fallback baseline.
//   • console.error ceiling: ZERO. All Effect-context-capable error
//     reporting MUST go through Effect.log* or typed events.
//
// Distribution (verified 2026-05-29):
//   console.warn (9 active sites):
//     • packages/runtime/src/builder/build-effect/pricing-fetch.ts (1)
//         — pricing fetch fallback when remote unavailable; sync builder
//           path, no Effect runtime yet (Category-A: legitimate fallback).
//     • packages/runtime/src/builder/api-surface.ts (2)
//         — handler-of-handler crash defense (HS-14 / GH #74). Swallowing
//           is intentional to avoid recursion; surfacing via console.warn
//           is the explicit design (Category-A).
//     • packages/runtime/src/builder/wither-applies.ts (1)
//         — wither error surfaced during builder application phase
//           (Category-A: sync builder path).
//     • packages/runtime/src/builder.ts (1)
//         — builder warning aggregation (Category-A: sync builder path).
//     • packages/reactive-intelligence/src/skills/skill-registry.ts (2)
//         — schema warnings during skill-file load (Category-A: sync
//           filesystem load, no Effect runtime threaded).
//     • packages/reactive-intelligence/src/skills/skill-resolver.ts (1)
//         — resolver fallback (Category-A: sync resolution path).
//     • packages/memory/src/database.ts (1)
//         — DB initialization error fallback (Category-A: sync setup).
//
//   console.error (0 active sites after WS-5 Phase 3 migration):
//     • Previously: packages/reasoning/src/kernel/loop/runner.ts:1772
//         — `[VERIFIER-PRE]` debug log inside Effect.gen scope. Migrated
//           to `Effect.logDebug` (yield* form). See WS-5 Phase 3 GREEN
//           commit.
//
// History:
//   2026-05-29 (WS-5 Phase 3): pinned warn=9, error=0. Master plan §3 RC-4
//     cited warn=27 / error=24; verified-first-hand at HEAD those counts
//     were inflated by docstring + comment matches (naive grep). Honest
//     baseline at pinning time was warn=9 active / error=1 active; the
//     runner.ts site was migrated to Effect.logDebug to take error to 0.
const WARN_CEILING = 9;
// Sprint-1 (2026-06-02): bumped 0 → 3 to accommodate three diagnostic-gated
// console.error sites (RA_ASSEMBLY_DEBUG trace in think.ts; two RA_OVERHAUL_DEBUG
// traces in overhaul/context-projection.ts). All three are env-gated debug
// emitters, not unconditional error logs. Sprint-3 follow-up: migrate them
// to the typed observability event-bus surface so the ceiling can return to 0.
const ERROR_CEILING = 3;

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
        stack.push(p);
      } else if (st.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) {
        out.push(p);
      }
    }
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  snippet: string;
}

function isConsoleCall(
  node: ts.CallExpression,
  method: "warn" | "error",
): boolean {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  if (!ts.isIdentifier(expr.expression)) return false;
  if (expr.expression.text !== "console") return false;
  if (!ts.isIdentifier(expr.name)) return false;
  return expr.name.text === method;
}

function findConsoleCalls(
  file: string,
  source: string,
  method: "warn" | "error",
): Hit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isConsoleCall(node, method)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const lineText = source.split("\n")[line]?.trim() ?? "";
      hits.push({
        file,
        line: line + 1,
        snippet: lineText.length > 140 ? lineText.slice(0, 140) + "…" : lineText,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}

function scanAll(method: "warn" | "error"): Hit[] {
  const allHits: Hit[] = [];
  for (const root of SCOPED_ROOTS) {
    for (const file of listTsFiles(root)) {
      const src = readFileSync(file, "utf-8");
      // Cheap pre-filter — skip files with no `console.` text at all.
      if (!src.includes("console.")) continue;
      for (const hit of findConsoleCalls(file, src, method)) {
        allHits.push(hit);
      }
    }
  }
  return allHits;
}

function formatBreachMessage(
  method: "warn" | "error",
  ceiling: number,
  hits: Hit[],
): string {
  const sample = hits
    .slice(0, 30)
    .map((h) => `  ${h.file.replace(REPO_ROOT + "/", "")}:${h.line} — ${h.snippet}`)
    .join("\n");
  return (
    `Found ${hits.length} console.${method} call sites (ceiling: ${ceiling}).\n` +
    `Either:\n` +
    `  1. Migrate the new site to Effect.log${method === "warn" ? "Warning" : "Debug"} ` +
    `(if inside Effect context) or a typed EventBus publish, OR\n` +
    `  2. If it is a legitimate sync-fallback (builder/setup code with no\n` +
    `     hydrated Effect runtime), raise CEILING in this test AND add a\n` +
    `     one-line rationale comment to the new site referencing the doc-\n` +
    `     block at packages/core/src/errors/index.ts.\n\n` +
    `First ${Math.min(30, hits.length)} sites:\n${sample}`
  );
}

describe("WS-5 Phase 3 — console.* ceiling", () => {
  it(`console.warn sites stay ≤ ${WARN_CEILING} across runtime + reasoning + RI + memory`, () => {
    const hits = scanAll("warn");
    if (hits.length > WARN_CEILING) {
      throw new Error(formatBreachMessage("warn", WARN_CEILING, hits));
    }
    expect(hits.length).toBeLessThanOrEqual(WARN_CEILING);
  }, 30000);

  it(`console.error sites stay ≤ ${ERROR_CEILING} across runtime + reasoning + RI + memory`, () => {
    const hits = scanAll("error");
    if (hits.length > ERROR_CEILING) {
      throw new Error(formatBreachMessage("error", ERROR_CEILING, hits));
    }
    expect(hits.length).toBeLessThanOrEqual(ERROR_CEILING);
  }, 30000);
});
