<script lang="ts">
  /**
   * The cause of a failed chat turn (e.g. the provider's "400 Your credit balance is too
   * low"), shown above the harness's failure notice. Renders nothing without a cause.
   */
  import { runErrorLine } from "$lib/run-error.js";

  interface Props {
    error: string | undefined;
  }
  const { error }: Props = $props();
  const line = $derived(runErrorLine(error));
</script>

{#if line}
  <p
    data-testid="chat-run-error"
    class="mb-1.5 mt-0 flex items-start gap-1 break-words font-mono text-[10px] leading-relaxed text-red-800 dark:text-red-300"
  >
    <span class="material-symbols-outlined text-[13px] leading-none" aria-hidden="true">error</span>
    <span><span class="font-semibold">Run error:</span> {line}</span>
  </p>
{/if}
