<script lang="ts">
  /**
   * Shell and workspace as its own section (Lab builder nav): the workspace
   * folder and the host shell options (`.withTools({ workspace, terminal })`).
   * The collapsible panel keeps these inside Tools (`ToolsSection` without
   * `splitShell`); this is the same `ShellWorkspaceFields`, nothing duplicated.
   */
  import ConfigSection from "../ConfigSection.svelte";
  import ShellWorkspaceFields from "$lib/components/ShellWorkspaceFields.svelte";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
    shellPresets: Record<string, string[]>;
  }
  let { config = $bindable(), open, onToggle, shellPresets }: Props = $props();
</script>

<ConfigSection id="shell" icon="shell" title="Shell and workspace" {open} {onToggle}>
  {#snippet head()}
    <span class="truncate">{config.terminalTools ? "Full host shell" : "No full shell"}{config.workspace ? ` · ${config.workspace}` : ""}</span>
  {/snippet}
  <ShellWorkspaceFields bind:config {shellPresets} />
</ConfigSection>
