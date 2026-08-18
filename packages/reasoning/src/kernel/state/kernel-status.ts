/**
 * Leaf module — extracted from kernel-state.ts so narrower structural views
 * of KernelState (e.g. completion-authority-state.ts) can reference the
 * status union without importing kernel-state.ts itself.
 */
export type KernelStatus = "thinking" | "acting" | "observing" | "done" | "failed" | "evaluating";
