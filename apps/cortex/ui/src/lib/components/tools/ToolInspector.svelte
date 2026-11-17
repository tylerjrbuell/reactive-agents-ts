<script lang="ts">
  /** The selected tool: name, kind, description, usage numbers and its parameters. */
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import { kindLabel, kindTone, relativeTime, type CatalogEntry } from "$lib/tool-workshop.js";

  interface Props {
    /** The selected catalog tool. */
    tool: CatalogEntry;
    onExport: () => void;
    onCopySchema: () => void | Promise<void>;
  }
  const { tool: selected, onExport, onCopySchema }: Props = $props();
</script>

<div class="insp">
  <div class="insp-h">
    <div class="insp-title">
      <div class="name-line">
        <h3>{selected.displayName}</h3>
        <Badge tone={kindTone(selected.kind)}>{kindLabel(selected.kind)}</Badge>
        {#if selected.disabled}<Badge tone="neutral">Disabled</Badge>{/if}
      </div>
      <p class="desc">{selected.description}</p>
      {#if selected.disabled}
        <p class="warn">{selected.kind === "mcp" ? "Its server is switched off, so agents never get this tool. You can still test it here." : "Switched off, so agents never get this tool. You can still test it here."}</p>
      {/if}
      {#if selected.executableHint && !selected.executable}
        <p class="warn">{selected.executableHint}</p>
      {/if}
    </div>
    <div class="actions">
      <Button size="sm" icon="external" onclick={onExport}>Export</Button>
    </div>
  </div>

  <dl class="stats">
    <div><dt>Calls</dt><dd>{selected.metrics.callCount}</dd></div>
    <div><dt>Success</dt><dd>{selected.metrics.successRatePct != null ? `${selected.metrics.successRatePct}%` : "—"}</dd></div>
    <div><dt>Average</dt><dd>{selected.metrics.avgDurationMs != null ? `${selected.metrics.avgDurationMs} ms` : "—"}</dd></div>
    <div><dt>Last used</dt><dd>{relativeTime(selected.metrics.lastUsedAt)}</dd></div>
  </dl>

  <div class="schema">
    <div class="schema-h">
      <h4>Parameters</h4>
      {#if selected.parameters.length > 0}
        <Button size="sm" variant="ghost" icon="copy" onclick={onCopySchema}>Copy schema</Button>
      {/if}
    </div>
    {#if selected.parameters.length === 0}
      <p class="none">
        {#if selected.kind === "mcp"}
          No parameters cached. Open Servers, pick the server and run Refresh tools.
        {:else}
          This tool takes no parameters.
        {/if}
      </p>
    {:else}
      <table>
        <thead>
          <tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr>
        </thead>
        <tbody>
          {#each selected.parameters as p (p.name)}
            <tr>
              <td class="mono io">{p.name}</td>
              <td class="mono">{p.type}</td>
              <td>{p.required ? "Required" : "Optional"}</td>
              <td class="d">{p.description}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .insp { flex: none; max-height: 45vh; overflow-y: auto; padding: 16px; display: grid; gap: 14px; }
  .insp-h { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .insp-title { min-width: 0; display: grid; gap: 4px; }
  .name-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  h3 { margin: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .desc { margin: 0; max-width: 72ch; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .warn { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-warn); }
  .actions { display: flex; gap: 6px; flex: none; }
  .stats { margin: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .stats div { padding: 8px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); }
  .stats dt { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .stats dd { margin: 2px 0 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); font-variant-numeric: tabular-nums; }
  .schema { display: grid; gap: 8px; }
  .schema-h { display: flex; align-items: center; justify-content: space-between; }
  h4 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .none { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  table { width: 100%; border-collapse: collapse; font-size: var(--cortex-t-xs); }
  th { text-align: left; font-weight: 500; color: var(--cortex-text-3); padding: 6px 8px; border-bottom: 1px solid var(--cortex-line); }
  td { padding: 6px 8px; border-bottom: 1px solid var(--cortex-line); color: var(--cortex-text-2); vertical-align: top; }
  .mono { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text); }
  .io { color: var(--cortex-io); }
  .d { max-width: 28rem; }
  @media (max-width: 900px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
