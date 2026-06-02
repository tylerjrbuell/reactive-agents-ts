import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * WS-3 Phase 4c — transitionState() discipline gate
 *
 * Master plan §3.6 F10 + Mission Pillar 4:
 *   "≤10 mutation sites total across the kernel. state.status = outside
 *    transitionState() helper = lint failure."
 *
 * This test pins TWO load-bearing invariants structurally:
 *
 *   1. Raw `state.{status,terminatedBy,error} = X` assignment sites outside the
 *      two canonical owners (`kernel-state.ts` + `terminate.ts`) MUST be ≤ 10.
 *
 *   2. The ESLint rule `NO_DIRECT_STATE_MUTATION` MUST be at severity `"error"`,
 *      not `"warn"`. Once Sprint 3.3 retrofitted the historical 27 raw sites
 *      down to zero (verified empirically 2026-05-29), the severity flip is the
 *      structural lock-in that prevents regression.
 *
 * Empirical baseline at gate creation (2026-05-29):
 *   - raw sites = 0 (well under the ≤10 ceiling)
 *   - ESLint severity = "warn" → THIS is the RED that flips to GREEN by editing
 *     eslint.config.mjs lines 119 and 140.
 *
 * Sites the canonical owners (kernel-state.ts + terminate.ts) deliberately
 * mutate are EXCLUDED from the count by construction.
 */

const repoRoot = join(import.meta.dir, "..", "..", "..");
const kernelDir = join(repoRoot, "packages/reasoning/src/kernel");
const eslintConfigPath = join(repoRoot, "eslint.config.mjs");

const CANONICAL_MUTATION_FILES = new Set([
  "packages/reasoning/src/kernel/state/kernel-state.ts",
  "packages/reasoning/src/kernel/loop/terminate.ts",
]);

// Match an assignment to .status / .terminatedBy / .error where the right-hand
// side starts with something OTHER than `=` (to skip equality comparisons).
// Anchors on `.` to skip object-literal property declarations like `status: ...`.
const PROTECTED_ASSIGNMENT_RE =
  /\.(status|terminatedBy|error)\s*=\s*[^=]/;

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      yield* walkTs(abs);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      yield abs;
    }
  }
}

function countRawProtectedAssignments(): {
  total: number;
  hits: Array<{ file: string; line: number; text: string }>;
} {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const abs of walkTs(kernelDir)) {
    const rel = relative(repoRoot, abs).replace(/\\/g, "/");
    if (CANONICAL_MUTATION_FILES.has(rel)) continue;
    if (rel.includes("/test") || rel.includes(".test.")) continue;
    const lines = readFileSync(abs, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      // Skip line + block-style comments and JSDoc.
      if (trimmed.startsWith("//")) continue;
      if (trimmed.startsWith("*")) continue;
      if (trimmed.startsWith("/*")) continue;
      if (!PROTECTED_ASSIGNMENT_RE.test(line)) continue;
      hits.push({ file: rel, line: i + 1, text: line.trim() });
    }
  }
  return { total: hits.length, hits };
}

describe("WS-3 Phase 4c — transitionState() discipline (master plan §3.6 F10)", () => {
  it("raw `state.{status,terminatedBy,error} = ` assignments outside canonical owners are ≤ 10", () => {
    const { total, hits } = countRawProtectedAssignments();
    if (total > 10) {
      console.error(
        `\n  Raw protected-field assignments (${total}) exceeds ceiling (10):\n` +
          hits
            .map((h) => `    ${h.file}:${h.line}  ${h.text}`)
            .join("\n") +
          "\n\n  Route these through transitionState(state, patch) from " +
          "packages/reasoning/src/kernel/state/kernel-state.ts.\n",
      );
    }
    expect(total).toBeLessThanOrEqual(10);
  });

  it("ESLint rule NO_DIRECT_STATE_MUTATION is enforced at severity 'error'", () => {
    const config = readFileSync(eslintConfigPath, "utf8");

    // We assert structurally: every `no-restricted-syntax` rule line that
    // references NO_DIRECT_STATE_MUTATION must use `"error"`, not `"warn"`.
    // The canonical "off" override for kernel-state.ts + terminate.ts is fine.
    const lines = config.split("\n");
    const ruleLines = lines
      .map((line, idx) => ({ line, idx: idx + 1 }))
      .filter(
        ({ line }) =>
          line.includes("no-restricted-syntax") &&
          line.includes("NO_DIRECT_STATE_MUTATION"),
      );

    expect(ruleLines.length).toBeGreaterThan(0);

    const offenders = ruleLines.filter(({ line }) => /"warn"/.test(line));
    if (offenders.length > 0) {
      console.error(
        "\n  NO_DIRECT_STATE_MUTATION still at 'warn' severity at:\n" +
          offenders.map((o) => `    eslint.config.mjs:${o.idx}  ${o.line.trim()}`).join("\n") +
          "\n\n  Flip these to 'error' to lock in transitionState() discipline.\n",
      );
    }
    expect(offenders).toEqual([]);
  });
});
