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

<ConfigSection id="memory" icon="folder" title="Memory" {open} {onToggle}>
        <p class="acp-hint">All off = no memory: nothing is stored or recalled across runs.</p>
        {#each [
          { key: "working",  label: "Working Memory",  desc: "Short-term context within the run" },
          { key: "episodic", label: "Episodic Memory",  desc: "Stores run history for future recall" },
          { key: "semantic", label: "Semantic Memory",  desc: "Vector store for similarity search" },
        ] as tier}
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox"
              checked={config.memory[tier.key as keyof typeof config.memory]}
              onchange={() => (config = { ...config, memory: { ...config.memory, [tier.key]: !config.memory[tier.key as keyof typeof config.memory] } })}
              class="accent-accent-fill w-3.5 h-3.5" />
            <div>
              <div class="acp-check-t">{tier.label}</div>
              <div class="acp-hint">{tier.desc}</div>
            </div>
          </label>
        {/each}
        <div class="pt-1">
          <label for="context-synthesis" class="config-label">Context Synthesis</label>
          <select id="context-synthesis" bind:value={config.contextSynthesis} class="config-input">
            <option value="auto">Auto — framework decides</option>
            <option value="template">Template — fast, rule-based</option>
            <option value="llm">LLM — deep synthesis call</option>
            <option value="none">None — raw context</option>
          </select>
        </div>
</ConfigSection>
