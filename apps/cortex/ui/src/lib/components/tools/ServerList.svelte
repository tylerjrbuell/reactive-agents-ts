<script lang="ts">
  /**
   * The rows of the master list of saved MCP servers: a state chip (Checking… / Connected / Failed /
   * Disabled / Not checked), the tool count and when it was last checked. Disabled rows are dimmed.
   * The search and the Add action live in the tab's list header (`ToolsShell`). Row rules:
   * `lib/mcp-servers-view.ts`. States beyond rows: a loading skeleton, an empty state with Add
   * server, Import JSON and an example line, and "No server matches".
   */
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import CheckingChip from "$lib/components/tools/CheckingChip.svelte";
  import { filterServers, QUICK_ADD_EXAMPLE, serverListRow } from "$lib/mcp-servers-view.js";
  import type { McpListRow } from "$lib/tool-workshop.js";

  interface Props {
    servers: readonly McpListRow[];
    loading: boolean;
    selectedId: string | null;
    /** Search text. */
    search?: string;
    /** Ids with a background check running. */
    checking?: ReadonlySet<string>;
    onSelect: (serverId: string) => void;
    /** Clock for "checked 2 minutes ago" (tests pass a fixed one). */
    now?: number;
  }
  let { servers, loading, selectedId, search = "", checking = new Set<string>(), onSelect, now = Date.now() }: Props = $props();

  const rows = $derived(filterServers(servers, search).map((r) => serverListRow(r, now, checking.has(r.serverId))));
</script>

<div class="sl" data-testid="server-list">
  {#if loading}
    <div class="tsh-skel" role="status" aria-label="Loading servers">
      {#each [0, 1, 2] as i (i)}<div class="chat-skeleton" style:animation-delay="{i * 120}ms"></div>{/each}
    </div>
  {:else if servers.length === 0}
    <EmptyState icon="server" title="No MCP servers yet">
      {#snippet body()}
        <span>Add server above takes a pasted command or URL, a form, or an <code class="sl-code">mcpServers</code> JSON block. Its tools then appear in the catalog and in every agent's tool list. Try <code class="sl-code">{QUICK_ADD_EXAMPLE}</code></span>
      {/snippet}
    </EmptyState>
  {:else if rows.length === 0}
    <p class="tsh-note">No server matches.</p>
  {:else}
    <ul class="sl-rows">
      {#each rows as r (r.serverId)}
        <li>
          <button type="button" class="tsh-row" class:dim={r.dimmed} aria-current={selectedId === r.serverId ? "true" : undefined} onclick={() => onSelect(r.serverId)}>
            <span class="sl-top">
              <span class="sl-name">{r.name}</span>
              {#if r.checking}<CheckingChip />{:else}<Status tone={r.tone} label={r.label} />{/if}
            </span>
            <span class="sl-meta">{r.toolText}{r.checkedText ? ` · ${r.checkedText}` : ""}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .sl-code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-accent); }
  .sl-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .sl-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .sl-name { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); color: var(--cortex-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  :global(.tsh-row.dim) .sl-name { color: var(--cortex-text-2); }
  .sl-meta { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
