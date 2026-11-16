<script lang="ts">
  /**
   * Take a plan out of the chat plan card or bring one in. Export: copy as Markdown or download
   * Markdown, a web page or JSON (the saved plan, in the framework's portable formats). Import
   * (editable card only): a file or pasted Markdown / JSON, read by the server with the framework's
   * parsers; a plan that cannot be read says why and changes nothing. A plan brought in is a user
   * edit and replaces the saved plan. Wording and rules live in `lib/plan-transfer.ts`.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Overlay from "$lib/components/kit/Overlay.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";
  import { clickOutside } from "$lib/actions/click-outside.js";
  import { exportPlanAs, importPlanText } from "$lib/stores/chat-plan-store.js";
  import { PLAN_EXPORT_ITEMS, importTextTooLarge } from "$lib/plan-transfer.js";

  interface Props {
    /** The saved plan has steps to export. */
    canExport: boolean;
    /** The card is editable (the latest Plan reply), so a plan may be imported. */
    canImport: boolean;
    /** The draft has unsaved edits: export would write the saved plan, not the draft. */
    dirty?: boolean;
    /** The plan was replaced by an import (the card drops its draft). */
    onimported?: () => void;
    /** Unique per card on the page. */
    idBase: string;
  }
  const { canExport, canImport, dirty = false, onimported, idBase }: Props = $props();

  let menuOpen = $state(false);
  let trigger: HTMLElement | undefined = $state();
  let importOpen = $state(false);
  let text = $state("");
  let error = $state("");
  let busy = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  async function pickFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const read = await file.text().catch(() => null);
    // The same file can be chosen again after a failed read.
    input.value = "";
    if (read === null) { error = "Could not read that file."; return; }
    if (importTextTooLarge(read)) { error = "That file is too large to be a plan."; return; }
    text = read;
    error = "";
  }

  async function runImport() {
    busy = true;
    error = "";
    try {
      const res = await importPlanText(text);
      if (!res.ok) { error = res.message; return; }
      importOpen = false;
      text = "";
      onimported?.();
    } finally {
      busy = false;
    }
  }

  function closeImport() {
    importOpen = false;
    error = "";
  }
</script>

<span class="tools">
  {#if canExport}
    <span class="menu-wrap">
      <span bind:this={trigger} class="trig">
        <Button size="sm" variant="ghost" icon="download" aria-haspopup="menu" aria-expanded={menuOpen} data-testid="plan-export" title={dirty ? "Exports the saved plan; save your edits first to include them" : "Copy or download this plan"} onclick={() => (menuOpen = !menuOpen)}>Export</Button>
      </span>
      {#if menuOpen}
        <div class="menu" role="menu" aria-label="Export plan" use:clickOutside={{ onclose: () => (menuOpen = false), ignore: [trigger] }}>
          {#each PLAN_EXPORT_ITEMS as item (item.key)}
            <button type="button" role="menuitem" class="item" data-testid="plan-export-{item.key}" onclick={() => { menuOpen = false; void exportPlanAs(item); }}>{item.label}</button>
          {/each}
        </div>
      {/if}
    </span>
  {/if}
  {#if canImport}
    <Button size="sm" variant="ghost" icon="file" data-testid="plan-import" title="Replace the plan with one from a file or pasted text" onclick={() => (importOpen = true)}>Import</Button>
  {/if}
</span>

<Overlay open={importOpen} title="Import a plan" onclose={closeImport}>
  <div class="imp">
    <p class="hint">Paste Markdown (a list of steps, one per line, like “- [ ] Read the config”) or a plan exported as JSON. It replaces the current plan and counts as your edit.</p>
    <Textarea id="{idBase}-import-text" mono rows={9} bind:value={text} placeholder={"# Goal\n- [ ] First step\n- [ ] Second step"} aria-label="Plan text" invalid={error !== ""} describedBy="{idBase}-import-err" data-testid="plan-import-text" />
    <div class="file-row">
      <input bind:this={fileInput} type="file" accept=".md,.markdown,.json,.txt,text/markdown,application/json,text/plain" class="file" onchange={pickFile} data-testid="plan-import-file" aria-label="Choose a plan file" />
      <Button size="sm" icon="file" onclick={() => fileInput?.click()}>Choose a file</Button>
    </div>
    <p id="{idBase}-import-err" class="err" role="alert" data-testid="plan-import-error">{error}</p>
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={closeImport}>Cancel</Button>
    <Button variant="primary" disabled={busy || text.trim() === ""} onclick={() => void runImport()} data-testid="plan-import-apply">Import</Button>
  {/snippet}
</Overlay>

<style>
  .tools { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; }
  .menu-wrap { position: relative; display: inline-flex; }
  .trig { display: inline-flex; }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: var(--cortex-z-pop, 20);
    min-width: 220px;
    padding: 4px;
    border: 1px solid var(--cortex-line-strong);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop, 0 8px 24px rgb(0 0 0 / 0.25));
  }
  .item { display: block; width: 100%; padding: 6px 8px; border: 0; border-radius: var(--cortex-r-chip); background: transparent; color: var(--cortex-text); font: inherit; font-size: var(--cortex-t-sm); text-align: left; cursor: pointer; }
  .item:hover, .item:focus-visible { background: var(--cortex-surface-2); }
  .imp { display: grid; gap: 8px; }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .file-row { display: flex; align-items: center; gap: 8px; }
  .err { margin: 0; min-height: 1em; font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
</style>
