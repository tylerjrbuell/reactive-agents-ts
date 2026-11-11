<script lang="ts">
  import { kindBadgeClass, kindLabel, type CatalogEntry } from "$lib/tool-workshop.js";

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

    <div class="flex flex-col min-h-0 gap-2">
      <input
        type="search"
        bind:value={search}
        placeholder="Search tools…"
        class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono placeholder:text-outline/35 flex-shrink-0"
      />
      <div class="overflow-y-auto min-h-0 space-y-1.5 pr-1">
        {#if loading}
          <div class="flex justify-center py-8">
            <span class="material-symbols-outlined text-primary animate-spin">progress_activity</span>
          </div>
        {:else if entries.length === 0}
          <p class="font-mono text-[10px] text-outline/50 text-center py-6">No tools match.</p>
        {:else}
          {#each entries as entry (entry.id)}
            <button
              type="button"
              onclick={() => onSelect(entry)}
              class="w-full text-left p-3 rounded-lg border transition-all
                     {selectedId === entry.id
                ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/20'
                : 'bg-surface-container-low/50 border-outline-variant/15 hover:border-primary/25'}"
            >
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span
                  class="text-[7px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider {kindBadgeClass(
                    entry.kind,
                  )}">{kindLabel(entry.kind)}</span
                >
                {#if entry.disabled}
                  <span class="text-[7px] font-mono text-error/80 border border-error/30 rounded px-1">OFF</span>
                {/if}
              </div>
              <div class="font-mono text-[11px] text-on-surface font-medium truncate">{entry.displayName}</div>
              <div class="font-mono text-[9px] text-outline/55 line-clamp-2 mt-0.5">{entry.description}</div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
