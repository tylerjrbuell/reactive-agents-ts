<script lang="ts">
  /**
   * Side questions (`/btw`) of this chat, as collapsible asides at the end of the thread.
   * They are not turns: never sent to the model again and never part of the run, so each
   * one says so. Open while pending or just answered; collapsed by the reader.
   */
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { asideTitle } from "$lib/chat-btw.js";
  import { asidesFor, btwStore } from "$lib/stores/chat-btw.js";

  interface Props {
    sessionId: string;
  }
  const { sessionId }: Props = $props();
  const asides = $derived(asidesFor($btwStore, sessionId));
</script>

{#each asides as a (a.id)}
  <details class="aside" open data-status={a.status}>
    <summary>
      <Icon name="info" size="sm" />
      <span class="q">{asideTitle(a)}</span>
      {#if a.status === "pending"}<span class="state" role="status">Asking…</span>{/if}
    </summary>
    <div class="body">
      {#if a.status === "answered"}
        <p class="answer">{a.answer}</p>
      {:else if a.status === "failed"}
        <p class="err" role="alert">{a.error}</p>
      {:else}
        <p class="hint">Answering from the run so far. The run is not interrupted.</p>
      {/if}
      <div class="foot">
        <span class="hint">Side answer: not part of the chat or the run.</span>
        <IconButton icon="x" size="sm" label="Dismiss this side question" onclick={() => btwStore.dismiss(a.id)} />
      </div>
    </div>
  </details>
{/each}

<style>
  .aside {
    margin: 8px 0;
    border: 1px dashed var(--cortex-line-strong);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    color: var(--cortex-text-2);
  }
  summary { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; font-size: var(--cortex-t-sm); min-width: 0; }
  summary:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .q { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cortex-text); }
  .state { margin-left: auto; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .body { padding: 0 12px 10px; display: grid; gap: 8px; }
  .answer { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); color: var(--cortex-text); }
  .err { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-bad); }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
</style>
