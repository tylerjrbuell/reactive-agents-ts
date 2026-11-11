<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import Button from "$lib/components/kit/Button.svelte";
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

  // ── Dynamic sub-agents (`.withDynamicSubAgents`) ───────────────────────
  const dynamic = $derived(config.dynamicSubAgents ?? { enabled: false, maxIterations: 8 });

  function patchDynamic(next: Partial<PanelAgentConfig["dynamicSubAgents"]>) {
    config = { ...config, dynamicSubAgents: { ...dynamic, maxIterations: dynamic.maxIterations ?? 8, ...next } };
  }

  /** Empty or 0 = unset: spawned agents get no spawn tool of their own (the framework default). */
  function setRecursionDepth(raw: string) {
    const n = parseInt(raw, 10);
    patchDynamic({ maxRecursionDepth: Number.isFinite(n) && n > 0 ? n : undefined });
  }
</script>

<ConfigSection id="subagents" icon="agents" title="Sub-agents" {open} {onToggle}>
  {#snippet head()}
      <span>{(config.agentTools ?? []).length} registered{dynamic.enabled ? " · spawn on" : ""}</span>
  {/snippet}
        <div class="acp-group">
          <label class="acp-check">
            <input type="checkbox"
              checked={dynamic.enabled}
              onchange={() => patchDynamic({ enabled: !dynamic.enabled })} />
            <span>
              <span class="acp-check-t">Dynamic sub-agents</span>
              <span class="acp-hint">Gives the agent <code>spawn-agent</code> to hand work to a new agent while it runs.</span>
            </span>
          </label>
          {#if dynamic.enabled}
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label for="dyn-sub-max" class="config-label">Spawn max iterations</label>
                <input id="dyn-sub-max" type="number" min="1" max="50" step="1"
                  value={dynamic.maxIterations ?? 8}
                  oninput={(e) => patchDynamic({
                    enabled: true,
                    maxIterations: Math.max(1, parseInt((e.target as HTMLInputElement).value || "8", 10)),
                  })}
                  class="config-input" />
              </div>
              <div>
                <label for="dyn-sub-depth" class="config-label">Nested spawning depth</label>
                <input id="dyn-sub-depth" type="number" min="1" max="10" step="1"
                  placeholder="off"
                  value={dynamic.maxRecursionDepth ?? ""}
                  oninput={(e) => setRecursionDepth((e.target as HTMLInputElement).value)}
                  class="config-input acp-mono" />
              </div>
            </div>
            <p class="acp-hint">
              Empty: spawned agents cannot spawn their own. A number lets them hand work on, up to that many levels deep (<code>maxRecursionDepth</code>).
            </p>
          {/if}
        </div>
        <span class="config-label mb-0">Named sub-agents</span>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" icon="plus" onclick={addLocalAgentTool}>Local sub-agent</Button>
          <Button size="sm" icon="plus" onclick={addRemoteAgentTool}>Remote agent (A2A URL)</Button>
        </div>
        {#each config.agentTools ?? [] as at, i (i)}
          <div class="acp-card">
            <div class="flex items-center justify-between gap-2">
              <span class="acp-check-t">{at.kind === "remote" ? "Remote agent" : "Local sub-agent"} {i + 1}</span>
              <Button size="sm" variant="danger" icon="trash" onclick={() => removeAgentToolAt(i)}>Remove</Button>
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
                  <label class="config-label" for={`subagent-l-${i}-provider`}>Provider <span class="normal-case text-text-3/70">(optional)</span></label>
                  <input id={`subagent-l-${i}-provider`} class="config-input" value={at.agent.provider ?? ""} placeholder="inherit"
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, provider: (e.target as HTMLInputElement).value || undefined } })} />
                </div>
                <div>
                  <label class="config-label" for={`subagent-l-${i}-model`}>Model <span class="normal-case text-text-3/70">(optional)</span></label>
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
                  <label class="config-label" for={`subagent-l-${i}-tools`}>Sub-agent tools <span class="normal-case text-text-3/70">(comma-separated)</span></label>
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
