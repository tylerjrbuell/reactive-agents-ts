/**
 * Debriefs follow memory unless set. The framework's `isDebriefEnabled`
 * (runtime `debrief.ts`) is `debrief ?? enableMemory === true`: an explicit
 * `withDebrief(true|false)` wins, unset follows memory. The run must also take
 * the reasoning loop (`engine/finalize/debrief-synthesis.ts`, `shouldFinalize`).
 * Cortex carries the setting as `rawConfig.debrief`. These rules drive the
 * builder's "Debrief after each run" switch (memory tiers stay independent) and
 * the run view's empty state. Pure; pinned by `debrief-memory.test.ts`, the
 * framework side by `server/tests/debrief-memory.test.ts`.
 */

/** The panel's memory tiers. */
export interface MemoryTiers {
  readonly working: boolean;
  readonly episodic: boolean;
  readonly semantic: boolean;
}

const memoryOn = (m: MemoryTiers): boolean => m.working || m.episodic || m.semantic;
const explicit = (rawConfig: Record<string, unknown> | undefined): boolean | undefined => {
  const d = rawConfig?.["debrief"];
  return typeof d === "boolean" ? d : undefined;
};

/** Whether runs get a debrief: explicit `rawConfig.debrief`, else any memory tier on. */
export function debriefsOn(memory: MemoryTiers, rawConfig?: Record<string, unknown>): boolean {
  return explicit(rawConfig) ?? memoryOn(memory);
}

/**
 * `rawConfig` after flipping "Debrief after each run". Memory is never changed.
 * `debrief` is stored only when it differs from what memory implies, so an
 * unset value keeps following memory.
 */
export function rawConfigForDebriefs(
  memory: MemoryTiers,
  rawConfig: Record<string, unknown>,
  on: boolean,
): Record<string, unknown> {
  const { debrief: _drop, ...rest } = rawConfig;
  return on === memoryOn(memory) ? rest : { ...rest, debrief: on };
}

/** The hint under the switch. */
export function debriefSwitchHint(memory: MemoryTiers, rawConfig?: Record<string, unknown>): string {
  const e = explicit(rawConfig);
  const mem = memoryOn(memory);
  if (e === true && !mem) return "On without memory: the debrief is written to a small debrief store.";
  if (e === false && mem) return "Off although memory is on.";
  return mem
    ? "On because it follows memory. Turn it off to skip debriefs while keeping memory."
    : "Off while memory is off. Turn it on to write debriefs without memory.";
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

const rawOf = (launch: Record<string, unknown> | null): Record<string, unknown> | undefined => {
  const r = launch?.["rawConfig"];
  return r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : undefined;
};

/** What the Debrief panel says without a debrief. */
export function debriefEmptyState(status: string, runId: string, launch: Record<string, unknown> | null): DebriefEmptyState {
  if (status === "loading") return { text: "Loading the run…" };
  if (status === "live") return { text: "The debrief is written when the run finishes." };
  const href = launch ? `/lab?fromRun=${encodeURIComponent(runId)}` : undefined;
  const raw = rawOf(launch);
  const tiers = tiersOf(launch);
  const flag = explicit(raw);
  if (flag === false) {
    const text = "No debrief was recorded: debrief was turned off for this agent. Turn on Debrief after each run in the agent's Memory settings.";
    return href ? { text, href } : { text };
  }
  if (flag === true || (tiers && memoryOn(tiers))) {
    return {
      text: "No debrief was recorded although debrief was on. The framework skips it for a paused run and for a turn that ran without the reasoning loop (a chat with tools off).",
    };
  }
  const text =
    "No debrief was recorded. Debrief follows memory unless set: turn on Debrief after each run in the agent's Memory settings.";
  return href ? { text, href } : { text };
}
