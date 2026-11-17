<script lang="ts">
  /**
   * Lab > Tools > Catalog and test: every tool an agent can get (built-in, meta, MCP, custom), its
   * parameters and usage, and a panel to call it. A tool of a disabled server shows a Disabled
   * badge but can still be tested here.
   */
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import ToolCatalogList from "$lib/components/tools/ToolCatalogList.svelte";
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
  const selected = $derived(catalog.find((t) => t.id === selectedId) ?? null);

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

<div class="cg">
  <ToolCatalogList bind:search {loading} entries={filtered} {selectedId} onSelect={(e) => (selectedId = e.id)} />
  <section class="cg-detail" aria-label="Tool">
    {#if !selected}
      <div class="cg-empty"><EmptyState icon="tool" title="Pick a tool" description="Its parameters show here, with a panel to call it." /></div>
    {:else}
      <ToolInspector tool={selected} onExport={() => exportEntry(selected)} onCopySchema={() => copySchema(selected)} />
      {#key selected.id}
        <ToolTryPanel tool={selected} {ctx} onRan={onChanged} />
      {/key}
    {/if}
  </section>
</div>

<style>
  .cg { flex: 1; min-height: 420px; display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); gap: 16px; }
  .cg-detail { min-height: 0; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); }
  .cg-empty { flex: 1; display: grid; place-items: center; padding: 24px; }
  @media (max-width: 1000px) { .cg { grid-template-columns: 1fr; } }
</style>
