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

<ConfigSection id="observability" {open} {onToggle}>
  {#snippet head()}
      <span class="material-symbols-outlined text-[15px] text-[var(--cortex-text-muted)] shrink-0" aria-hidden="true">monitoring</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Observability</span>
      <span class="ml-2 rounded-md bg-[color-mix(in_srgb,var(--ra-cyan)_14%,transparent)] px-1.5 py-0.5 text-[11px] font-mono text-secondary">
        {config.observabilityVerbosity}
      </span>
  {/snippet}
        <label for="observability-off" class="config-label">Metrics Dashboard Verbosity</label>
        <div class="acp-field">
          {#each [
            { value: "off",     label: "Off",     desc: "No dashboard output" },
            { value: "minimal", label: "Minimal", desc: "Header card only" },
            { value: "normal",  label: "Normal",  desc: "Dashboard + timeline + tools" },
            { value: "verbose", label: "Verbose", desc: "Dashboard + detailed phase logs" },
          ] as opt}
            <label class="flex items-start gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-surface-container-low/40 transition-colors
                          {config.observabilityVerbosity === opt.value ? 'bg-primary/10 border border-primary/20' : 'border border-transparent'}">
              <input type="radio" name="observability" value={opt.value}
                checked={config.observabilityVerbosity === opt.value}
                onchange={() => (config = { ...config, observabilityVerbosity: opt.value as PanelAgentConfig["observabilityVerbosity"] })}
                class="mt-0.5 accent-primary flex-shrink-0" />
              <div>
                <div class="font-mono text-[11px] font-semibold text-on-surface/80">{opt.label}</div>
                <div class="font-mono text-[11px] text-outline/70">{opt.desc}</div>
              </div>
            </label>
          {/each}
        </div>
        <label class="mt-2 flex items-center gap-3 cursor-pointer">
          <input type="checkbox" class="accent-primary w-3.5 h-3.5"
            checked={config.observability?.checklist !== false}
            onchange={(e) => (config = { ...config, observability: { ...config.observability, checklist: e.currentTarget.checked } })} />
          <div>
            <div class="font-mono text-[11px] text-on-surface/80">Show task checklist</div>
            <div class="font-mono text-[11px] text-outline/70">Live plan card in chat: goal checks and the agent's to-do</div>
          </div>
        </label>
</ConfigSection>
