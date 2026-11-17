<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import McpDisabledNote from "$lib/components/McpDisabledNote.svelte";
  import McpServerAttach from "$lib/components/McpServerAttach.svelte";
  import { availableMcpServers, disabledInUse } from "$lib/mcp-servers-view.js";
  import ShellWorkspaceFields from "$lib/components/ShellWorkspaceFields.svelte";
  import ToolDisclosureField from "$lib/components/ToolDisclosureField.svelte";
  import WebSearchProvidersField from "$lib/components/WebSearchProvidersField.svelte";
  import ApprovalPolicyFields from "../ApprovalPolicyFields.svelte";
  import { mcpToolAvailable } from "$lib/tool-selection.js";
  import { disclosureChoice, unlistedTools } from "$lib/chat-quickbar.js";
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
    /** Show another panel section (the approvals note links to Execution's durable-runs switch). */
    onShowSection?: (sectionId: string) => void;
  }
  let { config = $bindable(), open, onToggle, toolsToggle, tools: AVAILABLE_TOOLS, shellPresets, mcpCatalog, loadMcpCatalog, splitShell = false, onShowSection }: Props = $props();

  function toggleTool(id: string) {
    const tools = config.tools.includes(id)
      ? config.tools.filter((t) => t !== id)
      : [...config.tools, id];
    config = { ...config, tools };
  }

  /** What an agent can use (enabled servers); a switched-off server is never offered here. */
  const availableServers = $derived(availableMcpServers(mcpCatalog));
  /** Switched-off servers this config still lists: the build skips them, so the note says so. */
  const skippedServers = $derived(disabledInUse(mcpCatalog, config.mcpServerIds ?? []));

  /**
   * Selected names no chip above shows (`calculator` from an old config): listed
   * so they can be removed. MCP names (`server/tool`) wait for the MCP list.
   */
  const unlisted = $derived(
    unlistedTools(
      { tools: config.tools },
      {
        builtinTools: AVAILABLE_TOOLS.map((t) => ({ name: t.id })),
        toolsets: {},
        // Enabled servers only: a name from a switched-off server stays selected but is listed below to remove.
        mcpServers: availableServers.map((s) => ({ tools: s.tools.map((t) => t.toolName) })),
      },
    ).filter((n) => mcpCatalog.length > 0 || !n.includes("/")),
  );

  /** Host shell opt-in adds `shell-execute` at run time even if not in `config.tools`. */
  const toolCountForBadges = $derived.by(() => {
    const names = new Set(config.tools);
    if (config.terminalTools) names.add("shell-execute");
    // Tools of an attached server count even when none is named: they are all available.
    for (const srv of mcpCatalog) {
      if (srv.enabled === false) continue; // a switched-off server is never started
      for (const t of srv.tools) if (mcpToolAvailable(config, asServer(srv), t.toolName)) names.add(t.toolName);
    }
    return names.size;
  });

  // Attach rules (attached = every tool, naming tools = a subset): lib/tool-selection.ts, wired in McpServerAttach.
  const asServer = (srv: McpCatalogRow) => ({ serverId: srv.serverId, tools: srv.tools.map((t) => t.toolName) });
</script>

<ConfigSection id="tools" icon="tool" title="Tools" {open} {onToggle}>
  {#snippet head()}
      <Badge tone={toolsToggle && !toolsToggle.enabled ? "neutral" : "io"}>{toolsToggle && !toolsToggle.enabled ? "Off" : `${toolCountForBadges} selected`}</Badge>
      <!-- A stored disclosure mode shows while the section is closed; the default stays quiet. -->
      {#if disclosureChoice({ rawConfig: config.rawConfig })}<Badge tone="neutral">Disclosure: {disclosureChoice({ rawConfig: config.rawConfig })}</Badge>{/if}
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
        <ToolDisclosureField bind:rawConfig={config.rawConfig} tools={config.tools} />
        <WebSearchProvidersField bind:rawConfig={config.rawConfig} />
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
        {#if unlisted.length > 0}
          <div class="acp-field">
            <span class="config-label">Also selected</span>
            <div class="acp-chips" role="group" aria-label="Selected tools not in the lists">
              {#each unlisted as name (name)}
                <button type="button" class="acp-toolchip" aria-pressed="true" use:tooltip={`Remove ${name}`} onclick={() => toggleTool(name)}>
                  <Icon name="x" size="sm" />
                  {name}
                </button>
              {/each}
            </div>
            <p class="acp-hint">Selected in this config but not a tool Cortex lists (an old or imported config, or a removed or switched-off MCP server). Click to remove.</p>
          </div>
        {/if}
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
        <McpServerAttach bind:config servers={availableServers} onRefresh={loadMcpCatalog} />
        <McpDisabledNote servers={skippedServers} onChanged={loadMcpCatalog} />
        <!-- Approvals gate tool calls, so they sit with the tools they gate. -->
        <ApprovalPolicyFields bind:config />
        <p class="acp-hint" data-testid="approval-durable-note">
          A run that waits for your approval stays live until you answer. To keep that wait across a restart, turn on durable execution under
          {#if onShowSection}<button type="button" class="acp-linkbtn" onclick={() => onShowSection("execution")}>Execution</button>{:else}Execution{/if}.
        </p>
        </div>
</ConfigSection>
