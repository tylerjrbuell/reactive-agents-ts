/** Lab page tabs: ids, the tab bar entries, and the URL hash that opens one. */

/** One Lab tab. `gateway` is the saved-agents list (labelled "Agents"). */
export type LabTab = "builder" | "gateway" | "skills" | "tools" | "prompts";

/** Tab bar entries in display order. */
export const LAB_TABS: readonly { id: LabTab; label: string; icon: string }[] = [
  { id: "builder", label: "Builder", icon: "build" },
  { id: "gateway", label: "Agents", icon: "hub" },
  { id: "skills", label: "Skills", icon: "psychology" },
  { id: "tools", label: "Tools", icon: "construction" },
  { id: "prompts", label: "Prompts", icon: "menu_book" },
];

/** True for a known tab id (the `cortex:lab-tab` event carries one). */
export function isLabTab(v: unknown): v is LabTab {
  return v === "builder" || v === "gateway" || v === "skills" || v === "tools" || v === "prompts";
}

/** The tab a URL hash opens (`#gateway`, `#skills`, `#tools`, `#prompts`), or null for the default. */
export function labTabFromHash(hash: string): LabTab | null {
  if (hash === "#gateway") return "gateway";
  if (hash === "#skills") return "skills";
  if (hash === "#tools") return "tools";
  if (hash === "#prompts") return "prompts";
  return null;
}
