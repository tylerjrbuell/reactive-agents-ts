/**
 * scaffold-leak.ts — Always-on correctness guard. Detects when the model
 * emitted framework-internal scaffolding ([STORED:], _tool_result_N,
 * "compressed preview", schema dumps) AS its final answer instead of
 * synthesizing real content. This is always wrong regardless of grounding,
 * and the patterns have ~zero false-positive rate. Extracted from the former
 * evidence-grounding `COMPRESSION_MARKER_PATTERNS`.
 *
 * Pure — no Effect, no state.
 */

const SCAFFOLD_LEAK_PATTERNS: readonly RegExp[] = [
  /\[recall result\b/i,
  /\bcompressed preview\b/i,
  /^Type:\s*(Array|Object)\(/m,
  /^Schema:\s/m,
  /\b_tool_result_\d+\b/i,
  /— full text is stored\b/i,
  /\[STORED:\s*_tool_result_/i,
];

export interface ScaffoldLeakResult {
  readonly leaked: boolean;
  readonly reason: string;
}

/** Returns leaked=true when the output echoes framework internal scaffolding. */
export function detectScaffoldLeak(output: string): ScaffoldLeakResult {
  const leaked = SCAFFOLD_LEAK_PATTERNS.some((re) => re.test(output));
  return {
    leaked,
    reason: leaked
      ? "output contains framework scaffolding markers (e.g., [STORED:], _tool_result_N, compressed preview) — the model echoed internal scaffolding instead of synthesizing an answer"
      : "no scaffolding markers",
  };
}
