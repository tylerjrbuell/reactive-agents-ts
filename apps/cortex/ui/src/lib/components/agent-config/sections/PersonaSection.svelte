<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import HighlightedField from "$lib/components/HighlightedField.svelte";
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();
</script>

<ConfigSection id="persona" {open} {onToggle}>
  {#snippet head()}
      <span class="material-symbols-outlined text-[15px] text-secondary/85 shrink-0" aria-hidden="true">face</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Persona</span>
      <span class="ml-2 rounded-md bg-[color-mix(in_srgb,var(--ra-cyan)_14%,transparent)] px-1.5 py-0.5 text-[11px] font-mono text-secondary">
        {config.persona?.enabled ? (config.persona.role?.trim() || "custom") : "off"}
      </span>
  {/snippet}
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox"
            checked={config.persona?.enabled ?? false}
            onchange={() => (config = { ...config, persona: { ...(config.persona ?? { role: "", tone: "concise", traits: "", responseStyle: "prose" }), enabled: !(config.persona?.enabled ?? false) } })}
            class="accent-primary w-3.5 h-3.5" />
          <div>
            <div class="font-mono text-[11px] text-on-surface/80">Enable persona</div>
            <div class="font-mono text-[11px] text-outline/70">Shape agent behaviour with a named role and communication style</div>
          </div>
        </label>
        {#if config.persona?.enabled}
          <div>
            <label for="persona-role" class="config-label">Role <span class="text-outline/70 normal-case font-normal">(e.g. research assistant, code reviewer)</span></label>
            <HighlightedField
              id="persona-role"
              value={config.persona.role}
              oninput={(e) => (config = { ...config, persona: { ...config.persona, role: (e.target as HTMLInputElement).value } })}
              placeholder="e.g. senior research analyst"
              frameClass="ci-frame" textClass="ci-text" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="persona-tone" class="config-label">Tone</label>
              <select
                id="persona-tone"
                value={config.persona.tone}
                onchange={(e) => (config = { ...config, persona: { ...config.persona, tone: (e.target as HTMLSelectElement).value as AgentConfig["persona"]["tone"] } })}
                class="config-input">
                <option value="concise">Concise — brief, direct</option>
                <option value="formal">Formal — professional</option>
                <option value="casual">Casual — conversational</option>
                <option value="technical">Technical — precise, expert</option>
              </select>
            </div>
            <div>
              <label for="persona-response-style" class="config-label">Response Style</label>
              <select
                id="persona-response-style"
                value={config.persona.responseStyle}
                onchange={(e) => (config = { ...config, persona: { ...config.persona, responseStyle: (e.target as HTMLSelectElement).value as AgentConfig["persona"]["responseStyle"] } })}
                class="config-input">
                <option value="prose">Prose — narrative paragraphs</option>
                <option value="bullet-points">Bullets — scannable lists</option>
                <option value="structured">Structured — headers + sections</option>
              </select>
            </div>
          </div>
          <div>
            <label for="persona-traits" class="config-label">Traits <span class="text-outline/70 normal-case font-normal">(comma-separated, e.g. analytical, thorough, skeptical)</span></label>
            <HighlightedField
              multiline
              id="persona-traits"
              value={config.persona.traits}
              oninput={(e) => (config = { ...config, persona: { ...config.persona, traits: (e.target as HTMLTextAreaElement).value } })}
              placeholder="e.g. analytical, methodical, skeptical of unverified claims"
              rows={2}
              frameClass="ci-frame" textClass="ci-text resize-none" />
          </div>
        {/if}
</ConfigSection>
