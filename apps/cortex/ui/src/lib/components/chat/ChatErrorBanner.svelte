<script lang="ts">
  /** A send that failed before any turn could show it: the cause and, when there is a last message, Retry. */
  import Icon from "$lib/components/kit/Icon.svelte";
  import Button from "$lib/components/kit/Button.svelte";

  const { error, onRetry }: { error: string; onRetry?: () => void } = $props();
</script>

<div class="err" role="alert" data-testid="chat-error">
  <Icon name="alert" size="sm" />
  <span class="msg">{error}</span>
  {#if onRetry}<Button size="sm" variant="ghost" icon="retry" onclick={onRetry}>Retry</Button>{/if}
</div>

<style>
  .err {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: var(--cortex-chat-col);
    margin: 0 auto 8px;
    padding: 6px 6px 6px 12px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-bad-tint);
    color: var(--cortex-bad);
    font-size: var(--cortex-t-sm);
  }
  .msg { flex: 1; min-width: 0; color: var(--cortex-text); overflow-wrap: anywhere; }
</style>
