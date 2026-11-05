// Run: bun test packages/reasoning/tests/kernel/tool-evidence-drift.test.ts --timeout 15000
//
// Drift lock for the run's ONE tool-evidence value (Plan 9 Phase 1 close,
// advisor item 4). Gates read `state.evidence` / `ctx.evidence`, derived from
// the run ledger at transitionState. A gate that scans `steps` for tool
// evidence again sees only the current pass and forgets a seeded earlier pass —
// the defect this lock exists to keep closed. Source scan of reasoning `src/`.
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "../../src");

/** The one module allowed to count successes from steps (it owns the derivations). */
const REQUIREMENT_STATE = "kernel/capabilities/verify/requirement-state.ts";
/** The one strategy-finalize caller allowed the no-ledger fallback (retire with the FinalizeExtras collapse). */
const FINALIZE_RESULT = "kernel/capabilities/sense/finalize-result.ts";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/** `file:line` for each CODE line (comments skipped) matching `pattern`. */
function codeHits(pattern: RegExp, allowed: ReadonlySet<string>): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (allowed.has(rel)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (pattern.test(code)) hits.push(`${rel}:${i + 1}`);
      });
  }
  return hits;
}

describe("tool evidence drift lock — gates read state.evidence, not steps", () => {
  it("no file outside requirement-state.ts counts successful tool calls itself", () => {
    expect(codeHits(/\bbuildSuccessfulToolCallCounts\s*\(/, new Set([REQUIREMENT_STATE]))).toEqual([]);
  });

  it("the steps-scanned substantive check stays deleted", () => {
    expect(codeHits(/\bhasSuccessfulSubstantiveToolCall\b/, new Set())).toEqual([]);
  });

  it("the no-ledger evidence fallback has exactly one caller: strategy finalize", () => {
    expect(
      codeHits(/\btoolEvidenceWithoutLedger\s*\(/, new Set([REQUIREMENT_STATE, FINALIZE_RESULT])),
    ).toEqual([]);
  });

  it("the scanner sees the allowed sites (guards against a vacuous scan)", () => {
    const counters = codeHits(/\bbuildSuccessfulToolCallCounts\s*\(/, new Set());
    expect(counters.length).toBeGreaterThan(0);
    expect(counters.every((hit) => hit.startsWith(`${REQUIREMENT_STATE}:`))).toBe(true);
    const fallbacks = codeHits(/\btoolEvidenceWithoutLedger\s*\(/, new Set([REQUIREMENT_STATE]));
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.startsWith(`${FINALIZE_RESULT}:`)).toBe(true);
  });
});
