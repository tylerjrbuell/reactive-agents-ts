<script lang="ts">
  // "Export" button + format menu in the chat header. The export itself is the
  // panel's (the `/export` command shares it), passed in as `onExport`.
  import type { ExportFormat } from "$lib/chat-export.js";
  import Button from "$lib/components/kit/Button.svelte";

  interface Props {
    disabled: boolean;
    onExport: (format: ExportFormat) => void | Promise<void>;
  }
  const { disabled, onExport }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  const FORMATS: readonly (readonly [ExportFormat, string])[] = [["md", "Markdown transcript"], ["json", "JSON with traces"], ["jsonl", "JSONL run traces"]];

  function onDocPointer(e: PointerEvent) {
    if (open && root && e.target instanceof Node && !root.contains(e.target)) open = false;
  }
  function onKey(e: KeyboardEvent) {
    if (open && e.key === "Escape") open = false;
  }
</script>

<svelte:document onpointerdown={onDocPointer} onkeydown={onKey} />

<div class="wrap" bind:this={root}>
  <Button size="sm" variant="ghost" icon="download" aria-haspopup="menu" aria-expanded={open} {disabled} title="Export conversation" onclick={() => (open = !open)}>Export</Button>
  {#if open}
    <div role="menu" class="menu chat-menu-in">
      {#each FORMATS as [fmt, label] (fmt)}
        <button type="button" role="menuitem" onclick={() => { open = false; void onExport(fmt); }}>{label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: var(--cortex-z-drawer);
    width: 12rem;
    padding: 4px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop);
    transform-origin: top right;
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--cortex-text);
    font: inherit;
    font-size: var(--cortex-t-sm);
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover, .menu button:focus-visible { background: var(--cortex-surface-2); }
</style>
