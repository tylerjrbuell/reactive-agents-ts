import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Structural GUARD — single-writer of `state.output` (P1 mission 2B).
 *
 * The Deliverable type (core) makes `state.output` settable only through a
 * typed value; `commitDeliverable` (runner-helpers/deliverable.ts) is the kernel
 * single-writer that funnels a Deliverable's content into `transitionState`.
 * `terminate()` (the single-owner TERMINATION helper) composes by delegating its
 * output write to `commitDeliverable` — it does NOT open a parallel output path.
 *
 * This test asserts that across the kernel's termination surface
 * (`kernel/loop/**` + `kernel/capabilities/decide/arbitrator.ts`), the ONLY
 * symbol that passes a NON-NULL `output` field to `transitionState(...)` is
 * `commitDeliverable`. Every other writer must route through it (directly or via
 * `terminate()`), drop the `output` key, or pass `output: null` (a legitimate
 * stale-output clear that the failed/thinking invariant relies on).
 *
 * It FAILS if a new raw output writer is added — the regression net the mission
 * locks in. A demonstration of the fails-when-violated property lives below.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../../src/kernel");

/** Files that constitute the kernel termination surface. */
const SCANNED_FILES = [
  "loop/runner.ts",
  "loop/iterate-pass.ts",
  "loop/terminate.ts",
  "loop/runner-helpers/deliverable.ts",
  "loop/runner-helpers/loop-resolution.ts",
  "loop/runner-helpers/stall-deliverable.ts",
  "capabilities/decide/arbitrator.ts",
] as const;

/** The sole sanctioned non-null output writer. */
const SOLE_WRITER = "commitDeliverable";

/**
 * Extract every `transitionState(` call argument span from a source string.
 * Returns the inner argument text (balanced-paren) per call.
 */
function transitionStateCalls(source: string): string[] {
  const spans: string[] = [];
  const needle = "transitionState(";
  let idx = source.indexOf(needle);
  while (idx !== -1) {
    let depth = 0;
    let i = idx + needle.length - 1; // position at the opening '('
    const start = i + 1;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    spans.push(source.slice(start, i));
    idx = source.indexOf(needle, i);
  }
  return spans;
}

/**
 * Strip string / template-literal contents so a key-like token (e.g. the word
 * "output:" inside an `error: \`...output: ${x}\`` message) is not mistaken for
 * an object key.
 */
function stripStringLiterals(span: string): string {
  return span
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/**
 * True if a transitionState argument span passes a NON-NULL `output` field.
 * `output: null` (stale-output clear) is permitted; `...extraMeta` spreads and
 * the absence of an `output` key are permitted. String-literal contents are
 * stripped first so `output:` appearing inside an error message is ignored.
 */
function writesNonNullOutput(span: string): boolean {
  const cleaned = stripStringLiterals(span);
  // Match an `output:` object key (preceded by `{`, `,`, or whitespace — not a
  // member access `.output:` and not part of a longer identifier).
  const m = cleaned.match(/(^|[{,\s])output\s*:/);
  if (!m) return false;
  const after = cleaned.slice((m.index ?? 0) + m[0].length).trimStart();
  return !after.startsWith("null");
}

function read(file: string): string {
  return readFileSync(resolve(SRC, file), "utf8");
}

describe("single-output-writer guard (P1 2B)", () => {
  it("commitDeliverable is the only non-null output writer across the surface", () => {
    const offenders: string[] = [];
    for (const file of SCANNED_FILES) {
      const source = read(file);
      const isDeliverableFile = file.endsWith("runner-helpers/deliverable.ts");
      for (const span of transitionStateCalls(source)) {
        if (!writesNonNullOutput(span)) continue;
        // The single sanctioned write lives inside commitDeliverable (which is
        // defined in deliverable.ts). Any other span is an offending raw writer.
        if (isDeliverableFile && source.includes(`export function ${SOLE_WRITER}`)) {
          // deliverable.ts is allowed to contain exactly the commitDeliverable
          // writer. Verify the offending span is the commitDeliverable body.
          const commitIdx = source.indexOf(`export function ${SOLE_WRITER}`);
          const spanIdx = source.indexOf(span);
          // commitDeliverable's transitionState must appear AFTER its declaration.
          if (spanIdx > commitIdx) continue;
        }
        offenders.push(`${file}: transitionState({ ... output ... }) outside ${SOLE_WRITER}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("FAILS-WHEN-VIOLATED: a synthetic raw output writer is detected", () => {
    // Demonstration: the same detector applied to a synthetic source containing
    // a raw output writer must flag it — proving the guard is not vacuous.
    const synthetic = `
      function rogue(state) {
        return transitionState(state, { status: "done", output: "leaked-error" });
      }
    `;
    const spans = transitionStateCalls(synthetic);
    expect(spans.length).toBe(1);
    expect(writesNonNullOutput(spans[0]!)).toBe(true);

    // And a permitted clear must NOT flag.
    const permitted = `transitionState(state, { status: "thinking", output: null });`;
    expect(writesNonNullOutput(transitionStateCalls(permitted)[0]!)).toBe(false);
  });
});
