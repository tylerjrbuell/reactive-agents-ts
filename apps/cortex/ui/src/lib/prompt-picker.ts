/**
 * What the prompt-library popover lists (`PromptLibrary.svelte`), from the one
 * shared prompt store (`stores/prompt-store.ts`). Pure.
 *
 * `preferred` types (the field the picker sits beside: system and persona next
 * to a system prompt) put those prompts first; they never hide the others. A
 * saved prompt of any type is one click away from any field: filtering to the
 * field's types made the popover say "No saved prompts yet" while the Prompts
 * tab listed prompts saved as Snippet or Task.
 */
import type { PromptType, StoredPrompt } from "./stores/prompt-store.js";

/** The prompts to list: filtered by type chip and search, preferred types first, then store order. */
export function pickerPrompts(
  prompts: readonly StoredPrompt[],
  opts: { readonly preferred?: readonly PromptType[]; readonly typeFilter?: PromptType | "all"; readonly search?: string } = {},
): StoredPrompt[] {
  const preferred = opts.preferred ?? [];
  const q = (opts.search ?? "").trim().toLowerCase();
  const rank = (p: StoredPrompt): number => (preferred.length === 0 || preferred.includes(p.type) ? 0 : 1);
  return prompts
    .map((p, at) => ({ p, at }))
    .filter(({ p }) => (opts.typeFilter ?? "all") === "all" || p.type === opts.typeFilter)
    .filter(({ p }) => q === "" || p.name.toLowerCase().includes(q) || p.body.toLowerCase().includes(q))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.at - b.at)
    .map(({ p }) => p);
}

/** The line shown when the list is empty: no prompts at all, or none for this search or type. */
export function emptyPromptsText(total: number, shown: number): string | null {
  if (shown > 0) return null;
  return total === 0 ? "No saved prompts yet." : "No saved prompt matches. Clear the search or pick All.";
}
