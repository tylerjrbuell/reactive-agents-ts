<script lang="ts">
  /**
   * The master list of saved MCP servers: a state chip (Connected / Failed / Disabled / Not checked),
   * the tool count and when it was last checked. Disabled rows are dimmed. Row rules:
   * `lib/mcp-servers-view.ts`. Three states beyond rows: a loading skeleton, and an empty state
   * with Add server, Import JSON and an example line.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { filterServers, QUICK_ADD_EXAMPLE, serverListRow } from "$lib/mcp-servers-view.js";
  import type { McpListRow } from "$lib/tool-workshop.js";

  interface Props {
    servers: readonly McpListRow[];
    loading: boolean;
    selectedId: string | null;
    /** Search text (bindable). */
    search?: string;
    onSelect: (serverId: string) => void;
    onAdd: () => void;
    onImport: () => void;
    /** Clock for "checked 2 minutes ago" (tests pass a fixed one). */
    now?: number;
  }
  let { servers, loading, selectedId, search = $bindable(""), onSelect, onAdd, onImport, now = Date.now() }: Props = $props();

  const rows = $derived(filterServers(servers, search).map((r) => serverListRow(r, now)));
</script>

<div class="sl" data-testid="server-list">
  {#if loading}
    <div class="sl-skel" role="status" aria-label="Loading servers">
      {#each [0, 1, 2] as i (i)}<div class="chat-skeleton" style:animation-delay="{i * 120}ms"></div>{/each}
    </div>
  {:else if servers.length === 0}
    <EmptyState icon="server" title="No MCP servers yet">
      {#snippet actions()}
        <Button variant="primary" icon="plus" onclick={onAdd}>Add server</Button>
        <Button icon="download" onclick={onImport}>Import JSON</Button>
      {/snippet}
      {#snippet body()}
        <span>Connect a server and its tools appear in the catalog and in every agent's tool list. Try <code class="sl-code">{QUICK_ADD_EXAMPLE}</code></span>
      {/snippet}
    </EmptyState>
  {:else}
    <label class="sr-only" for="sl-search">Search servers</label>
    <input id="sl-search" type="search" class="cx-control" bind:value={search} placeholder="Search servers" />
    {#if rows.length === 0}
      <p class="sl-note">No server matches.</p>
    {:else}
      <ul class="sl-rows">
        {#each rows as r (r.serverId)}
          <li>
            <button type="button" class="sl-row" class:dim={r.dimmed} aria-current={selectedId === r.serverId ? "true" : undefined} onclick={() => onSelect(r.serverId)}>
              <span class="sl-top">
                <span class="sl-name">{r.name}</span>
                <Status tone={r.tone} label={r.label} />
              </span>
              <span class="sl-meta">{r.toolText}{r.checkedText ? ` · ${r.checkedText}` : ""}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .sl { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .sl-skel { display: grid; gap: 8px; }
  .sl-skel :global(.chat-skeleton) { height: 52px; border-radius: var(--cortex-r-ctl); }
  .sl-code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-accent); }
  .sl-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; overflow-y: auto; }
  .sl-row {
    display: grid; gap: 4px; width: 100%; padding: 10px 12px; text-align: left;
    border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1);
    font-family: var(--cortex-font-ui); cursor: pointer;
  }
  .sl-row:hover { background: var(--cortex-surface-2); }
  .sl-row[aria-current="true"] { border-color: color-mix(in srgb, var(--cortex-accent) 45%, transparent); background: var(--cortex-accent-tint); }
  .sl-row:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .sl-row.dim .sl-name { color: var(--cortex-text-2); }
  .sl-row.dim { opacity: 0.75; }
  .sl-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .sl-name { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); color: var(--cortex-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sl-meta { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .sl-note { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-3); }
</style>
