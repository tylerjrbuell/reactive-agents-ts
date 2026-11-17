<script lang="ts">
  /**
   * The router's outbox (messages waiting to be sent, sent, failed) and follow-up timers (pending, fired,
   * cancelled). Draws only what the router reports: with no durable outbox or no timers there is nothing
   * to show, never a zero. Rules live in `lib/channel-router-queues.ts`.
   */
  import { queueGroups, type OutboxCountsWire, type TimerCountsWire } from "$lib/channel-router-queues.js";

  interface Props {
    outbox: OutboxCountsWire | null;
    timers: TimerCountsWire | null;
  }
  let { outbox, timers }: Props = $props();
  const groups = $derived(queueGroups(outbox, timers));
</script>

{#each groups as g (g.label)}
  <dl class="qs" aria-label={g.label}>
    <dt class="qs-h">{g.label}</dt>
    {#each g.rows as r (r.status)}
      <div class="qs-i"><dt>{r.status}</dt><dd>{r.count}</dd></div>
    {/each}
  </dl>
{/each}

<style>
  .qs { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0; font-size: var(--cortex-t-sm); }
  .qs-h { font-weight: 600; color: var(--cortex-text); }
  .qs-i { display: flex; gap: 6px; align-items: baseline; }
  .qs dt { color: var(--cortex-text-2); }
  .qs-h { color: var(--cortex-text); }
  .qs dd { margin: 0; font-family: var(--cortex-font-data); color: var(--cortex-text); }
</style>
