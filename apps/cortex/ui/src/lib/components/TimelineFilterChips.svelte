<!-- apps/cortex/ui/src/lib/components/TimelineFilterChips.svelte -->
<script lang="ts">
  /** Category toggles for the trace Timeline tab, each with its row count. */
  import { ALL_CATEGORIES, type TimelineCategory } from "../stores/timeline-filter.js";
  interface Props { active: Set<TimelineCategory>; counts: Record<TimelineCategory, number>; onToggle: (c: TimelineCategory) => void; }
  let { active, counts, onToggle }: Props = $props();
  const LABEL: Record<TimelineCategory, string> = { reasoning: "Reasoning", llm: "Model calls", tool: "Tools", control: "Control", aux: "Internal" };
</script>

<div class="chips" role="group" aria-label="Timeline categories">
  {#each ALL_CATEGORIES as c (c)}
    <button type="button" aria-pressed={active.has(c)} onclick={() => onToggle(c)}>
      {LABEL[c]} <span class="n">{counts[c] ?? 0}</span>
    </button>
  {/each}
</div>

<style>
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px; border-bottom: 1px solid var(--cortex-line); }
  button { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-chip); background: none; color: var(--cortex-text-3); font: inherit; font-size: var(--cortex-t-xs); cursor: pointer; }
  button[aria-pressed="true"] { border-color: transparent; background: var(--cortex-surface-3); color: var(--cortex-text); }
  button:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .n { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
</style>
