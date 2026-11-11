<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import GuardrailsFields from "$lib/components/GuardrailsFields.svelte";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();
</script>

<ConfigSection id="guardrails" {open} {onToggle}>
  {#snippet head()}
      <span class="material-symbols-outlined text-[15px] text-error/75 shrink-0" aria-hidden="true">security</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Guardrails</span>
      <span class="ml-2 rounded-md px-1.5 py-0.5 text-[11px] font-mono {config.guardrails.enabled ? 'bg-[color-mix(in_srgb,var(--ra-green)_20%,transparent)] text-[var(--ra-green)]' : 'bg-[var(--cortex-surface-mid)] text-[var(--cortex-text-muted)]'}">
        {config.guardrails.enabled ? "on" : "off"}
      </span>
  {/snippet}
        <GuardrailsFields bind:config />
</ConfigSection>
