<!-- apps/cortex/ui/src/lib/components/TimelineRow.svelte -->
<script lang="ts">
  /**
   * One row of the trace Timeline tab: a category dot (agent violet, tools
   * cyan, control amber), the event title, the cache hit of an LLM exchange
   * and its sequence number. Expands to the reasoning parts or the trace JSON.
   */
  import type { TimelineRow } from "../stores/timeline-filter.js";
  import BoundedText from "$lib/components/BoundedText.svelte";
  interface Props { row: TimelineRow; expanded: boolean; onToggle: () => void; }
  let { row, expanded, onToggle }: Props = $props();

  // llm-exchange cache hit ratio for the collapsed badge (real cost signal).
  const cache = $derived.by(() => {
    if (row.trace?.kind !== "llm-exchange") return null;
    const r = (row.trace as { response?: { cacheReadTokensIn?: number; tokensIn?: number } }).response;
    if (!r?.cacheReadTokensIn || !r.tokensIn) return null;
    return Math.round((r.cacheReadTokensIn / r.tokensIn) * 100);
  });
</script>

<button type="button" class="row" aria-expanded={expanded} onclick={onToggle}>
  <span class="dot" data-cat={row.category} aria-hidden="true"></span>
  <span class="t">{row.title}</span>
  {#if cache !== null}<span class="m">cache {cache}%</span>{/if}
  <span class="m">#{row.seq}</span>
</button>

{#if expanded}
  <div class="detail">
    {#if row.reasoning}
      {#each [
        ["Thought", row.reasoning.thought],
        ["Action", row.reasoning.action],
        ["Observation", row.reasoning.observation],
        ["Raw response", row.reasoning.rawResponse],
      ] as [label, value] (label)}
        {#if value}
          <div>
            <h4>{label}</h4>
            <BoundedText text={value} preview={2000} maxHeight="14rem" />
          </div>
        {/if}
      {/each}
      {#if row.reasoning.messages}<span class="m">{row.reasoning.messages.length} messages</span>{/if}
    {:else if row.trace}
      <BoundedText text={JSON.stringify(row.trace, null, 2)} preview={3000} maxHeight="16rem" />
    {/if}
  </div>
{/if}

<style>
  .row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 16px; border: 0; background: none; color: var(--cortex-text); font: inherit; text-align: left; cursor: pointer; }
  .row:hover { background: var(--cortex-surface-2); }
  .row:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--cortex-text-3); }
  .dot[data-cat="reasoning"], .dot[data-cat="llm"] { background: var(--cortex-accent); }
  .dot[data-cat="tool"] { background: var(--cortex-io); }
  .dot[data-cat="control"] { background: var(--cortex-warn); }
  .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .m { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .detail { display: grid; gap: 8px; margin: 0 16px 8px 30px; padding-left: 10px; border-left: 1px solid var(--cortex-line); }
  h4 { margin: 0 0 2px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
</style>
