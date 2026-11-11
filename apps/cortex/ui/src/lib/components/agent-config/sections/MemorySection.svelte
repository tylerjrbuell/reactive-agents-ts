<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import type { PanelAgentConfig } from "../types.js";
  import { debriefSwitchHint, debriefsOn, memoryForDebriefs } from "$lib/debrief-memory.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();
  // Debriefs follow memory (framework rule, `lib/debrief-memory.ts`): the switch
  // reads and writes the tiers below; there is no separate debrief flag.
  const debriefs = $derived(debriefsOn(config.memory));
</script>

<ConfigSection id="memory" icon="folder" title="Memory" {open} {onToggle}>
        <p class="acp-hint">All off = no memory: nothing is stored or recalled across runs.</p>
        <label class="acp-check">
          <input type="checkbox"
            checked={debriefs}
            onchange={(e) => (config = { ...config, memory: memoryForDebriefs(config.memory, (e.currentTarget as HTMLInputElement).checked) })} />
          <span>
            <span class="acp-check-t">Debrief after each run</span>
            <span class="acp-hint">{debriefSwitchHint(config.memory)}</span>
          </span>
        </label>
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
        <div>
          <div class="config-label">Documents (JSON array, RAG)</div>
          <textarea bind:value={config.documents} rows="6" spellcheck="false"
            placeholder={'[\n  { "source": "./docs/README.md", "format": "markdown" }\n]'}
            class="config-input acp-mono"></textarea>
          <p class="mt-1 acp-hint">Optional — ingest documents for retrieval (.withDocuments). Each entry needs source (path) or content.</p>
        </div>
</ConfigSection>
