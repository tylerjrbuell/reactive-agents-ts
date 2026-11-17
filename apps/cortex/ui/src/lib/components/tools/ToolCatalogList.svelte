<script lang="ts">
  /** The tool catalog column: search, then one row per tool with its kind badge. */
  import Badge from "$lib/components/kit/Badge.svelte";
  import { kindLabel, kindTone, type CatalogEntry } from "$lib/tool-workshop.js";

  interface Props {
    /** Search text. */
    search?: string;
    loading: boolean;
    /** Catalog rows after the search filter. */
    entries: CatalogEntry[];
    selectedId: string | null;
    onSelect: (entry: CatalogEntry) => void;
  }
  let { search = $bindable(""), loading, entries, selectedId, onSelect }: Props = $props();
</script>

<div class="cat">
  <label class="sr-only" for="tw-tool-search">Search tools</label>
  <input id="tw-tool-search" type="search" class="cx-control" bind:value={search} placeholder="Search tools" />
  <div class="cat-list">
    {#if loading}
      <p class="note" role="status">Loading the catalog…</p>
    {:else if entries.length === 0}
      <p class="note">No tools match.</p>
    {:else}
      {#each entries as entry (entry.id)}
        <button type="button" class="row" aria-current={selectedId === entry.id ? "true" : undefined} onclick={() => onSelect(entry)}>
          <span class="badges">
            <Badge tone={kindTone(entry.kind)}>{kindLabel(entry.kind)}</Badge>
            {#if entry.disabled}<Badge tone="neutral">Disabled</Badge>{/if}
          </span>
          <span class="name">{entry.displayName}</span>
          <span class="desc">{entry.description}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .cat { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .cat :global(.cx-control) { flex: none; }
  .cat-list { min-height: 0; overflow-y: auto; display: grid; align-content: start; gap: 4px; }
  .note { margin: 0; padding: 16px 0; text-align: center; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .row {
    display: grid;
    gap: 4px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    text-align: left;
    cursor: pointer;
    font-family: var(--cortex-font-ui);
  }
  .row:hover { background: var(--cortex-surface-2); }
  .row[aria-current="true"] { background: var(--cortex-surface-3); border-color: var(--cortex-line-strong); }
  .row:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 1px; }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; }
  .name { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .desc { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
