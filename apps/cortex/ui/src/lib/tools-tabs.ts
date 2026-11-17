/** Lab > Tools sub-tabs: ids, words and the counts the tab labels carry. */

/** One Lab > Tools sub-tab. */
export type ToolsTab = "servers" | "custom" | "catalog";

/** Sub-tabs in display order. */
export const TOOLS_TABS: readonly { readonly id: ToolsTab; readonly label: string }[] = [
  { id: "servers", label: "Servers" },
  { id: "custom", label: "Custom tools" },
  { id: "catalog", label: "Catalog and test" },
];

/** The Lab's own tools in a catalog (kind custom, id `lab:<id>`). The tab list and the tab's count both read this, so they cannot disagree. */
export function customToolsOf<T extends { readonly kind: string; readonly id: string }>(catalog: readonly T[]): T[] {
  return catalog.filter((t) => t.kind === "custom" && t.id.startsWith("lab:"));
}

/** Tab items with a count each once the lists have loaded (no count while loading, so no false zeros). */
export function toolsTabCounts(
  tabs: readonly { readonly id: ToolsTab; readonly label: string }[],
  counts: Readonly<Record<ToolsTab, number>>,
  loading: boolean,
): { id: ToolsTab; label: string; count?: number }[] {
  return tabs.map((t) => (loading ? { id: t.id, label: t.label } : { id: t.id, label: t.label, count: counts[t.id] }));
}
