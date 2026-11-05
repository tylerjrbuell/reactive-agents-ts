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

  it("the scanner sees the allowed sites (guards against a vacuous scan)", () => {
    const counters = codeHits(/\bbuildSuccessfulToolCallCounts\s*\(/, new Set());
    expect(counters.length).toBeGreaterThan(0);
    expect(counters.every((hit) => hit.startsWith(`${REQUIREMENT_STATE}:`))).toBe(true);
  });
});

/** `file:line` for each line (code AND comments) naming `pattern`. */
function anyHits(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}`);
      });
  }
  return hits;
}

describe("one terminal input — the substrate owns every terminal fact", () => {
  // The strategy terminal mint used to take a bag of optional side channels
  // (requiredTools, runLedger, repairCapabilities, taskId, runContract,
  // strategyDecision) that any strategy could set or forget. They now reach the
  // mint only through StrategyEnd / StrategyRunSpec, as one required
  // StrategyTerminalInput the substrate builds. Every terminal carries a ledger,
  // so the steps-scanned evidence fallback is gone.
  it("the optional side-channel bag is gone (no source file, index included, names it)", () => {
    expect(anyHits(/\bFinalizeExtras\b/)).toEqual([]);
  });

  it("the no-ledger evidence fallback is deleted", () => {
    expect(anyHits(/\btoolEvidenceWithoutLedger\b/)).toEqual([]);
  });

  it("only the substrate builds a StrategyTerminalInput (no strategy file names it)", () => {
    const outsideSubstrate = anyHits(/\bStrategyTerminalInput\b/).filter(
      (hit) => hit.startsWith("strategies/") && !hit.startsWith("strategies/substrate/"),
    );
    expect(outsideSubstrate).toEqual([]);
  });
});
