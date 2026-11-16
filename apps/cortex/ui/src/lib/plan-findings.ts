/**
 * A plan's recon findings for display and removal. The framework records them (`Plan.findings`,
 * the `planRecon` harness mechanism: read-effect tools run while planning); the server persists
 * them with the plan and the plan route returns them. These are the pure reads the plan card
 * needs. The `@reactive-agents/ui-core` `PlanWire` does not yet carry the field, so it is read
 * here with a guard. Pure.
 */

/** One recon finding: the tool that produced it and a short summary (mirrors core `PlanFinding`). */
export interface PlanFindingView {
  readonly id: string;
  readonly tool: string;
  readonly summary: string;
  readonly at?: number;
}

const isFinding = (v: unknown): v is PlanFindingView =>
  typeof v === "object" && v !== null && typeof (v as PlanFindingView).id === "string" && typeof (v as PlanFindingView).tool === "string" && typeof (v as PlanFindingView).summary === "string";

/** The findings a plan carries (`[]` for none, no plan, or a malformed field). */
export function findingsOfPlan(plan: object | null | undefined): readonly PlanFindingView[] {
  const raw = plan === null || plan === undefined ? undefined : (plan as { readonly findings?: unknown }).findings;
  return Array.isArray(raw) ? raw.filter(isFinding) : [];
}

/** The list without finding `id`. The same array when `id` is not in it. */
export function withoutFinding(findings: readonly PlanFindingView[], id: string): readonly PlanFindingView[] {
  return findings.some((f) => f.id === id) ? findings.filter((f) => f.id !== id) : findings;
}

/** The section's label: `Findings (3)`. */
export const findingsLabel = (n: number): string => `Findings (${n})`;

/**
 * The tool as a chip reads it: a namespaced MCP tool (`umami/get-websites`) shows its tool name
 * with the server as the title, so long names stay short without hiding where they came from.
 */
export function findingToolChip(tool: string): { readonly label: string; readonly title: string } {
  const slash = tool.indexOf("/");
  return slash > 0 && slash < tool.length - 1 ? { label: tool.slice(slash + 1), title: tool } : { label: tool, title: tool };
}
