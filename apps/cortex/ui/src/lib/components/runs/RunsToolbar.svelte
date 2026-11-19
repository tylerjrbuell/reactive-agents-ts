<script lang="ts">
  /**
   * The Runs toolbar (Bench spec section 8): search, the status segment with a
   * count per status, sort, and the token and cost totals of the runs in view.
   */
  import Icon from "$lib/components/kit/Icon.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import { formatCostTotal, formatTokens, partialCostNote } from "@reactive-agents/ui-core";
  import { RUN_SORTS, RUN_STATUS_FILTERS, type RunSort, type RunStatusFilter } from "$lib/runs-table.js";

  interface Props {
    search: string;
    status: RunStatusFilter;
    sort: RunSort;
    counts: Record<RunStatusFilter, number>;
    totals: { readonly tokens: number; readonly cost: number; readonly costComplete: boolean };
  }
  let { search = $bindable(), status = $bindable(), sort = $bindable(), counts, totals }: Props = $props();

  // A segment with no runs is hidden (Waiting and Stopped are usually empty), except the one selected.
  const segments = $derived(RUN_STATUS_FILTERS.filter((f) => f.id === "all" || f.id === status || counts[f.id] > 0));
</script>

<div class="toolbar">
  <div class="search">
    <span class="i"><Icon name="search" size="sm" /></span>
    <input class="cx-control" type="search" bind:value={search} placeholder="Search runs, agents, models" aria-label="Search runs" />
  </div>
  <div class="seg" role="group" aria-label="Status">
    {#each segments as f (f.id)}
      <button type="button" aria-pressed={status === f.id} onclick={() => (status = f.id)}>{f.label} <span class="n">{counts[f.id]}</span></button>
    {/each}
  </div>
  <Select id="runs-sort" bind:value={sort} options={RUN_SORTS} aria-label="Sort runs" class="sort" />
  <div class="totals">
    <span>tokens <b>{formatTokens(totals.tokens)}</b></span>
    <span title={partialCostNote(totals.costComplete) || undefined}>cost <b>{formatCostTotal(totals.cost, totals.costComplete)}</b></span>
  </div>
</div>

<style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .search { position: relative; flex: 1 1 260px; max-width: 420px; }
  .search .i { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); display: inline-flex; color: var(--cortex-text-3); pointer-events: none; }
  .search .cx-control { width: 100%; padding-left: 32px; background: var(--cortex-surface-1); }
  .seg { display: inline-flex; padding: 2px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--cortex-text-2);
    font: inherit;
    font-size: var(--cortex-t-xs);
    cursor: pointer;
  }
  .seg button:hover { color: var(--cortex-text); }
  .seg button[aria-pressed="true"] { background: var(--cortex-surface-1); color: var(--cortex-text); box-shadow: 0 0 0 1px var(--cortex-line-strong); }
  .seg button:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 1px; }
  .n { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .toolbar :global(.sort) { width: auto; }
  .totals { margin-left: auto; display: flex; gap: 16px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .totals b { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); font-weight: 500; color: var(--cortex-text-2); }
</style>
