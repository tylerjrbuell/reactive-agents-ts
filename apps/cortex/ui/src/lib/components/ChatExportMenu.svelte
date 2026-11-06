<script lang="ts">
  // "Export conversation" button + format menu in the chat header. The export itself is
  // the panel's (the `/export` command shares it), passed in as `onExport`.
  import type { ExportFormat } from "$lib/chat-export.js";

  interface Props {
    disabled: boolean;
    onExport: (format: ExportFormat) => void | Promise<void>;
  }
  const { disabled, onExport }: Props = $props();

  let open = $state(false);
  const FORMATS: readonly (readonly [ExportFormat, string])[] = [["md", "Markdown transcript"], ["json", "JSON with traces"], ["jsonl", "JSONL run traces"]];
</script>

<div class="relative">
  <button
    type="button"
    onclick={() => (open = !open)}
    aria-haspopup="menu"
    aria-expanded={open}
    {disabled}
    class="flex cursor-pointer items-center gap-1 rounded-md border border-[color:var(--cortex-border)] px-2 py-1 text-[11px] text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)] disabled:cursor-not-allowed disabled:opacity-50"
  >
    <span class="material-symbols-outlined text-[15px] leading-none">download</span>
    Export conversation
  </button>
  {#if open}
    <div role="menu" class="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] p-1 shadow-xl">
      {#each FORMATS as [fmt, label] (fmt)}
        <button
          type="button"
          role="menuitem"
          onclick={() => { open = false; void onExport(fmt); }}
          class="block w-full cursor-pointer rounded px-2 py-1.5 text-left text-[12px] text-[var(--cortex-text)] hover:bg-[var(--cortex-surface-mid)]"
        >{label}</button>
      {/each}
    </div>
  {/if}
</div>
