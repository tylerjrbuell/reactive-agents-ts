/** Lab page tabs: ids, the tab bar entries, and the URL hash that opens one (Bench spec section 8). */

/** One Lab tab. `agents` is the saved-agents list (gateway and on-demand agents). */
export type LabTab = "builder" | "agents" | "skills" | "memory" | "tools" | "prompts";

/** Tab bar entries in display order. `memory` is the Memory studio (an agent's stored memory). */
export const LAB_TABS: readonly { readonly id: LabTab; readonly label: string }[] = [
  { id: "builder", label: "Builder" },
  { id: "agents", label: "Saved agents" },
  { id: "skills", label: "Skills" },
  { id: "memory", label: "Memory" },
  { id: "tools", label: "Tools" },
  { id: "prompts", label: "Prompts" },
];

/**
 * A tab id, or null. `gateway` is the old name of `agents` (the `#gateway`
 * hash and the `cortex:lab-tab` event from older links keep working).
 */
export function normalizeLabTab(v: unknown): LabTab | null {
  if (v === "gateway") return "agents";
  return v === "builder" || v === "agents" || v === "skills" || v === "memory" || v === "tools" || v === "prompts" ? v : null;
}

/** True for a tab id or its alias (the `cortex:lab-tab` event carries one). */
export function isLabTab(v: unknown): boolean {
  return normalizeLabTab(v) !== null;
}

/** The tab a URL hash opens (`#agents` or its alias `#gateway`, `#skills`, `#memory`, `#tools`, `#prompts`), or null for the default. */
export function labTabFromHash(hash: string): LabTab | null {
  const tab = normalizeLabTab(hash.replace(/^#/, ""));
  return tab === "builder" ? null : tab;
}

/** The hash a tab writes to the URL (`#agents`, never the alias); the Builder is the bare `/lab`. */
export function labTabHash(tab: LabTab): string {
  return tab === "builder" ? "" : `#${tab}`;
}
