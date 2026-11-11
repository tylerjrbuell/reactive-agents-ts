<script lang="ts">
  /**
   * All framework options as its own section (Lab builder nav): the generic
   * renderer driven by the framework's capability manifest
   * (`AdvancedFrameworkConfig`, writes `rawConfig`). The collapsible panel keeps
   * it inside Reasoning (`StrategySection` without `splitFramework`).
   */
  import ConfigSection from "../ConfigSection.svelte";
  import AdvancedFrameworkConfig from "$lib/components/AdvancedFrameworkConfig.svelte";
  import type { CapabilityManifest } from "$lib/capabilities.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
    manifest: CapabilityManifest | null;
  }
  let { config = $bindable(), open, onToggle, manifest }: Props = $props();
</script>

<ConfigSection id="framework" icon="settings" title="Framework options" {open} {onToggle}>
  {#if manifest}
    <AdvancedFrameworkConfig {manifest} expanded bind:rawConfig={config.rawConfig} />
  {:else}
    <p class="acp-hint" role="status">Loading the framework's option list…</p>
  {/if}
</ConfigSection>
