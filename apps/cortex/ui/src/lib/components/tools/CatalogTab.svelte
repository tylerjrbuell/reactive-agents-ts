<script lang="ts">
  /**
   * Lab > Tools > Catalog and test: every tool an agent can get (built-in, meta, MCP, custom), its
   * parameters and usage, and a panel to call it. A tool of a disabled server shows a Disabled
   * badge but can still be tested here.
   */
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import ToolCatalogList from "$lib/components/tools/ToolCatalogList.svelte";
  import ToolsShell from "$lib/components/tools/ToolsShell.svelte";
  import ToolInspector from "$lib/components/tools/ToolInspector.svelte";
  import ToolTryPanel from "$lib/components/tools/ToolTryPanel.svelte";
  import { filterCatalog, type CatalogEntry } from "$lib/tool-workshop.js";
  import type { ApiCtx } from "$lib/tools-page-data.js";

  interface Props {
    ctx: ApiCtx;
    catalog: readonly CatalogEntry[];
    loading: boolean;
    onChanged: () => void | Promise<void>;
  }
  const { ctx, catalog, loading, onChanged }: Props = $props();

  let search = $state("");
  let selectedId = $state<string | null>(null);
  const filtered = $derived(filterCatalog([...catalog], search));
  /** The picked tool, or the first listed one while nothing is picked, so the pane is never empty when tools exist. */
  const selected = $derived(catalog.find((t) => t.id === selectedId) ?? filtered[0] ?? null);

  function exportEntry(entry: CatalogEntry) {
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${entry.displayName.replace(/\//g, "-")}-tool.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copySchema(entry: CatalogEntry) {
    const schema = { name: entry.name, displayName: entry.displayName, description: entry.description, parameters: entry.parameters };
    try {
      await navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
    } catch {
      // clipboard refused: nothing to do
    }
  }
</script>

<ToolsShell listLabel="Catalog">
  {#snippet bar()}
    <label class="sr-only" for="tw-tool-search">Search tools</label>
    <input id="tw-tool-search" type="search" class="cx-control" bind:value={search} placeholder="Search tools" />
  {/snippet}
  {#snippet meta()}
    {#if !loading}<span>{filtered.length === catalog.length ? `${catalog.length} tools` : `${filtered.length} of ${catalog.length} tools`}</span>{/if}
  {/snippet}
  {#snippet list()}
    <ToolCatalogList {loading} entries={filtered} selectedId={selected?.id ?? null} onSelect={(e) => (selectedId = e.id)} />
  {/snippet}
  {#snippet detail()}
    {#if !selected}
      {#if !loading}<EmptyState icon="tool" title="Pick a tool" description="Its parameters show here, with a panel to call it." />{/if}
    {:else}
      <div class="cg-card">
        <ToolInspector tool={selected} onExport={() => exportEntry(selected)} onCopySchema={() => copySchema(selected)} />
        {#key selected.id}
          <ToolTryPanel tool={selected} {ctx} onRan={onChanged} />
        {/key}
      </div>
    {/if}
  {/snippet}
</ToolsShell>

<style>
  .cg-card { display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); }
</style>
