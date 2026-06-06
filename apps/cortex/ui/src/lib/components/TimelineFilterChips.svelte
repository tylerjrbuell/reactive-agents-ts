<!-- apps/cortex/ui/src/lib/components/TimelineFilterChips.svelte -->
<script lang="ts">
  import { ALL_CATEGORIES, type TimelineCategory } from "../stores/timeline-filter.js";
  interface Props { active: Set<TimelineCategory>; counts: Record<TimelineCategory, number>; onToggle: (c: TimelineCategory) => void; }
  let { active, counts, onToggle }: Props = $props();
  const LABEL: Record<TimelineCategory, string> = { reasoning: "Reasoning", llm: "LLM calls", tool: "Tools", control: "Control", aux: "Aux/internal" };
</script>

<div class="flex flex-wrap gap-1.5 px-2 py-1.5 border-b border-[var(--cortex-border)]">
  {#each ALL_CATEGORIES as c (c)}
    <button type="button"
      class="font-mono text-[10px] px-2 py-0.5 rounded-full border transition-colors {active.has(c)
        ? 'border-primary/40 bg-primary/12 text-primary'
        : 'border-outline/30 text-outline/60 hover:text-on-surface-variant'}"
      onclick={() => onToggle(c)}>
      {LABEL[c]} <span class="opacity-60">{counts[c] ?? 0}</span>
    </button>
  {/each}
</div>
