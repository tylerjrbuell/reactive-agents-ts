<!-- apps/cortex/ui/src/lib/components/TimelineRow.svelte -->
<script lang="ts">
  import type { TimelineRow } from "../stores/timeline-filter.js";
  import BoundedText from "$lib/components/BoundedText.svelte";
  interface Props { row: TimelineRow; expanded: boolean; onToggle: () => void; }
  let { row, expanded, onToggle }: Props = $props();

  const dotClass = $derived(
    row.category === "reasoning" ? "bg-secondary"
    : row.category === "llm" ? "bg-primary"
    : row.category === "tool" ? "bg-emerald-500"
    : row.category === "control" ? "bg-amber-500"
    : "bg-outline/50",
  );
  // llm-exchange cache hit ratio for the collapsed badge (real cost signal).
  const cache = $derived.by(() => {
    if (row.trace?.kind !== "llm-exchange") return null;
    const r = (row.trace as { response?: { cacheReadTokensIn?: number; tokensIn?: number } }).response;
    if (!r?.cacheReadTokensIn || !r.tokensIn) return null;
    return Math.round((r.cacheReadTokensIn / r.tokensIn) * 100);
  });
</script>

<button type="button" class="w-full flex items-start gap-2 text-left py-1 hover:bg-surface-container/40" onclick={onToggle}>
  <span class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 {dotClass}"></span>
  <span class="font-mono text-[11px] text-on-surface-variant truncate flex-1">{row.title}</span>
  {#if cache !== null}<span class="font-mono text-[10px] text-primary/70">cache {cache}%</span>{/if}
  <span class="font-mono text-[10px] text-outline/60">#{row.seq}</span>
</button>

{#if expanded}
  <div class="ml-4 space-y-1.5 border-l border-[var(--cortex-border)] pb-2 pl-2 text-[11px] text-on-surface-variant/90">
    {#if row.reasoning}
      {#each [
        ["thought", row.reasoning.thought],
        ["action", row.reasoning.action],
        ["observation", row.reasoning.observation],
        ["raw", row.reasoning.rawResponse],
      ] as [label, value] (label)}
        {#if value}
          <div>
            <div class="mb-0.5 font-mono text-[9px] uppercase tracking-widest text-tertiary/80">{label}</div>
            <BoundedText text={value} preview={2000} maxHeight="14rem" />
          </div>
        {/if}
      {/each}
      {#if row.reasoning.messages}<div class="font-mono text-[10px] opacity-70">{row.reasoning.messages.length} messages</div>{/if}
    {:else if row.trace}
      <BoundedText text={JSON.stringify(row.trace, null, 2)} preview={3000} maxHeight="16rem" />
    {/if}
  </div>
{/if}
