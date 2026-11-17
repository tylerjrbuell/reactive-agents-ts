<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import CalibrationTiers from "../CalibrationTiers.svelte";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();
</script>

<ConfigSection id="reliability" icon="goal" title="Reliability" {open} {onToggle}>
  {#snippet head()}
      <span>
        {config.fallbacks.enabled ? `${config.fallbacks.providers.length} fallback${config.fallbacks.providers.length !== 1 ? 's' : ''}` : 'off'}
      </span>
  {/snippet}
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" bind:checked={config.fallbacks.enabled} class="accent-accent-fill w-3.5 h-3.5" />
          <div>
            <div class="acp-check-t">Enable provider fallbacks</div>
            <div class="acp-hint">Automatically switch to a backup provider on errors</div>
          </div>
        </label>
        {#if config.fallbacks.enabled}
          <div>
            <label for="fallback-providers" class="config-label">Fallback Providers <span class="text-text-3/70 normal-case font-normal">(comma-separated, e.g. openai, gemini)</span></label>
            <input
              id="fallback-providers"
              value={config.fallbacks.providers.join(", ")}
              oninput={(e) => (config = { ...config, fallbacks: { ...config.fallbacks, providers: (e.target as HTMLInputElement).value.split(",").map(s => s.trim()).filter(Boolean) } })}
              placeholder="openai, gemini, ollama"
              class="config-input" />
          </div>
          <div>
            <label for="fallback-error-threshold" class="config-label flex items-center justify-between">
              Error Threshold
              <span class="font-mono text-accent tabular-nums">{config.fallbacks.errorThreshold}</span>
            </label>
            <input id="fallback-error-threshold" type="range" min="1" max="10"
              bind:value={config.fallbacks.errorThreshold}
              class="w-full accent-accent-fill" />
            <div class="flex justify-between acp-hint mt-0.5">
              <span>1 — switch on first error</span><span>10 — very tolerant</span>
            </div>
          </div>
        {/if}
        <CalibrationTiers bind:config />
</ConfigSection>
