<script lang="ts">
  /**
   * The Tools tab of a server: its cached tools with each one's input schema (tooltip on the
   * Input schema chip) and a Read-only chip when the server's `readOnly` option covers the tool.
   * Filter rules and schema words: `lib/mcp-servers-view.ts`.
   */
  import Chip from "$lib/components/kit/Chip.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import { bareToolName, filterServerTools, isReadOnlyTool, schemaTooltip, TOOL_FILTERS, type ToolFilter } from "$lib/mcp-servers-view.js";
  import type { McpToolDetail } from "$lib/tool-workshop.js";

  interface Props {
    serverName: string;
    /** The saved config (the read-only option lives in it). */
    config: Record<string, unknown>;
    /** Cached tools; null while loading. */
    tools: readonly McpToolDetail[] | null;
    /** Why the tools could not be loaded. */
    error?: string | null;
  }
  const { serverName, config, tools, error = null }: Props = $props();

  let filter = $state<ToolFilter>("all");
  let search = $state("");

  const shown = $derived(filterServerTools(tools ?? [], config, serverName, filter, search));
</script>

<div class="tp" data-testid="server-tools">
  {#if tools === null && error === null}
    <div class="tp-skel" role="status" aria-label="Loading tools">
      {#each [0, 1, 2] as i (i)}<div class="chat-skeleton" style:animation-delay="{i * 120}ms"></div>{/each}
    </div>
  {:else if error !== null}
    <p class="tp-note bad" role="alert">{error}</p>
  {:else if (tools ?? []).length === 0}
    <p class="tp-note">No tools listed yet. Use Refresh tools to list what the server offers.</p>
  {:else}
    <div class="tp-bar">
      <label class="sr-only" for="tp-search">Search tools</label>
      <input id="tp-search" type="search" class="cx-control tp-search" bind:value={search} placeholder="Search tools" />
      <Select id="tp-filter" value={filter} options={TOOL_FILTERS} onchange={(v) => (filter = TOOL_FILTERS.find((f) => f.value === v)?.value ?? filter)} />
    </div>
    {#if shown.length === 0}
      <p class="tp-note">No tool matches.</p>
    {:else}
      <ul class="tp-list">
        {#each shown as t (t.toolName)}
          <li class="tp-item">
            <div class="tp-head">
              <span class="tp-name">{bareToolName(serverName, t.toolName)}</span>
              {#if isReadOnlyTool(config, serverName, t.toolName)}<Chip icon="eye" title="The server's read-only option covers this tool">Read-only</Chip>{/if}
              <Tooltip text={schemaTooltip(t.inputSchema)}><Chip data>Input schema</Chip></Tooltip>
            </div>
            {#if t.description}<p class="tp-desc">{t.description}</p>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .tp { display: grid; gap: 10px; }
  .tp-skel { display: grid; gap: 8px; }
  .tp-skel :global(.chat-skeleton) { height: 44px; border-radius: var(--cortex-r-ctl); }
  .tp-bar { display: flex; gap: 8px; align-items: center; }
  .tp-search { flex: 1; min-width: 0; }
  .tp-note { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-3); }
  .tp-note.bad { color: var(--cortex-bad); }
  .tp-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .tp-item { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .tp-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .tp-name { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .tp-desc { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); line-height: var(--cortex-lh-ui); }
</style>
