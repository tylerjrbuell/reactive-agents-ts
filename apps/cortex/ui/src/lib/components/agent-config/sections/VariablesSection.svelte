<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import type { VariableDef } from "$lib/types/agent-config.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();

  function patchVariable(index: number, next: VariableDef) {
    const variables = [...(config.variables ?? [])];
    variables[index] = next;
    config = { ...config, variables };
  }
</script>

<ConfigSection id="variables" {open} {onToggle}>
  {#snippet head()}
      <span class="material-symbols-outlined text-[15px] text-tertiary/90 shrink-0" aria-hidden="true">data_object</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Variables</span>
      <span class="ml-2 font-mono text-[11px] text-[var(--cortex-text-muted)]">{(config.variables ?? []).length} detected</span>
  {/snippet}
        <p class="font-mono text-[10px] text-[var(--cortex-text-muted)] leading-relaxed">
          Use <code class="text-[10px]">{'{{name}}'}</code> in any field — variables are detected automatically. Values are filled per run.
        </p>
        {#if (config.variables ?? []).length === 0}
          <p class="font-mono text-[11px] text-outline/70">No variables yet. Add a <code class="text-[10px]">{'{{name}}'}</code> token to any field above and it appears here automatically.</p>
        {:else}
          {#each config.variables ?? [] as v, i (v.name)}
            <div class="acp-card">
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-[11px] font-semibold text-tertiary">{v.name}</span>
                <label class="flex items-center gap-1.5 cursor-pointer font-mono text-[11px] text-on-surface/70">
                  <input type="checkbox" checked={v.required}
                    onchange={(e) => patchVariable(i, { ...v, required: (e.currentTarget as HTMLInputElement).checked })}
                    class="accent-tertiary w-3 h-3" />
                  required
                </label>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="config-label" for={`var-${i}-type`}>Type</label>
                  <select id={`var-${i}-type`} class="config-input"
                    value={v.type}
                    onchange={(e) => patchVariable(i, { ...v, type: (e.currentTarget as HTMLSelectElement).value as VariableDef["type"] })}>
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="enum">enum</option>
                    <option value="multiline">multiline</option>
                  </select>
                </div>
                <div>
                  <label class="config-label" for={`var-${i}-default`}>Default <span class="text-outline/70 normal-case font-normal">(optional)</span></label>
                  <input id={`var-${i}-default`} class="config-input"
                    placeholder="default value"
                    value={v.default ?? ""}
                    oninput={(e) => patchVariable(i, { ...v, default: (e.currentTarget as HTMLInputElement).value })} />
                </div>
                {#if v.type === "enum"}
                  <div class="col-span-2">
                    <label class="config-label" for={`var-${i}-enum`}>Allowed values <span class="text-outline/70 normal-case font-normal">(comma-separated)</span></label>
                    <input id={`var-${i}-enum`} class="config-input font-mono text-[11px]"
                      placeholder="comma,separated,values"
                      value={(v.enumValues ?? []).join(",")}
                      oninput={(e) => patchVariable(i, { ...v, enumValues: (e.currentTarget as HTMLInputElement).value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                  </div>
                {/if}
                <div class="col-span-2">
                  <label class="config-label" for={`var-${i}-desc`}>Description <span class="text-outline/70 normal-case font-normal">(optional)</span></label>
                  <input id={`var-${i}-desc`} class="config-input"
                    placeholder="What this variable controls…"
                    value={v.description ?? ""}
                    oninput={(e) => patchVariable(i, { ...v, description: (e.currentTarget as HTMLInputElement).value })} />
                </div>
              </div>
            </div>
          {/each}
        {/if}
</ConfigSection>
