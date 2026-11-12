<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import FieldEditor from "../FieldEditor.svelte";
  import { VARIABLE_FIELD_TYPES } from "$lib/field-editor.js";
  import type { VariableDef } from "$lib/types/agent-config.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();

  // Names come from the `{{tokens}}` in the config (AgentConfigPanel keeps them in sync), so the
  // editor locks them; the rest (type, default, description, required) is edited like any field.
  function setVariables(variables: VariableDef[]) {
    config = { ...config, variables };
  }
</script>

<ConfigSection id="variables" icon="code" title="Variables" {open} {onToggle}>
  {#snippet head()}
      <span>{(config.variables ?? []).length} detected</span>
  {/snippet}
  <p class="acp-hint leading-relaxed">
    Use <code>{'{{name}}'}</code> in any field — variables are detected automatically. Values are filled per run.
  </p>
  {#if (config.variables ?? []).length === 0}
    <p class="acp-hint">No variables yet. Add a <code>{'{{name}}'}</code> token to any field above and it appears here automatically.</p>
  {:else}
    <FieldEditor fields={config.variables ?? []} types={VARIABLE_FIELD_TYPES} onChange={setVariables} lockNames showDefault idPrefix="var" />
  {/if}
</ConfigSection>
