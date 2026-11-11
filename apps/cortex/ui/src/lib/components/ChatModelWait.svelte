<script lang="ts">
  /**
   * "Waiting for the model · 1m 39s": a call is out and no token is back yet
   * (ui-core `foldModelWait`), so a loading or busy model never reads as the
   * model thinking. Mounted only while the turn waits, so idle turns never tick.
   */
  import { formatTurnDuration, modelWaitLabel } from "@reactive-agents/ui-core";
  import { secondClock } from "$lib/stores/clock.js";

  const { since, provider }: { since: number; provider?: string } = $props();
  const elapsed = $derived(formatTurnDuration(Math.max($secondClock, since) - since));
</script>

<p class="my-1 font-mono text-[11px] italic text-[var(--cortex-text-muted)]" data-testid="model-wait">
  {modelWaitLabel(provider)} · <span class="tabular-nums">{elapsed}</span><span class="chat-dots ml-1 inline-flex items-center gap-0.5 align-middle" aria-hidden="true"><i></i><i></i><i></i></span>
</p>
