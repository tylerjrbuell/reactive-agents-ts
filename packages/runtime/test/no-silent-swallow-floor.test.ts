// Run: bun test packages/runtime/test/no-silent-swallow-floor.test.ts --timeout 30000
//
// WS-5 Phase 2 — Silent-swallow ceiling test (anti-regression).
//
// PREMISE
// -------
// The framework's tagged-error algebra at `packages/core/src/errors/`
// (TransientError / CapacityError / CapabilityError / ContractError /
// TaskError / SecurityError) defines the canonical error channel. New
// code is expected to use these tagged kinds in Effect error positions
// so retry rules, logging, and observability classifiers can pattern-
// match on `_tag`.
//
// `Effect<X, unknown>` (or `Effect.Effect<X, unknown>`) in an error
// channel position can be legitimate or a smell:
//
//   • LEGITIMATE — narrow service-interface shims declared inside a
//     local closure to dodge cross-package error-type coupling. The
//     framework absorbs/translates the error at the boundary. (See
//     `packages/core/src/errors/index.ts` doc-block, "Narrow `unknown`
//     error channels — when intentional".)
//
//   • SMELL — a real Effect production site that catches whatever
//     comes back without translating it to a tagged kind. These are
//     the silent-swallow sites WS-5 Phase 2 is hunting.
//
// We can't distinguish the two automatically — both share the same
// type shape. So this test enforces a CEILING on the total count.
// New additions force a justification: either prove the new site is
// a narrow interface shim, or migrate it to a tagged error.
//
// COUNTER DISCIPLINE
// ------------------
// The naive grep approach has false positives: `Effect.Effect<Layer
// .Layer<unknown, unknown, unknown>, never>` matches because of the
// inner `, unknown>`. We use a TypeScript-AST walker so only the
// top-level error type argument (position 2) of `Effect.Effect<…>`
// or `Effect<…>` is counted, and only when that type argument is the
// exact `unknown` keyword.

import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import ts from "typescript";

// Scope: runtime + reasoning + reactive-intelligence src trees.
// These are the packages with the heaviest Effect surface area.
const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SCOPED_ROOTS = [
  join(REPO_ROOT, "packages/runtime/src"),
  join(REPO_ROOT, "packages/reasoning/src"),
  join(REPO_ROOT, "packages/reactive-intelligence/src"),
];

// Verified ceiling (2026-05-29). Re-run `bun test no-silent-swallow-floor`
// after a deliberate narrow-shim addition or a migration to update.
//
// Composition at pinning time:
//   • 16 Category-A narrow interface shims (intentional)
//   •  2 Category-B parameterized wrappers (`<A, E>` — correct)
//   • Total: 18
//
// Note: this differs from a naive grep count (~25) because the AST
// walker excludes false-positive `Effect<X, Y>` matches where `unknown`
// only appears inside the success channel (e.g., `Record<string, unknown>`
// or `Layer.Layer<unknown, unknown, unknown>`).
const CEILING = 18;

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

function isExactUnknownKeyword(node: ts.TypeNode): boolean {
  // `unknown` keyword in a type position is a KeywordTypeNode with
  // syntaxKind UnknownKeyword. Anything else (e.g., `unknown[]`,
  // `Record<string, unknown>`, `Foo<unknown>`) is NOT a bare unknown.
  return node.kind === ts.SyntaxKind.UnknownKeyword;
}

function isEffectTypeReference(
  node: ts.TypeReferenceNode,
): "Effect" | "Effect.Effect" | null {
  // Match `Effect<…>` or `Effect.Effect<…>` by typeName shape.
  const tn = node.typeName;
  if (ts.isIdentifier(tn) && tn.text === "Effect") return "Effect";
  if (
    ts.isQualifiedName(tn) &&
    ts.isIdentifier(tn.left) &&
    tn.left.text === "Effect" &&
    tn.right.text === "Effect"
  ) {
    return "Effect.Effect";
  }
  return null;
}

function findSilentSwallows(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];

  function visit(node: ts.Node) {
    if (ts.isTypeReferenceNode(node)) {
      const tag = isEffectTypeReference(node);
      if (tag !== null) {
        const args = node.typeArguments;
        // `Effect.Effect<A, E, R>` — error channel is args[1].
        // `Effect<A, E, R>` (alias import) — also args[1].
        if (args && args.length >= 2 && isExactUnknownKeyword(args[1])) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const lineText = source.split("\n")[line]?.trim() ?? "";
          hits.push({
            file,
            line: line + 1,
            snippet: lineText.length > 140 ? lineText.slice(0, 140) + "…" : lineText,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}

describe("WS-5 Phase 2 — silent-swallow ceiling", () => {
  it(`Effect<X, unknown> sites stay ≤ ${CEILING} across runtime + reasoning + RI`, () => {
    const allHits: Hit[] = [];
    for (const root of SCOPED_ROOTS) {
      for (const file of listTsFiles(root)) {
        const src = readFileSync(file, "utf-8");
        // Cheap pre-filter to skip files with no `Effect` references at all.
        if (!src.includes("Effect")) continue;
        for (const hit of findSilentSwallows(file, src)) {
          allHits.push(hit);
        }
      }
    }

    if (allHits.length > CEILING) {
      const sample = allHits
        .slice(0, 30)
        .map((h) => `  ${h.file.replace(REPO_ROOT + "/", "")}:${h.line} — ${h.snippet}`)
        .join("\n");
      const msg =
        `Found ${allHits.length} Effect<X, unknown> sites (ceiling: ${CEILING}).\n` +
        `Either:\n` +
        `  1. Migrate the new site to a tagged FrameworkError subtype, OR\n` +
        `  2. If it is a legitimate narrow-interface shim (cross-package\n` +
        `     coupling avoidance), raise CEILING in this test AND add a one-\n` +
        `     line rationale comment to the new site referencing the doc-\n` +
        `     block at packages/core/src/errors/index.ts.\n\n` +
        `First ${Math.min(30, allHits.length)} sites:\n${sample}`;
      throw new Error(msg);
    }
    expect(allHits.length).toBeLessThanOrEqual(CEILING);
  }, 30000);
});
