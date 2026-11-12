<script lang="ts">
  /**
   * Output schema: the typed object the agent returns. Edited as fields (name, type,
   * description, required; FieldEditor) or as JSON Schema; the config keeps the JSON text
   * (`outputSchema` → AgentConfig `outputSchema`, `.withOutputSchema(jsonSchema)`). A schema
   * the field editor cannot express (nested objects, extra keywords) opens as JSON only.
   */
  import ConfigSection from "../ConfigSection.svelte";
  import FieldEditor from "../FieldEditor.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import OutputSchemaParseFailField from "$lib/components/OutputSchemaParseFailField.svelte";
  import { SCHEMA_TYPE_OPTIONS, newSchemaField, outputSchemaTextOf, outputSchemaViewOf } from "$lib/field-editor.js";
  import type { SchemaField } from "@reactive-agents/ui-core";
  import { untrack } from "svelte";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();

  const text = $derived((config.outputSchema ?? "").trim());
  const view = $derived(outputSchemaViewOf(config.outputSchema ?? ""));

  // Rows are local while editing, so a field renamed to blank stays on screen; the config gets
  // the text for the named ones. A change from outside (Import, Load example) re-reads the rows.
  let rows = $state<SchemaField[]>(untrack(() => [...outputSchemaViewOf(config.outputSchema ?? "").fields]));
  let emitted = $state(untrack(() => config.outputSchema ?? ""));
  $effect(() => {
    const incoming = config.outputSchema ?? "";
    if (incoming === emitted) return;
    emitted = incoming;
    rows = [...outputSchemaViewOf(incoming).fields];
  });

  let asJson = $state(untrack(() => ["json", "invalid"].includes(outputSchemaViewOf(config.outputSchema ?? "").mode)));
  const jsonOnly = $derived(view.mode === "json" || view.mode === "invalid");

  function setRows(next: SchemaField[]) {
    rows = next;
    const out = outputSchemaTextOf(next);
    emitted = out;
    config = { ...config, outputSchema: out };
  }
</script>

<ConfigSection id="outputschema" icon="code" title="Output schema" {open} {onToggle}>
  {#snippet head()}
    <span class="truncate">{view.mode === "empty" ? "off" : view.mode === "invalid" ? "invalid JSON" : `${view.fields.length} field${view.fields.length === 1 ? "" : "s"}`}</span>
  {/snippet}
  <p class="acp-hint leading-relaxed">
    Optional. Extract the agent's answer into a typed object (<code>.withOutputSchema</code>). The run and the chat show it as a table of fields, with how it was obtained.
  </p>

  {#if !asJson && !jsonOnly}
    <FieldEditor
      fields={rows}
      types={SCHEMA_TYPE_OPTIONS}
      onChange={setRows}
      newField={newSchemaField}
      idPrefix="out-field"
      addLabel="Add a field"
    />
  {:else if jsonOnly && !asJson}
    <p class="acp-hint">This schema has parts the field editor cannot show. Edit the JSON.</p>
  {/if}

  {#if asJson || jsonOnly}
    <div>
      <label class="config-label" for="output-schema-json">JSON Schema</label>
      <textarea id="output-schema-json" bind:value={config.outputSchema} rows="8" spellcheck="false"
        placeholder={'{\n  "type": "object",\n  "properties": { "name": { "type": "string" } },\n  "required": ["name"]\n}'}
        class="config-input acp-mono"></textarea>
      {#if text !== ""}
        <p class="mt-1 acp-hint" class:acp-ok={view.mode !== "invalid"} class:acp-bad={view.mode === "invalid"}>
          {view.mode === "invalid" ? "Not valid JSON: the schema is ignored until it is fixed." : "Valid: the answer is extracted into result.object."}
        </p>
      {/if}
    </div>
  {/if}

  <div class="flex items-center gap-2">
    {#if !jsonOnly}
      <Button size="sm" variant="ghost" aria-pressed={asJson} onclick={() => (asJson = !asJson)}>{asJson ? "Edit as fields" : "Edit as JSON"}</Button>
    {/if}
  </div>

  {#if text !== "" && view.mode !== "invalid"}
    <OutputSchemaParseFailField bind:value={config.outputSchemaOnParseFail} />
  {/if}
</ConfigSection>
