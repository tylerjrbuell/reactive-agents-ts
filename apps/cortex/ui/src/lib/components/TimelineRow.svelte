<!-- apps/cortex/ui/src/lib/components/TimelineRow.svelte -->
<script lang="ts">
  import type { TimelineRow } from "../stores/timeline-filter.js";
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
  <div class="ml-4 pl-2 border-l border-[var(--cortex-border)] text-[11px] font-mono whitespace-pre-wrap break-words text-on-surface-variant/90 pb-2">
    {#if row.reasoning}
      {#if row.reasoning.thought}<div class="mb-1"><span class="text-tertiary/70">thought:</span> {row.reasoning.thought}</div>{/if}
      {#if row.reasoning.action}<div class="mb-1"><span class="text-tertiary/70">action:</span> {row.reasoning.action}</div>{/if}
      {#if row.reasoning.observation}<div class="mb-1"><span class="text-tertiary/70">observation:</span> {row.reasoning.observation}</div>{/if}
      {#if row.reasoning.rawResponse}<div class="mb-1 opacity-70"><span class="text-tertiary/70">raw:</span> {row.reasoning.rawResponse}</div>{/if}
      {#if row.reasoning.messages}<div class="opacity-70">{row.reasoning.messages.length} messages</div>{/if}
    {:else if row.trace}
      <pre class="overflow-x-auto">{JSON.stringify(row.trace, null, 2)}</pre>
    {/if}
  </div>
{/if}
