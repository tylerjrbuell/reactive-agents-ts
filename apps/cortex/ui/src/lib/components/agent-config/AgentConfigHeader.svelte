<script lang="ts">
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
</script>

  <header class="acp-header rounded-xl border border-[var(--cortex-border)] bg-[color-mix(in_srgb,var(--cortex-surface)_92%,transparent)] px-3 py-2.5 shadow-[0_1px_0_color-mix(in_srgb,var(--ra-violet)_12%,transparent)]">
    <div class="flex flex-wrap items-start gap-2 gap-y-2">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="acp-header-mark h-6 w-1 shrink-0 rounded-full bg-gradient-to-b from-primary to-secondary opacity-90" aria-hidden="true"></span>
          <div>
            <h2 class="font-display text-sm font-semibold tracking-tight text-[var(--cortex-text)]">Agent blueprint</h2>
            <p class="text-[11px] text-[var(--cortex-text-muted)] leading-snug max-w-[28rem]">
              Compose how this agent thinks, what it can call, and how it fails safe. Changes bind live to the parent form.
            </p>
          </div>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-1 shrink-0">
        <button type="button" onclick={() => fileInput?.click()}
          class="acp-toolbar-btn"
         >
          <span class="material-symbols-outlined text-[14px] opacity-80" aria-hidden="true">upload_file</span>
          <span>Import</span>
        </button>
        <button type="button" onclick={exportConfig}
          class="acp-toolbar-btn"
         >
          <span class="material-symbols-outlined text-[14px] opacity-80" aria-hidden="true">download</span>
          <span>Export</span>
        </button>
        <button type="button" onclick={downloadExample}
          class="acp-toolbar-btn acp-toolbar-btn--muted"
         >
          <span class="material-symbols-outlined text-[14px] opacity-70" aria-hidden="true">help_outline</span>
          <span>Example</span>
        </button>
        <span class="w-px h-5 bg-[var(--cortex-border)] mx-0.5 hidden sm:block" aria-hidden="true"></span>
        <button type="button" onclick={() => (openSections.size >= acpActiveSectionIds().length ? acpCollapseAll() : acpExpandAll())}
          class="acp-toolbar-btn acp-toolbar-btn--ghost">
          {openSections.size >= acpActiveSectionIds().length ? "Collapse all" : "Expand all"}
        </button>
      </div>
    </div>
    {#if !compact}
      <div class="mt-3 pt-2 border-t border-[var(--cortex-border)]">
        <label class="sr-only" for="acp-section-filter">Filter configuration sections</label>
        <div class="relative">
          <span class="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[var(--cortex-text-muted)] opacity-60" aria-hidden="true">filter_alt</span>
          <input
            id="acp-section-filter"
            type="search"
            bind:value={sectionFilter}
            placeholder="  Filter sections (e.g. guardrails, mcp, timeout)…"
            autocomplete="off"
            class="config-input acp-filter-input pl-9" />
        </div>
        <nav class="mt-3 flex flex-wrap gap-1.5" aria-label="Jump to section">
          {#each acpActiveSectionIds() as sid (sid)}
            {#if acpSectionVisible(sid)}
              <button
                type="button"
                onclick={() => acpScrollTo(sid)}
                class="acp-nav-pill"
                class:acp-nav-pill--active={openSections.has(sid)}>
                {acpSectionCopy(sid).label}
              </button>
            {/if}
          {/each}
        </nav>
        {#if acpFilterEmpty}
          <p class="mt-2 text-center font-mono text-[11px] text-[var(--cortex-text-muted)]" role="status">
            No sections match “{sectionFilter.trim()}”. Clear the filter or try another keyword.
          </p>
        {/if}
      </div>
    {/if}
  </header>
