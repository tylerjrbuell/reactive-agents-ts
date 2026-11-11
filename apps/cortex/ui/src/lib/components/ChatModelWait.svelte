<script lang="ts">
  /**
   * "Waiting for Ollama (loading the model or queued) · 1m 39s": a call is out and
   * no token is back yet (ui-core `foldModelWait`), so a loading or busy model never
   * reads as the model thinking. Mounted only while the turn waits, so idle turns never tick.
   */
  import { formatTurnDuration, modelWaitLabel } from "@reactive-agents/ui-core";
  import { secondClock } from "$lib/stores/clock.js";
  import Icon from "$lib/components/kit/Icon.svelte";

  const { since, provider, stepLine }: { since: number; provider?: string; stepLine?: string } = $props();
  const elapsed = $derived(formatTurnDuration(Math.max($secondClock, since) - since));
</script>

<p class="wait" data-testid="model-wait">
  <Icon name="clock" size="sm" />{modelWaitLabel(provider)}
  <span class="meta">{#if stepLine}{stepLine} · {/if}<span class="tabular-nums">{elapsed}</span></span>
  <span class="chat-dots" aria-hidden="true"><i></i><i></i><i></i></span>
</p>

<style>
  .wait { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .meta { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .chat-dots { display: inline-flex; align-items: center; gap: 2px; }
</style>
