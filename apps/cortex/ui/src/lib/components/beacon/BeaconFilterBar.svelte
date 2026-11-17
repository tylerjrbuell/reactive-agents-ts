<script lang="ts">
  /**
   * The Field's filter bar: status chips with counts, a search box and a
   * "12 of 48" count while narrowed. Rules and the remembered choice live in
   * `beacon-filter.ts` (the Board's chips read the same ones); this only
   * renders them.
   */
  import Chip from "../kit/Chip.svelte";
  import Input from "../kit/Input.svelte";
  import {
    FIELD_FILTERS,
    filterCountLabel,
    isNoFilter,
    type AgentFilter,
    type BeaconFilter,
  } from "../../beacon-filter.js";

  interface Props {
    filter: BeaconFilter;
    /** Agents each chip would show (search applied). */
    counts: Readonly<Record<AgentFilter, number>>;
    /** Agents on the Field now, and every agent. */
    shown: number;
    total: number;
    onfilter: (next: BeaconFilter) => void;
  }

  let { filter, counts, shown, total, onfilter }: Props = $props();
</script>

<div class="bar" role="group" aria-label="Filter agents on the Field">
  <div class="chips">
    {#each FIELD_FILTERS as f (f.id)}
      <Chip on={filter.status === f.id} onclick={() => onfilter({ ...filter, status: f.id })}>
        {f.label}{#if f.id !== "all" && counts[f.id] > 0}<span class="c">{counts[f.id]}</span>{/if}
      </Chip>
    {/each}
  </div>
  <Input
    id="beacon-field-search"
    type="search"
    class="search"
    placeholder="Search name, model or task"
    aria-label="Search agents"
    value={filter.query}
    oninput={(e) => onfilter({ ...filter, query: e.currentTarget.value })}
  />
  <span class="count data" aria-live="polite">{filterCountLabel(shown, total)}</span>
  {#if !isNoFilter(filter)}
    <Chip onclick={() => onfilter({ status: "all", query: "" })}>Clear</Chip>
  {/if}
</div>

<style>
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
  .chips { display: inline-flex; flex-wrap: wrap; gap: 4px; }
  .c { margin-left: 4px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .bar :global(.search) { width: 240px; max-width: 100%; }
  .count { margin-left: auto; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
</style>
