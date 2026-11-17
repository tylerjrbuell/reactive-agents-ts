<script lang="ts">
  /**
   * Lab > Tools > Custom tools: the Lab's own tools. A list, the editor (create AND edit name,
   * description and parameters), the disable switch and Try it. Rules: `lib/custom-tool-editor.ts`;
   * calls: `lib/tools-page-data.ts`.
   */
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Panel from "$lib/components/kit/Panel.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import CustomToolEditor from "$lib/components/tools/CustomToolEditor.svelte";
  import ToolTryPanel from "$lib/components/tools/ToolTryPanel.svelte";
  import { createCustomTool, deleteCustomTool, patchCustomTool, type ApiCtx } from "$lib/tools-page-data.js";
  import ToolsShell from "$lib/components/tools/ToolsShell.svelte";
  import { filterCatalog, type CatalogEntry, type CatalogParam } from "$lib/tool-workshop.js";
  import { customToolsOf } from "$lib/tools-tabs.js";

  interface Props {
    ctx: ApiCtx;
    /** The whole catalog (this tab shows its Lab tools). */
    catalog: readonly CatalogEntry[];
    loading: boolean;
    onChanged: () => void | Promise<void>;
  }
  const { ctx, catalog, loading, onChanged }: Props = $props();

  const custom = $derived(customToolsOf(catalog));
  let search = $state("");
  const shown = $derived(filterCatalog([...custom], search));
  let selectedId = $state<string | null>(null);
  /** `new` = the editor creates; `edit` = it edits the selected tool. */
  let mode = $state<"view" | "new" | "edit">("view");
  let saving = $state(false);
  /** The picked tool, or the first while nothing is picked (not while a new tool is being made). */
  const selected = $derived(custom.find((t) => t.id === selectedId) ?? (mode === "new" ? null : (custom[0] ?? null)));
  const toolIdOf = (t: CatalogEntry): string => t.id.slice(4);

  async function save(body: { name?: string; description?: string; parameters?: CatalogParam[] }) {
    saving = true;
    const creating = mode === "new";
    const r =
      creating && body.name !== undefined && body.description !== undefined && body.parameters !== undefined
        ? await createCustomTool(ctx, { name: body.name, description: body.description, parameters: body.parameters })
        : selected
          ? await patchCustomTool(ctx, toolIdOf(selected), body)
          : ({ ok: false, error: "Pick a tool first." } as const);
    saving = false;
    if (!r.ok) return void toast.error(creating ? "Create failed" : "Save failed", r.error);
    toast.success(creating ? "Tool created" : "Tool saved");
    mode = "view";
    await onChanged();
    if (creating && typeof r.value === "string") selectedId = `lab:${r.value}`;
  }

  async function setDisabled(tool: CatalogEntry, enabled: boolean) {
    const r = await patchCustomTool(ctx, toolIdOf(tool), { disabled: !enabled });
    if (!r.ok) toast.error("Update failed", r.error);
    else toast.success(enabled ? "Tool enabled" : "Tool disabled");
    await onChanged();
  }

  async function remove(tool: CatalogEntry) {
    const ok = await confirmAction({ title: "Delete custom tool?", message: `"${tool.displayName}" is removed from the lab. Agents that use it lose access.`, confirmLabel: "Delete" });
    if (!ok) return;
    const r = await deleteCustomTool(ctx, toolIdOf(tool));
    if (!r.ok) return void toast.error("Delete failed", r.error);
    toast.success("Deleted");
    selectedId = null;
    mode = "view";
    await onChanged();
  }
</script>

<ToolsShell listLabel="Custom tools">
  {#snippet bar()}
    {#if custom.length > 0}
      <label class="sr-only" for="ct-search">Search custom tools</label>
      <input id="ct-search" type="search" class="cx-control" bind:value={search} placeholder="Search custom tools" />
    {/if}
    <Button variant="primary" size="field" icon="plus" onclick={() => { mode = "new"; selectedId = null; }}>New tool</Button>
  {/snippet}
  {#snippet meta()}
    {#if !loading}<span>{custom.length} custom tool{custom.length === 1 ? "" : "s"}</span>{/if}
  {/snippet}
  {#snippet list()}
    {#if loading}
      <div class="tsh-skel" role="status" aria-label="Loading tools">
        {#each [0, 1, 2] as i (i)}<div class="chat-skeleton" style:animation-delay="{i * 120}ms"></div>{/each}
      </div>
    {:else if custom.length === 0}
      <p class="tsh-note">No custom tools yet.</p>
    {:else if shown.length === 0}
      <p class="tsh-note">No tool matches.</p>
    {:else}
      <ul class="ct-list">
        {#each shown as t (t.id)}
          <li>
            <button type="button" class="tsh-row" class:dim={t.disabled} aria-current={selected?.id === t.id ? "true" : undefined} onclick={() => { selectedId = t.id; mode = "view"; }}>
              <span class="ct-top">
                <span class="ct-name">{t.displayName}</span>
                {#if t.disabled}<Badge tone="neutral">Disabled</Badge>{/if}
              </span>
              <span class="ct-desc">{t.description}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
  {#snippet detail()}
    {#if mode === "new"}
      <Panel title="New custom tool">
        <CustomToolEditor tool={null} {saving} onSave={save} onCancel={() => (mode = "view")} />
      </Panel>
    {:else if selected && mode === "edit"}
      {#key selected.id}
        <Panel title={`Edit ${selected.displayName}`}>
          <CustomToolEditor tool={selected} {saving} onSave={save} onCancel={() => (mode = "view")} />
        </Panel>
      {/key}
    {:else if selected}
      <Panel title={selected.displayName}>
        {#snippet actions()}
          <Switch id="ct-enabled" label={selected.disabled ? "Disabled" : "Enabled"} checked={!selected.disabled} onchange={(on) => setDisabled(selected, on)} />
          <Button size="sm" icon="edit" onclick={() => (mode = "edit")}>Edit</Button>
          <Button size="sm" variant="danger" icon="trash" onclick={() => remove(selected)}>Delete</Button>
        {/snippet}
        <p class="ct-desc-full">{selected.description}</p>
        {#if selected.parameters.length === 0}
          <p class="tsh-note">No parameters.</p>
        {:else}
          <ul class="ct-params">
            {#each selected.parameters as p (p.name)}
              <li><span class="ct-pname">{p.name}</span> <span class="ct-ptype">{p.type}{p.required ? ", required" : ""}</span>{#if p.description} <span class="ct-pdesc">{p.description}</span>{/if}</li>
            {/each}
          </ul>
        {/if}
        <h4 class="ct-h">Try it</h4>
        {#key selected.id}
          <ToolTryPanel tool={selected} {ctx} onRan={onChanged} />
        {/key}
      </Panel>
    {:else if !loading}
      <EmptyState icon="code" title={custom.length === 0 ? "Prototype a tool" : "Pick a custom tool"} description={custom.length === 0 ? "A custom tool is a quick prototype: New tool defines its parameters, then you try it here with a request JSON." : "Edit its parameters or try it here. New tool adds one."} />
    {/if}
  {/snippet}
</ToolsShell>

<style>
  .ct-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .ct-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ct-name { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); color: var(--cortex-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ct-desc { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ct-desc-full { margin: 0 0 8px; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .ct-params { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 4px; font-size: var(--cortex-t-xs); }
  .ct-pname { font-family: var(--cortex-font-data); color: var(--cortex-text); }
  .ct-ptype { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .ct-pdesc { color: var(--cortex-text-2); }
  .ct-h { margin: 8px 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
</style>
