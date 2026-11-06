<script lang="ts">
  /**
   * Guardrails body for the Lab builder: master switch, the framework's on/off
   * detectors and the custom blocked-phrase list (`.withGuardrails({ injection, pii,
   * toxicity, customBlocklist })`). Field styles cascade in via `.agent-config-panel`.
   */
  import ListField from "$lib/components/ListField.svelte";
  import type { AgentConfig } from "$lib/types/agent-config.js";

  let { config = $bindable() }: { config: AgentConfig } = $props();

  const GUARDRAIL_DETECTORS = [
    { key: "injection", label: "Prompt injection" },
    { key: "pii", label: "Personal data (PII)" },
    { key: "toxicity", label: "Toxicity" },
  ] as const;
</script>

<label class="flex items-center gap-3 cursor-pointer">
  <input type="checkbox" bind:checked={config.guardrails.enabled} class="accent-primary w-3.5 h-3.5" />
  <span class="font-mono text-[11px] text-on-surface/80">Enable guardrails</span>
</label>
{#if config.guardrails.enabled}
  <!-- The framework detectors are on/off (no sensitivity threshold), so these are switches. -->
  <div class="flex flex-wrap gap-x-4 gap-y-1">
    {#each GUARDRAIL_DETECTORS as g (g.key)}
      <label class="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-on-surface/80">
        <input type="checkbox" class="accent-primary w-3.5 h-3.5" checked={config.guardrails[g.key] !== false}
          onchange={(e) => (config = { ...config, guardrails: { ...config.guardrails, [g.key]: (e.currentTarget as HTMLInputElement).checked } })} />
        {g.label}
      </label>
    {/each}
  </div>
  <div>
    <label for="guardrail-blocklist" class="config-label">Blocked phrases</label>
    <ListField id="guardrail-blocklist" mode="list" value={config.guardrails.customBlocklist ?? []} placeholder="Phrase to block, then Enter"
      onChange={(next) => (config = { ...config, guardrails: { ...config.guardrails, customBlocklist: Array.isArray(next) ? next : [] } })} />
  </div>
{/if}
