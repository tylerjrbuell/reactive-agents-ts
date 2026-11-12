<script lang="ts">
  /**
   * The cause of a failed chat turn (e.g. the provider's "400 Your credit balance is too
   * low") in the red ending box, with Retry when the host offers it. Without a cause it
   * still says the run stopped before it could answer.
   */
  import { isOllamaAuthError, runErrorLine } from "$lib/run-error.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Button from "$lib/components/kit/Button.svelte";

  interface Props {
    error: string | undefined;
    /** Retry the turn (the latest one only). */
    onRetry?: () => void;
  }
  const { error, onRetry }: Props = $props();
  const line = $derived(runErrorLine(error));
</script>

<div class="ending" role="note">
  <p class="h"><Icon name="alert" size="sm" /><span>The run stopped before it could answer</span></p>
  {#if line}<p class="line" data-testid="chat-run-error"><span class="lbl">Run error:</span> {line}</p>{/if}
  {#if isOllamaAuthError(error)}<p class="line"><a class="underline" href="/settings#providers">Open Settings · Providers</a></p>{/if}
  {#if onRetry}<div class="acts"><Button size="sm" variant="ghost" icon="retry" onclick={onRetry}>Retry</Button></div>{/if}
</div>

<style>
  .ending {
    display: grid;
    gap: 6px;
    max-width: var(--cortex-measure);
    padding: 12px 14px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-bad-tint);
    color: var(--cortex-text);
  }
  .h { display: flex; align-items: center; gap: 6px; margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-bad); }
  .line { margin: 0; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); color: var(--cortex-text-2); overflow-wrap: anywhere; }
  .lbl { color: var(--cortex-text); font-weight: 500; }
  .acts { display: flex; gap: 6px; margin-top: 2px; }
</style>
