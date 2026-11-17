/**
 * View rules for one plan-card step row (`PlanChecklist.svelte`): which tool control a step
 * shows and what its dependencies-and-args chip says. Pure; the row's data (steps, tool hints,
 * `dependsOn` / `args`) is the framework `Plan`'s, nothing here decides what a step means.
 */
import { dependsLabel, type StepExtras } from "./plan-extras.js";

/** What the tool slot of an editable row is: a quiet add affordance, or the compact pick list. */
export type ToolControl = "add" | "select";

/**
 * A step with a tool shows its pick list; one without shows only a quiet "+ tool" until the
 * person asks for it (`revealed`), so a row with no tool costs no width.
 */
export function toolControl(tool: string | undefined, revealed: boolean): ToolControl {
  return tool !== undefined && tool !== "" ? "select" : revealed ? "select" : "add";
}

/** The dependencies-and-args chip of a step: its words and whether the step carries any. */
export interface ExtrasChip {
  readonly label: string;
  /** `true` when the step has prerequisites or args (the chip then reads as set, not as an affordance). */
  readonly set: boolean;
}

/** `after 2 · args` for a step that has them, `deps / args` (an affordance) for one that has none. */
export function extrasChip(steps: readonly { readonly id: string }[], extras: StepExtras | undefined): ExtrasChip {
  const parts = [dependsLabel(steps, extras?.dependsOn), extras?.args !== undefined ? "args" : ""].filter((x) => x !== "");
  return parts.length > 0 ? { label: parts.join(" · "), set: true } : { label: "deps / args", set: false };
}

/** `ids` with `id` added when absent, removed when present (the expanded-rows set). */
export function toggleId(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
