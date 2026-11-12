<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import type { PanelAgentConfig } from "../types.js";
  import { debriefSwitchHint, debriefsOn, rawConfigForDebriefs } from "$lib/debrief-memory.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();
  // Debrief = `rawConfig.debrief ?? memory on` (framework `isDebriefEnabled`,
  // `lib/debrief-memory.ts`): the switch writes `rawConfig.debrief`, never the tiers.
  const debriefs = $derived(debriefsOn(config.memory, config.rawConfig));
</script>

<ConfigSection id="memory" icon="folder" title="Memory" {open} {onToggle}>
        <p class="acp-hint">All off = no memory: nothing is stored or recalled across runs.</p>
        <label class="acp-check">
          <input type="checkbox"
            checked={debriefs}
            onchange={(e) => (config = { ...config, rawConfig: rawConfigForDebriefs(config.memory, config.rawConfig, (e.currentTarget as HTMLInputElement).checked) })} />
          <span>
            <span class="acp-check-t">Debrief after each run</span>
            <span class="acp-hint">{debriefSwitchHint(config.memory, config.rawConfig)}</span>
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
          <Select
            id="context-synthesis"
            class="config-input"
            bind:value={() => config.contextSynthesis, (v) => (config.contextSynthesis = v as PanelAgentConfig["contextSynthesis"])}
            options={[
              { value: "auto", label: "Auto", description: "Framework decides" },
              { value: "template", label: "Template", description: "Fast, rule-based" },
              { value: "llm", label: "LLM", description: "Deep synthesis call" },
              { value: "none", label: "None", description: "Raw context" },
            ]} />
        </div>
        <div>
          <div class="config-label">Documents (JSON array, RAG)</div>
          <textarea bind:value={config.documents} rows="6" spellcheck="false"
            placeholder={'[\n  { "source": "./docs/README.md", "format": "markdown" }\n]'}
            class="config-input acp-mono"></textarea>
          <p class="mt-1 acp-hint">Optional — ingest documents for retrieval (.withDocuments). Each entry needs source (path) or content.</p>
        </div>
</ConfigSection>
