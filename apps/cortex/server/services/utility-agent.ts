/**
 * Build params shared by Cortex utility prompts (chat titling, compaction
 * summaries, goal rubric checks). These are single-shot, tool-less text jobs,
 * so they run the one-turn `direct` strategy instead of the full reactive loop
 * (no plan, no stall guards, no strategy switching): 10 of 79 recently traced
 * runs were utility prompts paying for a full kernel run.
 *
 * Thinking is off: on qwen3.5 (thinking auto) a title took 17s and 1.7k tokens
 * with thinking vs 0.4s and 190 tokens without, same title; one titling run
 * spent its whole budget thinking and failed.
 */
export const UTILITY_AGENT_PARAMS = {
  strategy: "direct",
  maxIterations: 1,
  thinking: false,
} as const;

/**
 * The text a utility run produced, or `""` when the run did not succeed. A failed
 * run's `output` is the harness failure notice ("Could not complete the task…"),
 * not an answer: used as-is it became the session title, or worse, a compaction
 * summary that replaced real history. Callers treat `""` as "no result".
 */
export function utilityOutput(result: { readonly success: boolean; readonly output?: unknown }): string {
  if (!result.success) return "";
  return typeof result.output === "string" ? result.output : "";
}
