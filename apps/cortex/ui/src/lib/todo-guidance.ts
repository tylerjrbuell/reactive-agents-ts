/** Opt-in "Keep to-do list current" setting helpers (experimental, default off; ablation ruling V5). */
export type TodoGuidance = { reminder?: boolean; systemLine?: boolean };
type MetaToolsWithGuidance = { todo?: boolean; todoGuidance?: TodoGuidance };

/** True only when both guidance flags are on. Absent field (older sessions) reads as off. */
export function todoGuidanceOn(mt: MetaToolsWithGuidance): boolean {
  return mt.todoGuidance?.reminder === true && mt.todoGuidance?.systemLine === true;
}

/** Returns a copy of `mt` with both guidance flags set to `on`. */
export function setTodoGuidance<T extends MetaToolsWithGuidance>(mt: T, on: boolean): T {
  return { ...mt, todoGuidance: { reminder: on, systemLine: on } };
}
