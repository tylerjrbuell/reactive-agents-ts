/**
 * strategies/planning/shared-personas.ts — single source for the persona
 * strings duplicated across plan-family strategies (Phase 1b, 2026-07-07).
 *
 * Sweep report 04 (F3): the synthesizer persona was verbatim-duplicated in
 * plan-execute and blueprint, and the planner persona near-duplicated — with
 * drift already observed (blueprint's synthesis prompt lacked the EVIDENCE
 * RULE that plan-execute carries). One constant each; strategies compose
 * their strategy-specific additions around these.
 */

export const SYNTHESIZER_PERSONA =
  "You are a synthesizer. Combine execution results into a clear, concise final answer. Exclude all internal agent metadata.";

export const PLANNER_PERSONA =
  "You are a planning agent. Decompose the goal into structured steps.";
