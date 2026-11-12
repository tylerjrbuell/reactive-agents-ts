/**
 * Memory explicitly off for utility agents: Cortex turns memory on by default, and a utility
 * agent keyed by its name would otherwise create its own memory folder (a titler and a
 * compactor per model run left tens of thousands of them), recall into its prompt and write
 * its job as an episodic entry. An explicit all-off `memory` builds no memory layer.
 */
export const UTILITY_MEMORY_OFF = { working: false, episodic: false, semantic: false } as const;

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
 *
 * Memory is off ({@link UTILITY_MEMORY_OFF}), so every utility agent built from these params
 * (titler, compactor, goal checker, `/btw`) is memory-less.
 */
export const UTILITY_AGENT_PARAMS = {
  strategy: "direct",
  maxIterations: 1,
  thinking: false,
  memory: UTILITY_MEMORY_OFF,
} as const;

/**
 * Build a utility prompt whose quoted material (transcripts, prior outputs) sits
 * BEFORE the `--- Current message ---` marker and the instruction after it. The
 * model sees both; the kernel compiles its run contract from the current turn
 * only, so a quoted "write notes.txt" can never become a required deliverable.
 */
export function utilityPrompt(quoted: string, instruction: string): string {
  return `--- Conversation history ---\n${quoted}\n\n--- Current message ---\n${instruction}`;
}

/**
 * The text a utility run produced, or `""` when the run did not succeed. A failed
 * run's `output` is empty, a partial draft with an `Unfinished:` list, or the
 * model's own last text, never an answer: used as-is it became the session title,
 * or worse, a compaction summary that replaced real history. Callers treat `""`
 * as "no result".
 */
export function utilityOutput(result: { readonly success: boolean; readonly output?: unknown }): string {
  if (!result.success) return "";
  return typeof result.output === "string" ? result.output : "";
}
