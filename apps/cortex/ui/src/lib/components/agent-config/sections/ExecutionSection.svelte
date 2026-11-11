<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();
</script>

<ConfigSection id="execution" icon="steps" title="Execution" {open} {onToggle}>
  {#snippet head()}
      <span class="truncate">
        {[
          config.timeout > 0 ? `${Math.round(config.timeout/1000)}s timeout` : null,
          config.retryPolicy.enabled ? `${config.retryPolicy.maxRetries} retries` : null,
        ].filter(Boolean).join(" · ") || "defaults"}
      </span>
  {/snippet}
        <!-- Timeout -->
        <div>
          <label for="execution-timeout" class="config-label">Timeout <span class="text-outline/70 normal-case font-normal">(seconds, 0 = none)</span></label>
          <input id="execution-timeout" type="number" min="0" max="3600" step="5"
            value={Math.round(config.timeout / 1000)}
            oninput={(e) => (config = { ...config, timeout: parseInt((e.target as HTMLInputElement).value || "0") * 1000 })}
            class="config-input" />
        </div>
        <!-- Retry policy -->
        <div class="space-y-2">
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" bind:checked={config.retryPolicy.enabled} class="accent-primary w-3.5 h-3.5" />
            <span class="acp-check-t">Enable retry policy</span>
          </label>
          {#if config.retryPolicy.enabled}
            <div class="grid grid-cols-2 gap-3 pl-5">
              <div>
                <label for="retry-max-retries" class="config-label">Max Retries</label>
                <input id="retry-max-retries" type="number" min="1" max="10"
                  bind:value={config.retryPolicy.maxRetries}
                  class="config-input" />
              </div>
              <div>
                <label for="retry-backoff-ms" class="config-label">Backoff <span class="text-outline/70 normal-case font-normal">(ms)</span></label>
                <input id="retry-backoff-ms" type="number" min="100" max="30000" step="100"
                  bind:value={config.retryPolicy.backoffMs}
                  class="config-input" />
              </div>
            </div>
          {/if}
        </div>
</ConfigSection>
