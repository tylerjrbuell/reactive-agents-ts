<script lang="ts">
  /**
   * The collapsible panel's header (Beacon prompt bar, saved-agent form, chat
   * session settings): import / export / example, expand all, and (not
   * compact) the section filter and jump chips. The Lab builder leaves it out
   * and uses its page header and section nav instead.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    /** Hidden JSON file input the Import button clicks. */
    fileInput: HTMLInputElement | null;
    /** Chat quick config: no filter or section nav. */
    compact: boolean;
    /** Section filter text. */
    sectionFilter?: string;
    openSections: Set<string>;
    /** No section matches the filter. */
    acpFilterEmpty: boolean;
    acpActiveSectionIds: () => string[];
    acpSectionVisible: (id: string) => boolean;
    acpSectionCopy: (id: string) => { label: string; keywords: string };
    acpScrollTo: (id: string) => void;
    acpExpandAll: () => void;
    acpCollapseAll: () => void;
    exportConfig: () => void;
    downloadExample: () => void;
  }
  let {
    fileInput, compact, sectionFilter = $bindable(""), openSections, acpFilterEmpty,
    acpActiveSectionIds, acpSectionVisible, acpSectionCopy, acpScrollTo, acpExpandAll, acpCollapseAll, exportConfig, downloadExample,
  }: Props = $props();

  const allOpen = $derived(openSections.size >= acpActiveSectionIds().length);
</script>

<header class="acp-h">
  <div class="acp-h-row">
    <div class="acp-h-title">
      <h2>Agent settings</h2>
      <p>How this agent thinks, what it can call and how it fails safe.</p>
    </div>
    <div class="acp-h-actions">
      <Button size="sm" variant="ghost" icon="download" onclick={() => fileInput?.click()}>Import</Button>
      <Button size="sm" variant="ghost" icon="external" onclick={exportConfig}>Export</Button>
      <Button size="sm" variant="ghost" icon="file" onclick={downloadExample}>Example</Button>
      <Button size="sm" variant="ghost" onclick={() => (allOpen ? acpCollapseAll() : acpExpandAll())}>
        {allOpen ? "Collapse all" : "Expand all"}
      </Button>
    </div>
  </div>
  {#if !compact}
    <div class="acp-h-filter">
      <label class="sr-only" for="acp-section-filter">Find a setting</label>
      <span class="acp-h-filter-icon"><Icon name="search" size="sm" /></span>
      <input
        id="acp-section-filter"
        type="search"
        bind:value={sectionFilter}
        placeholder="Find a setting (guardrails, mcp, timeout)"
        autocomplete="off"
        class="cx-control" />
    </div>
    <nav class="acp-h-nav" aria-label="Jump to section">
      {#each acpActiveSectionIds() as sid (sid)}
        {#if acpSectionVisible(sid)}
          <Chip on={openSections.has(sid)} onclick={() => acpScrollTo(sid)}>{acpSectionCopy(sid).label}</Chip>
        {/if}
      {/each}
    </nav>
    {#if acpFilterEmpty}
      <p class="acp-hint" role="status">No sections match “{sectionFilter.trim()}”. Clear the search or try another word.</p>
    {/if}
  {/if}
</header>

<style>
  .acp-h {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: var(--cortex-r-panel);
    border: 1px solid var(--cortex-line);
    background: var(--cortex-surface-1);
  }
  .acp-h-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
  .acp-h-title { min-width: 0; flex: 1; }
  h2 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  p { margin: 2px 0 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .acp-h-actions { display: flex; flex-wrap: wrap; gap: 2px; justify-content: flex-end; }
  .acp-h-filter { position: relative; }
  .acp-h-filter-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); display: inline-flex; color: var(--cortex-text-3); pointer-events: none; }
  .acp-h-filter :global(.cx-control) { padding-left: 30px; }
  .acp-h-nav { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
