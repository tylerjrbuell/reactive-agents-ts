<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Select from "$lib/components/kit/Select.svelte";
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

<ConfigSection id="persona" icon="chat" title="Persona" {open} {onToggle}>
  {#snippet head()}
      <Badge tone={config.persona?.enabled ? "accent" : "neutral"}>{config.persona?.enabled ? (config.persona.role?.trim() || "Custom") : "Off"}</Badge>
  {/snippet}
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox"
            checked={config.persona?.enabled ?? false}
            onchange={() => (config = { ...config, persona: { ...(config.persona ?? { role: "", tone: "concise", traits: "", responseStyle: "prose" }), enabled: !(config.persona?.enabled ?? false) } })}
            class="accent-accent-fill w-3.5 h-3.5" />
          <div>
            <div class="acp-check-t">Enable persona</div>
            <div class="acp-hint">Shape agent behaviour with a named role and communication style</div>
          </div>
        </label>
        {#if config.persona?.enabled}
          <div>
            <label for="persona-role" class="config-label">Role <span class="text-text-3/70 normal-case font-normal">(e.g. research assistant, code reviewer)</span></label>
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
              <Select
                id="persona-tone"
                value={config.persona.tone}
                onchange={(v) => (config = { ...config, persona: { ...config.persona, tone: v as AgentConfig["persona"]["tone"] } })}
                class="config-input"
                options={[
                  { value: "concise", label: "Concise", description: "Brief, direct" },
                  { value: "formal", label: "Formal", description: "Professional" },
                  { value: "casual", label: "Casual", description: "Conversational" },
                  { value: "technical", label: "Technical", description: "Precise, expert" },
                ]} />
            </div>
            <div>
              <label for="persona-response-style" class="config-label">Response Style</label>
              <Select
                id="persona-response-style"
                value={config.persona.responseStyle}
                onchange={(v) => (config = { ...config, persona: { ...config.persona, responseStyle: v as AgentConfig["persona"]["responseStyle"] } })}
                class="config-input"
                options={[
                  { value: "prose", label: "Prose", description: "Narrative paragraphs" },
                  { value: "bullet-points", label: "Bullets", description: "Scannable lists" },
                  { value: "structured", label: "Structured", description: "Headers and sections" },
                ]} />
            </div>
          </div>
          <div>
            <label for="persona-traits" class="config-label">Traits <span class="text-text-3/70 normal-case font-normal">(comma-separated, e.g. analytical, thorough, skeptical)</span></label>
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
