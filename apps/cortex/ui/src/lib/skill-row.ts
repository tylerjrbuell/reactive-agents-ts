/**
 * The skill row a chat turn and the run view show: which skills the run had active
 * and why. The data is ui-core's `RunSkillsView` (from the run's `SkillActivated`
 * events and `AgentStarted.config.skills`); this only words it. Pure.
 */
import { foldRunSkills, skillViaLabel, type RunSkillsView, type SkillActivationVia } from "@reactive-agents/ui-core";

/** One chip of the skill row. */
export interface SkillChip {
  readonly name: string;
  /** Why it was active, in words (`pinned`, `matched the task`, `loaded by the agent`). */
  readonly why: string;
  readonly via: SkillActivationVia;
  /** Tooltip: why, the step, version and short body hash when the run reported them. */
  readonly tooltip: string;
}

/** Chips for a run's active skills, in the order it loaded them. */
export function skillChips(view: RunSkillsView | undefined): SkillChip[] {
  return (view?.activations ?? []).map((a) => {
    const why = skillViaLabel(a.via);
    const bits = [
      `${a.name}: ${why}`,
      ...(a.iteration !== undefined && a.iteration > 0 ? [`at step ${a.iteration}`] : []),
      ...(a.version !== undefined ? [`v${a.version}`] : []),
      ...(a.sha256 ? [`sha ${a.sha256.slice(0, 8)}`] : []),
    ];
    return { name: a.name, why, via: a.via, tooltip: bits.join(" · ") };
  });
}

/** After the chips: how many skills the run could have loaded but did not; `null` when none. */
export function skillsAvailableNote(view: RunSkillsView | undefined): string | null {
  if (!view) return null;
  const rest = view.available - view.activations.length;
  return rest > 0 ? `${rest} more available` : null;
}

/** A run's skills from the run view's live messages (`{ type, payload }`, payload = the AgentEvent). */
export function runSkillsFromLive(events: readonly { readonly type: string; readonly payload: unknown }[]): RunSkillsView | undefined {
  return foldRunSkills(
    events
      .filter((e) => e.type === "AgentStarted" || e.type === "SkillActivated")
      .map((e) => ({ ...(typeof e.payload === "object" && e.payload !== null ? e.payload : {}), _tag: e.type })),
  );
}
