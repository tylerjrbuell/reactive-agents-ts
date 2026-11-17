<script lang="ts">
  /** The tool catalog rows: one card per tool with its kind badge. The search is in the tab's list header. */
  import Badge from "$lib/components/kit/Badge.svelte";
  import { kindLabel, kindTone, type CatalogEntry } from "$lib/tool-workshop.js";

  interface Props {
    loading: boolean;
    /** Catalog rows after the search filter. */
    entries: CatalogEntry[];
    selectedId: string | null;
    onSelect: (entry: CatalogEntry) => void;
  }
  const { loading, entries, selectedId, onSelect }: Props = $props();
</script>

{#if loading}
  <div class="tsh-skel" role="status" aria-label="Loading the catalog">
    {#each [0, 1, 2] as i (i)}<div class="chat-skeleton" style:animation-delay="{i * 120}ms"></div>{/each}
  </div>
{:else if entries.length === 0}
  <p class="tsh-note">No tools match.</p>
{:else}
  <ul class="cat">
    {#each entries as entry (entry.id)}
      <li>
        <button type="button" class="tsh-row" class:dim={entry.disabled} aria-current={selectedId === entry.id ? "true" : undefined} onclick={() => onSelect(entry)}>
          <span class="top">
            <span class="name">{entry.displayName}</span>
            <span class="badges">
              <Badge tone={kindTone(entry.kind)}>{kindLabel(entry.kind)}</Badge>
              {#if entry.disabled}<Badge tone="neutral">Disabled</Badge>{/if}
            </span>
          </span>
          <span class="desc">{entry.description}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .cat { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
  .badges { display: flex; flex: none; gap: 4px; }
  .name { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); color: var(--cortex-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .desc { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
