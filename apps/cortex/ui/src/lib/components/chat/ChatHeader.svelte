<script lang="ts">
  import ChatContextMeter from "$lib/components/ChatContextMeter.svelte";
  import ChatExportMenu from "$lib/components/ChatExportMenu.svelte";
  import type { ExportFormat } from "$lib/chat-export.js";
  import type { ComponentProps } from "svelte";

  interface Props {
    /** Context meter inputs (`contextMeterOf`). */
    meter: Omit<ComponentProps<typeof ChatContextMeter>, "onOpenPanel">;
    /** No turns yet: export is disabled. */
    empty: boolean;
    traceOpen: boolean;
    onExport: (format: ExportFormat) => void | Promise<void>;
    /** Open the inspector on its Context tab. */
    onOpenContext: () => void;
    onToggleTrace: () => void;
  }
  const { meter, empty, traceOpen, onExport, onOpenContext, onToggleTrace }: Props = $props();
</script>

  <div
    class="flex-shrink-0 border-b border-[color:var(--cortex-border)] px-4 py-3 flex items-center justify-between"
  >
    <h2 class="text-[11px] uppercase tracking-widest font-mono text-[var(--cortex-text-muted)]">
      Conversation
    </h2>
    <div class="flex items-center gap-4">
      <ChatContextMeter {...meter} onOpenPanel={onOpenContext} />
      <ChatExportMenu disabled={empty} {onExport} />
      <button
        type="button"
        onclick={onToggleTrace}
        aria-pressed={traceOpen}

        class="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors
               {traceOpen ? 'border-primary/40 bg-primary/10 text-primary' : 'border-[color:var(--cortex-border)] text-[var(--cortex-text-muted)] hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)]'}"
      >
        <span class="material-symbols-outlined text-[15px] leading-none">account_tree</span>
        Trace
      </button>
    </div>
  </div>
