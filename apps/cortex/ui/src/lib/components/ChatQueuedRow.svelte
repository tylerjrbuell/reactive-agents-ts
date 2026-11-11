<script lang="ts">
  import { queuePreview } from "$lib/chat-queue.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Button from "$lib/components/kit/Button.svelte";

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

<!-- A strip above the composer (spec section 8). -->
<div data-testid="queued-message" class="queued">
  <Icon name="steps" size="sm" />
  <span class="what" title={text}>Queued: <span class="msg">“{queuePreview(text)}”</span></span>
  {#if sending}<span class="when">sends when this run ends</span>{:else}<Button size="sm" variant="primary" onclick={onSendNow}>Send now</Button>{/if}
  <Button size="sm" variant="ghost" aria-label="Clear queued message" onclick={onClear}>Clear</Button>
</div>

<style>
  .queued {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 6px 10px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-2);
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-2);
  }
  .what { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .msg { color: var(--cortex-text); }
  .when { color: var(--cortex-text-3); white-space: nowrap; }
</style>
