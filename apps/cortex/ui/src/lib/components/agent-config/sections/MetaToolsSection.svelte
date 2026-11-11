<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import { todoGuidanceOn, setTodoGuidance } from "$lib/todo-guidance.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();
</script>

<ConfigSection id="metatools" icon="bolt" title="Meta tools" {open} {onToggle}>
  {#snippet head()}
      <span class="truncate">
        {config.metaTools.enabled
          ? [config.metaTools.brief && 'brief', config.metaTools.find && 'find', config.metaTools.pulse && 'pulse', config.metaTools.recall && 'recall', config.metaTools.todo && 'to-do'].filter(Boolean).join(', ') || 'none active'
          : 'off'}
      </span>
  {/snippet}
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" bind:checked={config.metaTools.enabled} class="accent-primary w-3.5 h-3.5" />
          <div>
            <div class="acp-check-t">Enable Conductor's Suite</div>
            <div class="acp-hint">Give the agent self-awareness and intelligence tools</div>
          </div>
        </label>
        {#if config.metaTools.enabled}
          <div class="grid grid-cols-2 gap-1.5 pl-1 pt-1">
            {#each [
              { key: "brief",       label: "Brief",        desc: "Situational overview" },
              { key: "find",        label: "Find",         desc: "RAG→memory→web routing" },
              { key: "pulse",       label: "Pulse",        desc: "Entropy introspection" },
              { key: "recall",      label: "Recall",       desc: "Selective working memory" },
              { key: "harnessSkill",label: "Harness Skill",desc: "Built-in conductor workflow" },
              { key: "todo",        label: "To-do list",   desc: "Agent keeps its own to-do list (shown in the plan card). On by default for chat" },
            ] as mt}
              <label class="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-surface-container-low/40 transition-colors
                            {config.metaTools[mt.key as keyof typeof config.metaTools] ? 'bg-secondary/10 border border-secondary/20' : 'border border-transparent'}">
                <input type="checkbox"
                  checked={config.metaTools[mt.key as keyof typeof config.metaTools] as boolean}
                  onchange={() => (config = { ...config, metaTools: { ...config.metaTools, [mt.key]: !config.metaTools[mt.key as keyof typeof config.metaTools] } })}
                  class="accent-secondary w-3 h-3 flex-shrink-0" />
                <div>
                  <div class="acp-check-t">{mt.label}</div>
                  <div class="acp-hint">{mt.desc}</div>
                </div>
              </label>
            {/each}
            <label class="col-span-2 flex items-center gap-2 p-2 ml-5 rounded-lg border border-transparent transition-colors
                          {config.metaTools.todo ? 'cursor-pointer hover:bg-surface-container-low/40' : 'opacity-40 cursor-not-allowed'}">
              <input type="checkbox" id="acp-todo-guidance"
                disabled={!config.metaTools.todo}
                checked={todoGuidanceOn(config.metaTools)}
                onchange={() => (config = { ...config, metaTools: setTodoGuidance(config.metaTools, !todoGuidanceOn(config.metaTools)) })}
                class="accent-secondary w-3 h-3 flex-shrink-0" />
              <div>
                <div class="acp-check-t">Keep to-do list current</div>
                <div class="acp-hint">Nudges the agent to update its to-do list as it works. Experimental — adds a short system line and an occasional reminder.</div>
              </div>
            </label>
          </div>
        {/if}
</ConfigSection>
