/**
 * Build params shared by Cortex utility prompts (chat titling, compaction
 * summaries, goal rubric checks). These are single-shot, tool-less text jobs,
 * so they run the one-turn `direct` strategy instead of the full reactive loop
 * (no plan, no stall guards, no strategy switching): 10 of 79 recently traced
 * runs were utility prompts paying for a full kernel run.
 */
export const UTILITY_AGENT_PARAMS = {
  strategy: "direct",
  maxIterations: 1,
} as const;
