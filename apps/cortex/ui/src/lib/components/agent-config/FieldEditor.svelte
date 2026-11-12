<script lang="ts" generics="T extends EditorField">
  // One editor for a list of named, typed fields: name, type, description, required (and a
  // default / allowed values where the type has them). Lab Variables and the Output schema
  // edit through it; rows keep any property the editor does not show (`{ ...row, ...patch }`).
  // `lockNames` is for detected data (Variables: the name comes from the `{{token}}`).
  import Button from "$lib/components/kit/Button.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import type { EditorField, FieldTypeOption } from "$lib/field-editor.js";

  interface Props {
    fields: readonly T[];
    types: readonly FieldTypeOption[];
    /** Called with the whole next list on every edit. */
    onChange: (next: T[]) => void;
    /** The name is fixed (detected): shown, not edited, and rows cannot be added or removed. */
    lockNames?: boolean;
    /** Show a default-value box. */
    showDefault?: boolean;
    /** Makes a new row (adding is offered when set and names are not locked). */
    newField?: (existing: readonly T[]) => T;
    /** Prefix of the form-control ids. */
    idPrefix: string;
    /** Words for the Add button. */
    addLabel?: string;
  }
  const { fields, types, onChange, lockNames = false, showDefault = false, newField, idPrefix, addLabel = "Add a field" }: Props = $props();

  const patch = (i: number, p: Partial<EditorField>) => onChange(fields.map((f, at) => (at === i ? { ...f, ...p } : f)));
  const remove = (i: number) => onChange(fields.filter((_, at) => at !== i));
  const listOf = (text: string): string[] => text.split(",").map((s) => s.trim()).filter(Boolean);
</script>

<div class="fe">
  {#each fields as f, i (lockNames ? f.name : i)}
    <div class="row" data-testid="field-row">
      <div class="top">
        {#if lockNames}
          <span class="locked">{f.name}</span>
        {:else}
          <label class="sr-only" for={`${idPrefix}-${i}-name`}>Field name</label>
          <input id={`${idPrefix}-${i}-name`} class="cx-control name" value={f.name} placeholder="name"
            oninput={(e) => patch(i, { name: e.currentTarget.value })} spellcheck="false" />
        {/if}
        <label class="sr-only" for={`${idPrefix}-${i}-type`}>Type</label>
        <Select id={`${idPrefix}-${i}-type`} class="type" value={f.type} options={types} onchange={(v) => patch(i, { type: v })} />
        <label class="req">
          <input type="checkbox" checked={f.required} onchange={(e) => patch(i, { required: e.currentTarget.checked })} />
          required
        </label>
        {#if !lockNames}
          <IconButton icon="trash" size="sm" label={`Remove ${f.name || "field"}`} onclick={() => remove(i)} />
        {/if}
      </div>
      <div class="more">
        <label class="sr-only" for={`${idPrefix}-${i}-desc`}>Description</label>
        <input id={`${idPrefix}-${i}-desc`} class="cx-control" value={f.description ?? ""} placeholder="What this is (optional)"
          oninput={(e) => patch(i, { description: e.currentTarget.value })} />
        {#if showDefault}
          <label class="sr-only" for={`${idPrefix}-${i}-default`}>Default</label>
          <input id={`${idPrefix}-${i}-default`} class="cx-control" value={f.default ?? ""} placeholder="Default (optional)"
            oninput={(e) => patch(i, { default: e.currentTarget.value })} />
        {/if}
      </div>
      {#if f.type === "enum"}
        <div class="more">
          <label class="sr-only" for={`${idPrefix}-${i}-enum`}>Allowed values</label>
          <input id={`${idPrefix}-${i}-enum`} class="cx-control mono" value={(f.enumValues ?? []).join(",")} placeholder="comma,separated,values"
            oninput={(e) => patch(i, { enumValues: listOf(e.currentTarget.value) })} spellcheck="false" />
        </div>
      {/if}
    </div>
  {/each}
  {#if newField && !lockNames}
    <div><Button size="sm" icon="plus" onclick={() => onChange([...fields, newField(fields)])}>{addLabel}</Button></div>
  {/if}
</div>

<style>
  .fe { display: grid; gap: 8px; }
  .row { display: grid; gap: 6px; padding: 8px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .more { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; }
  .name { flex: 1; min-width: 8rem; font-family: var(--cortex-font-data); }
  .locked { flex: 1; min-width: 8rem; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-warn); }
  .fe :global(.type) { width: 9rem; }
  .req { display: inline-flex; align-items: center; gap: 6px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); cursor: pointer; }
  .mono { font-family: var(--cortex-font-data); }
  .fe :global(.cx-control) { height: 28px; }
</style>
