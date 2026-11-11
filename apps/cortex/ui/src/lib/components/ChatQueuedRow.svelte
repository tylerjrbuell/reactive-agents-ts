<script lang="ts">
  import { queuePreview } from "$lib/chat-queue.js";

  interface Props {
    /** The parked message (the caller renders this row only while one is queued). */
    text: string;
    /** While a run is going the queued message waits for it; "Send now" appears once it has stopped. */
    sending: boolean;
    onSendNow: () => void;
    onClear: () => void;
  }
  const { text, sending, onSendNow, onClear }: Props = $props();
</script>

<div data-testid="queued-message" class="flex items-center gap-2 px-3 pt-2 font-mono text-[11px] text-[var(--cortex-text-muted)]">
  <span class="material-symbols-outlined text-[14px] leading-none">schedule_send</span>
  <span class="min-w-0 flex-1 truncate" title={text}>Queued: <span class="text-[var(--cortex-text)]">{queuePreview(text)}</span></span>
  {#if !sending}
    <button type="button" onclick={onSendNow} class="cursor-pointer rounded px-1.5 py-0.5 text-primary transition-colors hover:bg-primary/10">Send now</button>
  {/if}
  <button type="button" onclick={onClear} aria-label="Clear queued message" class="cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:text-[var(--cortex-text)]">Clear</button>
</div>
