/**
 * Quick-pick tool list for the builder panel's Tools section.
 *
 * Only capability tools (`kind: "built-in"`) are offered here. Meta-tools
 * (`kind: "meta"`: recall, find, brief, pulse, checkpoint, ...) are wired by the
 * kernel and configured in the Meta tools section, so listing them here showed
 * `recall` twice and offered picks that do not control anything.
 */
import type { IconName } from "./icons.js";

export interface CatalogToolRow {
  kind: string;
  name: string;
  displayName?: string;
  disabled?: boolean;
}

export interface ToolPick {
  id: string;
  label: string;
  /** Kit icon (`lib/icons.ts`). */
  icon: IconName;
}

/**
 * Shell toolsets (`GET /api/tools/shell-presets`, framework `BUILTIN_SHELL_PRESETS`) as picks.
 * The pick id is the toolset name (`git`), which the framework resolves to a `shell-execute`
 * limited to those programs; the label names the programs so users see what they enable.
 */
export function shellPresetPicks(presets: Readonly<Record<string, readonly string[]>>): ToolPick[] {
  return Object.entries(presets)
    .map(([alias, programs]): ToolPick => ({ id: alias, label: `${alias} (${programs.join(" · ")} via shell)`, icon: "shell" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Kit icons for the common built-in tools; anything else shows the generic tool icon. */
export const TOOL_ICONS: Readonly<Record<string, IconName>> = {
  "web-search": "search",
  "http-get": "external",
  "file-read": "file",
  "file-write": "edit",
  "code-execute": "code",
  "shell-execute": "shell",
  "crypto-price": "signal",
};

/** Built-in, enabled catalog rows as label-sorted picks; `icons` maps tool name to a kit icon (fallback `tool`). */
export function builderToolPicks(catalog: readonly CatalogToolRow[], icons: Readonly<Record<string, IconName>> = TOOL_ICONS): ToolPick[] {
  return catalog
    .filter((t) => t.kind === "built-in" && t.disabled !== true)
    .map((t): ToolPick => ({ id: t.name, label: t.displayName || t.name, icon: icons[t.name] ?? "tool" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
