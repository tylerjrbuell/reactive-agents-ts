<script lang="ts">
  /**
   * Create or edit a custom (Lab) tool: name, description and parameter rows with a live JSON
   * preview of what is stored. Rules and checks: `lib/custom-tool-editor.ts`. On edit, only what
   * changed is sent (`customToolChanges`). Mount per tool (`{#key}`): the fields start from it once.
   */
  import { untrack } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import {
    EMPTY_PARAM_ROW,
    PARAM_TYPES,
    customToolChanges,
    customToolProblem,
    paramsFromRows,
    previewJson,
    removeRow,
    rowsFromParams,
    setRow,
    type ParamRow,
  } from "$lib/custom-tool-editor.js";
  import type { CatalogEntry, CatalogParam } from "$lib/tool-workshop.js";

  interface Props {
    /** The tool being edited; null creates a new one. */
    tool: CatalogEntry | null;
    saving: boolean;
    /** The body to send: everything for a new tool, only the changes for an edit. */
    onSave: (body: { name?: string; description?: string; parameters?: CatalogParam[] }) => void | Promise<void>;
    onCancel: () => void;
  }
  const { tool, saving, onSave, onCancel }: Props = $props();

  let name = $state(untrack(() => tool?.name ?? ""));
  let description = $state(untrack(() => tool?.description ?? ""));
  let rows = $state<ParamRow[]>(untrack(() => rowsFromParams(tool?.parameters ?? [])));

  const problem = $derived(customToolProblem({ name, description, rows }));
  const changes = $derived(tool === null ? { name: name.trim(), description: description.trim(), parameters: paramsFromRows(rows) } : customToolChanges(tool, { name, description, rows }));
  const typeOptions = PARAM_TYPES.map((t) => ({ value: t, label: t }));
  const showProblem = $derived(problem !== null && (name !== "" || description !== ""));
</script>

<form class="ce" onsubmit={(e) => { e.preventDefault(); if (problem === null && changes !== null) void onSave(changes); }} aria-label={tool ? `Edit ${tool.displayName}` : "New custom tool"}>
  <div class="ce-two">
    <Field id="ce-name" label="Name" hint="kebab-case, e.g. my-api-fetcher">
      <Input id="ce-name" bind:value={name} mono placeholder="my-api-fetcher" describedBy="ce-name-hint" />
    </Field>
    <Field id="ce-desc" label="Description" hint="Tells the agent when to use it.">
      <Input id="ce-desc" bind:value={description} placeholder="What this tool does" describedBy="ce-desc-hint" />
    </Field>
  </div>

  <section class="ce-params" aria-labelledby="ce-params-h">
    <div class="ce-params-h">
      <h4 id="ce-params-h">Parameters</h4>
      <Button size="sm" variant="ghost" icon="plus" onclick={() => (rows = [...rows, { ...EMPTY_PARAM_ROW }])}>Add parameter</Button>
    </div>
    {#if rows.length === 0}
      <p class="ce-empty">No parameters. The agent calls this tool with no input.</p>
    {:else}
      <ul class="ce-rows">
        {#each rows as row, i (i)}
          <li class="ce-row">
            <Input id="ce-p-name-{i}" value={row.name} mono placeholder="name" aria-label="Parameter {i + 1} name" oninput={(e) => (rows = setRow(rows, i, { name: e.currentTarget.value }))} />
            <Select id="ce-p-type-{i}" value={row.type} options={typeOptions} onchange={(v) => (rows = setRow(rows, i, { type: v }))} aria-label="Parameter {i + 1} type" />
            <Input id="ce-p-desc-{i}" value={row.description} placeholder="description" aria-label="Parameter {i + 1} description" oninput={(e) => (rows = setRow(rows, i, { description: e.currentTarget.value }))} />
            <Input id="ce-p-enum-{i}" value={row.enumText} mono placeholder="allowed values, comma separated" aria-label="Parameter {i + 1} allowed values" oninput={(e) => (rows = setRow(rows, i, { enumText: e.currentTarget.value }))} />
            <Switch id="ce-p-req-{i}" label="Required" checked={row.required} onchange={(c) => (rows = setRow(rows, i, { required: c }))} />
            <IconButton icon="trash" size="sm" label="Remove parameter {i + 1}" onclick={() => (rows = removeRow(rows, i))} />
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <div class="ce-preview">
    <h4>What is stored</h4>
    <pre data-testid="custom-tool-preview">{previewJson(rows)}</pre>
  </div>

  {#if showProblem}<p class="ce-problem" role="alert">{problem}</p>{/if}
  <div class="ce-actions">
    <Button variant="ghost" onclick={onCancel}>Cancel</Button>
    <Button type="submit" variant="primary" icon="check" disabled={saving || problem !== null || changes === null}>{saving ? "Saving…" : tool ? "Save changes" : "Add tool"}</Button>
  </div>
</form>

<style>
  .ce { display: grid; gap: 14px; }
  .ce-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
  h4 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .ce-params { display: grid; gap: 8px; }
  .ce-params-h { display: flex; align-items: center; justify-content: space-between; }
  .ce-empty { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .ce-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .ce-row { display: grid; grid-template-columns: minmax(100px, 1fr) 110px minmax(120px, 1.4fr) minmax(120px, 1.2fr) auto auto; align-items: center; gap: 8px; }
  .ce-preview { display: grid; gap: 6px; }
  pre { margin: 0; padding: 10px; max-height: 180px; overflow: auto; border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); color: var(--cortex-text-2); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .ce-problem { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-bad); }
  .ce-actions { display: flex; justify-content: flex-end; gap: 8px; }
  @media (max-width: 1100px) { .ce-row { grid-template-columns: 1fr 1fr; } .ce-two { grid-template-columns: 1fr; } }
</style>
