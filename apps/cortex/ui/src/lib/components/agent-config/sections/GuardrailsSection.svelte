<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import GuardrailsFields from "$lib/components/GuardrailsFields.svelte";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();
</script>

<ConfigSection id="guardrails" icon="alert" title="Guardrails" {open} {onToggle}>
  {#snippet head()}
      <Badge tone={config.guardrails.enabled ? "ok" : "neutral"}>{config.guardrails.enabled ? "On" : "Off"}</Badge>
  {/snippet}
        <GuardrailsFields bind:config />
</ConfigSection>
