<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import ShellWorkspaceFields from "$lib/components/ShellWorkspaceFields.svelte";
  import ToolDisclosureField from "$lib/components/ToolDisclosureField.svelte";
  import { toggleServerTools } from "$lib/tool-selection.js";
  import type { ToolPick } from "$lib/builder-tool-picks.js";
  import type { McpCatalogRow, PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
    /**
     * Master tools switch (chat sessions). Omit for builders where tools are always on.
     * `auto` = no explicit choice: tools are on exactly when something is selected.
     */
    toolsToggle?: { enabled: boolean; auto: boolean; onChange: (enabled: boolean) => void };
    /** Capability tools from the catalog, then the shell toolsets. */
    tools: ToolPick[];
    shellPresets: Record<string, string[]>;
    mcpCatalog: McpCatalogRow[];
    loadMcpCatalog: () => void | Promise<void>;
    /** The shell and workspace fields render as their own section (Lab builder nav): leave them out here. */
    splitShell?: boolean;
  }
  let { config = $bindable(), open, onToggle, toolsToggle, tools: AVAILABLE_TOOLS, shellPresets, mcpCatalog, loadMcpCatalog, splitShell = false }: Props = $props();

  function toggleTool(id: string) {
    const tools = config.tools.includes(id)
      ? config.tools.filter((t) => t !== id)
      : [...config.tools, id];
    config = { ...config, tools };
  }

  /** Host shell opt-in adds `shell-execute` at run time even if not in `config.tools`. */
  const toolCountForBadges = $derived.by(() => {
    const names = new Set(config.tools);
    if (config.terminalTools) names.add("shell-execute");
    return names.size;
  });

  /**
   * Derive the set of MCP server IDs required by the given tool selection.
   * Returns ALL server IDs that have at least one tool in `tools` — does not
   * filter against the existing `config.mcpServerIds` so adding a tool from a
   * new server always wires that server into the run.
   */
  function deriveMcpServerIds(tools: string[], catalog: McpCatalogRow[]): string[] {
    const ids = new Set<string>();
    for (const s of catalog) {
      if (s.tools.some((t) => tools.includes(t.toolName))) ids.add(s.serverId);
    }
    return [...ids];
  }

  function toggleMcpRegistryTool(serverId: string, fullToolName: string) {
    let tools = [...config.tools];
    if (tools.includes(fullToolName)) {
      tools = tools.filter((t) => t !== fullToolName);
    } else {
      tools.push(fullToolName);
    }
    const mcpServerIds = deriveMcpServerIds(tools, mcpCatalog);
    // Safety: if catalog hasn't loaded yet, keep the server that owns this tool
    if (mcpServerIds.length === 0 && tools.includes(fullToolName) && !mcpServerIds.includes(serverId)) {
      mcpServerIds.push(serverId);
    }
    config = { ...config, tools, mcpServerIds };
  }

  const selectedIn = (srv: McpCatalogRow) => srv.tools.filter((t) => config.tools.includes(t.toolName)).length;

  /** One click on a server name selects (or clears) all of its tools. */
  function toggleMcpServer(srv: McpCatalogRow) {
    const tools = toggleServerTools(config.tools, srv.tools.map((t) => t.toolName));
    config = { ...config, tools, mcpServerIds: deriveMcpServerIds(tools, mcpCatalog) };
  }
</script>

<ConfigSection id="tools" icon="tool" title="Tools" {open} {onToggle}>
  {#snippet head()}
      <Badge tone={toolsToggle && !toolsToggle.enabled ? "neutral" : "io"}>{toolsToggle && !toolsToggle.enabled ? "Off" : `${toolCountForBadges} selected`}</Badge>
  {/snippet}
        {#if toolsToggle}
          <label class="acp-check acp-check-box">
            <input
              type="checkbox"
              role="switch"
              checked={toolsToggle.enabled}
              onchange={(e) => toolsToggle.onChange((e.currentTarget as HTMLInputElement).checked)}
            />
            <span>
              <span class="acp-check-t">Tools {toolsToggle.enabled ? "on" : "off"}</span>
              <span class="acp-hint">
                {#if toolsToggle.enabled}
                  {toolsToggle.auto ? "On because tools are selected below. " : ""}Switch off to chat without any tools; your selection is kept.
                {:else}
                  The agent answers without tools. Switch on to use the selection below.
                {/if}
              </span>
            </span>
          </label>
        {/if}
        <div class="acp-stack transition-opacity {toolsToggle && !toolsToggle.enabled ? 'pointer-events-none opacity-45' : ''}" aria-disabled={toolsToggle ? !toolsToggle.enabled : undefined}>
        {#if !splitShell}<ShellWorkspaceFields bind:config {shellPresets} />{/if}
        <ToolDisclosureField bind:rawConfig={config.rawConfig} />
        <div class="acp-field">
        <span class="config-label">Quick picks</span>
        <div class="acp-chips" role="group" aria-label="Built-in tools and shell toolsets">
          {#each AVAILABLE_TOOLS as tool (tool.id)}
            {@const active = config.tools.includes(tool.id)}
            <button type="button" class="acp-toolchip" aria-pressed={active} onclick={() => toggleTool(tool.id)}>
              <Icon name={tool.icon} size="sm" />
              {tool.label}
            </button>
          {/each}
        </div>
        <p class="acp-hint">
          Each pick adds a framework tool id to <code>allowedTools</code>. Meta tools (brief, find, …) live in Meta tools.
        </p>
        </div>
        <div class="acp-field">
          <label for="acp-additional-tool-names" class="config-label mb-0">Additional allowed tools</label>
          <textarea
            id="acp-additional-tool-names"
            rows={2}
            bind:value={config.additionalToolNames}
            placeholder="e.g. my-lab-tool, server/http_get (comma or newline)"
            class="config-input min-h-[2.5rem] resize-y"
          ></textarea>
          <p class="acp-hint">
            Merged with the picks at run time. Use exact tool registration names (Lab · Tools lists MCP and custom tools).
          </p>
        </div>
        <div class="acp-group">
          <div class="flex items-center justify-between gap-2">
            <span class="config-label mb-0">MCP tools</span>
            <Button size="sm" variant="ghost" icon="retry" onclick={() => loadMcpCatalog()}>Refresh list</Button>
          </div>
          {#if mcpCatalog.length === 0}
            <p class="acp-hint">No MCP servers saved. Add one under Lab · Tools.</p>
          {:else}
            {#each mcpCatalog as srv (srv.serverId)}
              <div class="acp-card">
                {#if srv.tools.length > 0}
                  <div class="flex items-center justify-between gap-2">
                    <Tooltip text={selectedIn(srv) === srv.tools.length ? "Deselect every tool from this server" : "Select every tool from this server"}><button type="button" onclick={() => toggleMcpServer(srv)}
                      class="acp-linkbtn" aria-pressed={selectedIn(srv) === srv.tools.length}>{srv.name}</button></Tooltip>
                    <span class="acp-data">{selectedIn(srv)}/{srv.tools.length} selected</span>
                  </div>
                {:else}
                  <div class="acp-data">{srv.name}</div>
                {/if}
                {#if srv.tools.length === 0}
                  <p class="acp-hint">No tools cached. Run Refresh tools in Lab · Tools.</p>
                {:else}
                  <div class="acp-chips">
                    {#each srv.tools as mt (mt.toolName)}
                      {@const active = config.tools.includes(mt.toolName)}
                      <Tooltip text={mt.description ?? ""}><button type="button" class="acp-toolchip" aria-pressed={active} onclick={() => toggleMcpRegistryTool(srv.serverId, mt.toolName)}>
                        {mt.toolName.startsWith(`${srv.name}/`) ? mt.toolName.slice(srv.name.length + 1) : mt.toolName}
                      </button></Tooltip>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
        <div class="acp-group">
          <label class="acp-check">
            <input type="checkbox"
              checked={config.dynamicSubAgents?.enabled ?? false}
              onchange={() => (config = {
                ...config,
                dynamicSubAgents: {
                  enabled: !(config.dynamicSubAgents?.enabled ?? false),
                  maxIterations: config.dynamicSubAgents?.maxIterations ?? 8,
                },
              })} />
            <span>
              <span class="acp-check-t">Dynamic sub-agents</span>
              <span class="acp-hint">Gives the agent <code>spawn-agent</code> to hand work to a new agent while it runs.</span>
            </span>
          </label>
          {#if config.dynamicSubAgents?.enabled}
            <div>
              <label for="dyn-sub-max" class="config-label">Spawn max iterations</label>
              <input id="dyn-sub-max" type="number" min="1" max="50" step="1"
                value={config.dynamicSubAgents?.maxIterations ?? 8}
                oninput={(e) => (config = {
                  ...config,
                  dynamicSubAgents: {
                    enabled: true,
                    maxIterations: Math.max(1, parseInt((e.target as HTMLInputElement).value || "8", 10)),
                  },
                })}
                class="config-input" />
            </div>
          {/if}
        </div>
        </div>
</ConfigSection>
