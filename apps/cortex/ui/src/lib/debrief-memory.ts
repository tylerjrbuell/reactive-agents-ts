/**
 * Debriefs follow memory. The framework writes a run debrief (`DebriefCompleted`)
 * only when the agent has memory on and the run took the reasoning loop (runtime
 * `engine/finalize/debrief-synthesis.ts`, `shouldFinalize`); there is no separate
 * debrief setting. Small or local runs get the deterministic debrief, larger
 * models a synthesised one. These rules drive the builder's "Debrief after each
 * run" switch (it reads and writes the memory tiers) and the run view's empty
 * state. Pure; pinned by `debrief-memory.test.ts`, the framework side by
 * `server/tests/debrief-memory.test.ts`.
 */

/** The panel's memory tiers. */
export interface MemoryTiers {
  readonly working: boolean;
  readonly episodic: boolean;
  readonly semantic: boolean;
}

/** Whether runs get a debrief: any memory tier on. */
export function debriefsOn(memory: MemoryTiers): boolean {
  return memory.working || memory.episodic || memory.semantic;
}

/**
 * The memory tiers after flipping "Debrief after each run": on turns working
 * memory on (the lightest tier) when every tier is off; off turns every tier off,
 * since a debrief cannot be had without memory.
 */
export function memoryForDebriefs(memory: MemoryTiers, on: boolean): MemoryTiers {
  if (on) return debriefsOn(memory) ? memory : { ...memory, working: true };
  return { working: false, episodic: false, semantic: false };
}

/** The hint under the switch. */
export function debriefSwitchHint(memory: MemoryTiers): string {
  return debriefsOn(memory)
    ? "On because memory is on: the framework writes a debrief when memory is on. Turning this off turns memory off."
    : "Debriefs need memory. Turning this on turns working memory on.";
}

/** The run view's text when a run has no debrief, and where to change it. */
export interface DebriefEmptyState {
  readonly text: string;
  /** Opens the run's config in the Lab (Edit and rerun), when the run has a launch snapshot. */
  readonly href?: string;
}

const tiersOf = (launch: Record<string, unknown> | null): MemoryTiers | null => {
  const m = launch?.["memory"];
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const r = m as Record<string, unknown>;
  return { working: r["working"] === true, episodic: r["episodic"] === true, semantic: r["semantic"] === true };
};

/** What the Debrief panel says without a debrief. */
export function debriefEmptyState(status: string, runId: string, launch: Record<string, unknown> | null): DebriefEmptyState {
  if (status === "loading") return { text: "Loading the run…" };
  if (status === "live") return { text: "The debrief is written when the run finishes." };
  const href = launch ? `/lab?fromRun=${encodeURIComponent(runId)}` : undefined;
  const tiers = tiersOf(launch);
  if (tiers && debriefsOn(tiers)) {
    return {
      text: "No debrief was recorded although memory was on. The framework skips it for a paused run and for a turn that ran without the reasoning loop (a chat with tools off).",
    };
  }
  const text =
    "No debrief was recorded. The framework writes one only when the agent has memory on: turn on Debrief after each run in the agent's Memory settings.";
  return href ? { text, href } : { text };
}
