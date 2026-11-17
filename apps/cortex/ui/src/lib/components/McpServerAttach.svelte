<script lang="ts">
  /**
   * Attach saved MCP servers to an agent: one row per server with its state, and a chip per tool.
   * Shared by the Builder and the chat panel (both render it through `ToolsSection`). The rule is
   * `lib/tool-selection.ts` only: attached = every tool of the server, naming tools = just those.
   * It writes the same `tools` and `mcpServerIds` fields as before and adds no config path.
   * Row and strip words: `lib/mcp-attach.ts`.
   */
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import McpEffectsStrip from "$lib/components/McpEffectsStrip.svelte";
  import { attachRow, type AttachServer } from "$lib/mcp-attach.js";
  import { bareToolName } from "$lib/mcp-servers-view.js";
  import { toggleMcpServerAttached, toggleMcpTool, mcpToolAvailable } from "$lib/tool-selection.js";
  import type { PanelAgentConfig } from "$lib/components/agent-config/types.js";

  interface Props {
    /** The config being edited; this component writes `tools` and `mcpServerIds` only. */
    config: PanelAgentConfig;
    servers: readonly AttachServer[];
    onRefresh: () => void | Promise<void>;
  }
  let { config = $bindable(), servers, onRefresh }: Props = $props();

  const asServer = (srv: AttachServer) => ({ serverId: srv.serverId, tools: srv.tools.map((t) => t.toolName) });

  function toggleServer(srv: AttachServer) {
    config = { ...config, ...toggleMcpServerAttached(config, asServer(srv)) };
  }
  function toggleTool(srv: AttachServer, tool: string) {
    config = { ...config, ...toggleMcpTool(config, asServer(srv), tool) };
  }
</script>

<div class="mcpa" data-testid="mcp-attach">
  <div class="mcpa-h">
    <span class="mcpa-title">MCP servers</span>
    <Button size="sm" variant="ghost" icon="retry" onclick={() => onRefresh()}>Refresh list</Button>
  </div>

  {#if servers.length === 0}
    <p class="mcpa-hint">No MCP servers saved. Add one in Lab > Tools > Servers.</p>
  {:else}
    {#each servers as srv (srv.serverId)}
      {@const row = attachRow(config, srv)}
      <div class="mcpa-card" class:dim={row.disabled} data-server={srv.serverId}>
        <div class="mcpa-row">
          <Tooltip text={row.nameTip}>
            <button type="button" class="mcpa-name" aria-pressed={row.mode !== "off"} disabled={!row.canToggle} onclick={() => toggleServer(srv)}>{srv.name}</button>
          </Tooltip>
          {#if row.disabled}<Badge tone="neutral">Disabled</Badge>{/if}
          <span class="mcpa-count">{row.available}/{row.total} available</span>
        </div>
        {#if row.note}<p class="mcpa-hint">{row.note}</p>{/if}
        {#if srv.tools.length > 0}
          <div class="mcpa-chips">
            {#each srv.tools as t (t.toolName)}
              <Tooltip text={t.description ?? ""}>
                <button
                  type="button"
                  class="mcpa-chip"
                  aria-pressed={mcpToolAvailable(config, asServer(srv), t.toolName)}
                  disabled={row.disabled && row.mode === "off"}
                  onclick={() => toggleTool(srv, t.toolName)}
                >{bareToolName(srv.name, t.toolName)}</button>
              </Tooltip>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}

  <McpEffectsStrip {config} {servers} />
</div>

<style>
  .mcpa { display: grid; gap: 8px; }
  .mcpa-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .mcpa-title { font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .mcpa-card { display: grid; gap: 6px; padding: 10px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .mcpa-card.dim { opacity: 0.7; }
  .mcpa-row { display: flex; align-items: center; gap: 8px; }
  .mcpa-name { padding: 0; border: 0; background: none; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-2); cursor: pointer; }
  .mcpa-name[aria-pressed="true"] { color: var(--cortex-accent); font-weight: 600; }
  .mcpa-name:disabled { cursor: not-allowed; }
  .mcpa-name:focus-visible, .mcpa-chip:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 4px; }
  .mcpa-count { margin-left: auto; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .mcpa-hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .mcpa-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .mcpa-chip {
    height: 24px; padding: 0 8px; border: 1px solid transparent; border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2); color: var(--cortex-text-2);
    font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); cursor: pointer;
  }
  .mcpa-chip:hover:not(:disabled) { color: var(--cortex-text); border-color: var(--cortex-line-strong); }
  .mcpa-chip[aria-pressed="true"] { color: var(--cortex-accent); background: var(--cortex-accent-tint); border-color: color-mix(in srgb, var(--cortex-accent) 40%, transparent); }
  .mcpa-chip:disabled { cursor: not-allowed; opacity: 0.6; }
</style>
