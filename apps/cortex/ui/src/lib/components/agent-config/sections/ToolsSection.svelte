<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
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
  }
  let { config = $bindable(), open, onToggle, toolsToggle, tools: AVAILABLE_TOOLS, shellPresets, mcpCatalog, loadMcpCatalog }: Props = $props();

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

<ConfigSection id="tools" {open} {onToggle}>
  {#snippet head()}
      <span class="material-symbols-outlined text-[15px] text-tertiary/90 shrink-0" aria-hidden="true">construction</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Tools</span>
      <span class="ml-2 rounded-md bg-[color-mix(in_srgb,var(--ra-amber)_16%,transparent)] px-1.5 py-0.5 text-[11px] font-mono text-tertiary">{toolsToggle && !toolsToggle.enabled ? "off" : `${toolCountForBadges} active`}</span>
  {/snippet}
        {#if toolsToggle}
          <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--cortex-border)] bg-[var(--cortex-surface-mid)]/40 p-3">
            <input
              type="checkbox"
              role="switch"
              checked={toolsToggle.enabled}
              onchange={(e) => toolsToggle.onChange((e.currentTarget as HTMLInputElement).checked)}
              class="mt-0.5 accent-primary shrink-0"
            />
            <span class="min-w-0">
              <span class="block font-mono text-[11px] text-[var(--cortex-text)]">Tools {toolsToggle.enabled ? "on" : "off"}</span>
              <span class="block font-mono text-[10px] leading-relaxed text-[var(--cortex-text-muted)]">
                {#if toolsToggle.enabled}
                  {toolsToggle.auto ? "On because tools are selected below. " : ""}Switch off to chat without any tools — your selection is kept.
                {:else}
                  The agent answers without tools. Switch on to use the selection below.
                {/if}
              </span>
            </span>
          </label>
        {/if}
        <div class="acp-stack transition-opacity {toolsToggle && !toolsToggle.enabled ? 'pointer-events-none opacity-45' : ''}" aria-disabled={toolsToggle ? !toolsToggle.enabled : undefined}>
        <ShellWorkspaceFields bind:config {shellPresets} />
        <ToolDisclosureField bind:rawConfig={config.rawConfig} />
        <div class="acp-field">
        <p class="font-mono text-[10px] text-[var(--cortex-text-muted)] leading-relaxed">
          Quick picks toggle framework tool IDs in <code class="text-[10px]">allowedTools</code>. Conductor meta-tools (brief, find, …) are configured separately below in <strong>Meta tools</strong>.
        </p>
        <div class="grid grid-cols-2 gap-1.5">
          {#each AVAILABLE_TOOLS as tool}
            {@const active = config.tools.includes(tool.id)}
            <button type="button" onclick={() => toggleTool(tool.id)}
              class="flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-mono text-left cursor-pointer transition-all
                     {active ? 'bg-tertiary/10 border-tertiary/30 text-tertiary/90' : 'border-outline-variant/15 text-outline/75 hover:border-outline-variant/30'}">
              <span class="material-symbols-outlined text-[12px]">{tool.icon}</span>
              {tool.label}
            </button>
          {/each}
        </div>
        </div>
        <div class="acp-field">
          <label for="acp-additional-tool-names" class="config-label mb-0">Additional allowed tools</label>
          <textarea
            id="acp-additional-tool-names"
            rows={2}
            bind:value={config.additionalToolNames}
            placeholder="e.g. my-lab-tool, server/http_get (comma or newline)"
            class="config-input font-mono text-[11px] min-h-[2.5rem] resize-y"
          ></textarea>
          <p class="font-mono text-[10px] text-outline/70 leading-relaxed">
            Merged with the toggles above at run time. Use exact tool registration names (see Lab → Tools for MCP and custom tools).
          </p>
        </div>
        <div class="acp-group">
          <div class="flex items-center justify-between gap-2">
            <span class="config-label mb-0">MCP tools <span class="text-outline/70 normal-case font-normal">(from Tools tab)</span></span>
            <button type="button" onclick={() => loadMcpCatalog()}
              class="text-[11px] font-mono text-secondary hover:text-primary bg-transparent border-0 cursor-pointer">↻ Refresh list</button>
          </div>
          {#if mcpCatalog.length === 0}
            <p class="font-mono text-[11px] text-outline/70">No MCP servers saved. Add one under Lab → Tools.</p>
          {:else}
            {#each mcpCatalog as srv}
              <div class="acp-card">
                {#if srv.tools.length > 0}
                  <div class="flex items-center justify-between gap-2">
                    <Tooltip text={selectedIn(srv) === srv.tools.length ? "Click to deselect every tool from this server" : "Click to select every tool from this server"}><button type="button" onclick={() => toggleMcpServer(srv)}
                     
                      class="rounded px-1.5 py-0.5 font-mono text-[11px] cursor-pointer border-0 bg-transparent transition-colors hover:bg-primary/10
                             {selectedIn(srv) === srv.tools.length ? 'text-primary' : 'text-on-surface/80'}">{srv.name}</button></Tooltip>
                    <span class="font-mono text-[11px] text-outline/70">{selectedIn(srv)}/{srv.tools.length} selected</span>
                  </div>
                {:else}
                  <div class="font-mono text-[11px] text-on-surface/80">{srv.name}</div>
                {/if}
                {#if srv.tools.length === 0}
                  <p class="font-mono text-[11px] text-outline/70">No tools cached — run “Refresh tools” in Tools tab.</p>
                {:else}
                  <div class="flex flex-wrap gap-1">
                    {#each srv.tools as mt}
                      {@const active = config.tools.includes(mt.toolName)}
                      <Tooltip text={mt.description ?? ""}><button type="button" onclick={() => toggleMcpRegistryTool(srv.serverId, mt.toolName)}
                       
                        class="px-2 py-1 rounded border text-[11px] font-mono cursor-pointer transition-colors
                               {active ? 'bg-primary/10 border-primary/35 text-primary' : 'border-outline-variant/20 text-outline/75 hover:border-primary/25'}">
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
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox"
              checked={config.dynamicSubAgents?.enabled ?? false}
              onchange={() => (config = {
                ...config,
                dynamicSubAgents: {
                  enabled: !(config.dynamicSubAgents?.enabled ?? false),
                  maxIterations: config.dynamicSubAgents?.maxIterations ?? 8,
                },
              })}
              class="accent-primary w-3.5 h-3.5" />
            <div>
              <div class="font-mono text-[11px] text-on-surface/80">Dynamic sub-agents</div>
              <div class="font-mono text-[11px] text-outline/70">Expose <code class="text-[10px]">spawn-agent</code> for runtime delegation</div>
            </div>
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
