/**
 * Quick-pick tool list for the builder panel's Tools section.
 *
 * Only capability tools (`kind: "built-in"`) are offered here. Meta-tools
 * (`kind: "meta"`: recall, find, brief, pulse, checkpoint, ...) are wired by the
 * kernel and configured in the Meta tools section, so listing them here showed
 * `recall` twice and offered picks that do not control anything.
 */
export interface CatalogToolRow {
  kind: string;
  name: string;
  displayName?: string;
  disabled?: boolean;
}

export interface ToolPick {
  id: string;
  label: string;
  icon: string;
}

/** Built-in, enabled catalog rows as label-sorted picks; `icons` maps tool name to a Material symbol. */
export function builderToolPicks(catalog: readonly CatalogToolRow[], icons: Readonly<Record<string, string>>): ToolPick[] {
  return catalog
    .filter((t) => t.kind === "built-in" && t.disabled !== true)
    .map((t) => ({ id: t.name, label: t.displayName || t.name, icon: icons[t.name] ?? "settings" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
