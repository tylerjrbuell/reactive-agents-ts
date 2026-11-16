<script lang="ts">
  /**
   * The router inbox: how many received messages are waiting, running, done, failed or dropped. Shown
   * only when the router's store keeps a durable inbox; otherwise one line says messages wait in memory
   * and a restart loses unanswered ones. Rules live in `lib/channel-inbox.ts`.
   */
  import { IN_MEMORY_INBOX_NOTE, inboxRows, type InboxCountsWire } from "$lib/channel-inbox.js";

  interface Props {
    inbox: InboxCountsWire | null;
  }
  let { inbox }: Props = $props();
  const rows = $derived(inboxRows(inbox));
</script>

{#if rows.length > 0}
  <dl class="ib" aria-label="Router inbox">
    {#each rows as r (r.status)}
      <div class="ib-i"><dt>{r.status}</dt><dd>{r.count}</dd></div>
    {/each}
  </dl>
{:else}
  <p class="ib-note">{IN_MEMORY_INBOX_NOTE}</p>
{/if}

<style>
  .ib { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0; font-size: var(--cortex-t-sm); }
  .ib-i { display: flex; gap: 6px; align-items: baseline; }
  .ib dt { color: var(--cortex-text-2); }
  .ib dd { margin: 0; font-family: var(--cortex-font-data); color: var(--cortex-text); }
  .ib-note { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
</style>
