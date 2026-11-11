<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import { defaultConfig, type CortexAgentToolConfig } from "$lib/types/agent-config.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();

  function addLocalAgentTool() {
    const base = defaultConfig();
    const n = (config.agentTools ?? base.agentTools).length + 1;
    const entry: CortexAgentToolConfig = {
      kind: "local",
      toolName: `researcher_${n}`,
      agent: { name: `Researcher ${n}`, maxIterations: 8, tools: ["web-search"] },
    };
    config = { ...config, agentTools: [...(config.agentTools ?? base.agentTools), entry] };
  }

  function addRemoteAgentTool() {
    const base = defaultConfig();
    const entry: CortexAgentToolConfig = {
      kind: "remote",
      toolName: `remote_agent_${(config.agentTools ?? base.agentTools).length + 1}`,
      remoteUrl: "http://127.0.0.1:8000",
    };
    config = { ...config, agentTools: [...(config.agentTools ?? base.agentTools), entry] };
  }

  function removeAgentToolAt(index: number) {
    const base = defaultConfig();
    const agentTools = [...(config.agentTools ?? base.agentTools)];
    agentTools.splice(index, 1);
    config = { ...config, agentTools };
  }

  function patchAgentTool(index: number, next: CortexAgentToolConfig) {
    const base = defaultConfig();
    const agentTools = [...(config.agentTools ?? base.agentTools)];
    agentTools[index] = next;
    config = { ...config, agentTools };
  }
</script>

<ConfigSection id="subagents" {open} {onToggle}>
  {#snippet head()}
      <span class="material-symbols-outlined text-[15px] text-primary/80 shrink-0" aria-hidden="true">hub</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Sub-agents</span>
      <span class="ml-2 font-mono text-[11px] text-[var(--cortex-text-muted)]">{(config.agentTools ?? []).length} registered</span>
  {/snippet}
        <div class="flex flex-wrap gap-2">
          <button type="button" onclick={addLocalAgentTool}
            class="text-[11px] font-mono px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 cursor-pointer bg-transparent">+ Local sub-agent</button>
          <button type="button" onclick={addRemoteAgentTool}
            class="text-[11px] font-mono px-2 py-1 rounded border border-secondary/30 text-secondary hover:bg-secondary/10 cursor-pointer bg-transparent">+ Remote (A2A URL)</button>
        </div>
        {#each config.agentTools ?? [] as at, i (i)}
          <div class="acp-card">
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-[11px] text-outline/70 uppercase">#{i + 1}</span>
              <button type="button" onclick={() => removeAgentToolAt(i)}
                class="text-[11px] font-mono text-error/70 hover:text-error bg-transparent border-0 cursor-pointer">Remove</button>
            </div>
            {#if at.kind === "remote"}
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="config-label" for={`subagent-r-${i}-tool`}>Tool name</label>
                  <input id={`subagent-r-${i}-tool`} class="config-input" value={at.toolName}
                    oninput={(e) => patchAgentTool(i, { ...at, toolName: (e.target as HTMLInputElement).value })} />
                </div>
                <div class="col-span-2">
                  <label class="config-label" for={`subagent-r-${i}-url`}>Remote URL</label>
                  <input id={`subagent-r-${i}-url`} class="config-input font-mono text-[11px]" value={at.remoteUrl}
                    oninput={(e) => patchAgentTool(i, { ...at, remoteUrl: (e.target as HTMLInputElement).value })} />
                </div>
              </div>
            {:else}
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="config-label" for={`subagent-l-${i}-tool`}>Tool name</label>
                  <input id={`subagent-l-${i}-tool`} class="config-input" value={at.toolName}
                    oninput={(e) => patchAgentTool(i, { ...at, toolName: (e.target as HTMLInputElement).value })} />
                </div>
                <div>
                  <label class="config-label" for={`subagent-l-${i}-display`}>Display name</label>
                  <input id={`subagent-l-${i}-display`} class="config-input" value={at.agent.name}
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, name: (e.target as HTMLInputElement).value } })} />
                </div>
                <div class="col-span-2">
                  <label class="config-label" for={`subagent-l-${i}-desc`}>Description</label>
                  <input id={`subagent-l-${i}-desc`} class="config-input" value={at.agent.description ?? ""}
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, description: (e.target as HTMLInputElement).value } })} />
                </div>
                <div>
                  <label class="config-label" for={`subagent-l-${i}-provider`}>Provider <span class="normal-case text-outline/70">(optional)</span></label>
                  <input id={`subagent-l-${i}-provider`} class="config-input" value={at.agent.provider ?? ""} placeholder="inherit"
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, provider: (e.target as HTMLInputElement).value || undefined } })} />
                </div>
                <div>
                  <label class="config-label" for={`subagent-l-${i}-model`}>Model <span class="normal-case text-outline/70">(optional)</span></label>
                  <input id={`subagent-l-${i}-model`} class="config-input" value={at.agent.model ?? ""} placeholder="inherit"
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, model: (e.target as HTMLInputElement).value || undefined } })} />
                </div>
                <div>
                  <label class="config-label" for={`subagent-l-${i}-maxiter`}>Max iterations</label>
                  <input id={`subagent-l-${i}-maxiter`} type="number" min="1" max="50" class="config-input" value={at.agent.maxIterations ?? 8}
                    oninput={(e) => patchAgentTool(i, {
                      ...at,
                      agent: { ...at.agent, maxIterations: Math.max(1, parseInt((e.target as HTMLInputElement).value || "8", 10)) },
                    })} />
                </div>
                <div class="col-span-2">
                  <label class="config-label" for={`subagent-l-${i}-tools`}>Sub-agent tools <span class="normal-case text-outline/70">(comma-separated)</span></label>
                  <input id={`subagent-l-${i}-tools`} class="config-input font-mono text-[11px]"
                    value={(at.agent.tools ?? []).join(", ")}
                    oninput={(e) => {
                      const raw = (e.target as HTMLInputElement).value;
                      const tools = raw.split(",").map((s) => s.trim()).filter(Boolean);
                      patchAgentTool(i, { ...at, agent: { ...at.agent, tools: tools.length ? tools : undefined } });
                    }} />
                </div>
                <div class="col-span-2">
                  <label class="config-label" for={`subagent-l-${i}-sysprompt`}>System prompt</label>
                  <textarea id={`subagent-l-${i}-sysprompt`} rows="2" class="config-input resize-none" value={at.agent.systemPrompt ?? ""}
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, systemPrompt: (e.target as HTMLInputElement).value || undefined } })}></textarea>
                </div>
              </div>
            {/if}
          </div>
        {/each}
</ConfigSection>
