<script lang="ts">
  /**
   * The assistant turn header's usage: `2.8k in · 560 out` in mono (`turnUsageLabel`),
   * an estimated half marked `~`, the call count, and the per-call split in the title.
   * A live cost ticks while the turn streams. Beside it, the output speed: a live
   * `~tok/s` estimate while a call streams, then the measured `tok/s · TTFT`.
   */
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import { barTitle, splitOfTurn, tokenBars, turnSpeedOf, turnUsageLabel } from "$lib/chat-token-usage.js";
  import { formatCost, formatTokens } from "@reactive-agents/ui-core";

  interface Props {
    turn: ChatTurn;
  }
  const { turn }: Props = $props();

  const streaming = $derived(turn.streaming === true);
  const usage = $derived(turnUsageLabel(splitOfTurn(turn), streaming));
  const calls = $derived(turn.usage?.calls ?? []);
  const title = $derived.by(() => {
    const bars = tokenBars(calls).bars;
    const lines = bars.map((bar, i) => barTitle(bar, calls[i], i + 1));
    const extra = [
      (turn.usage?.billedTokens ?? 0) > 0 ? `Billed ${formatTokens(turn.usage!.billedTokens)} (cache reads subtracted)` : "",
      (turn.usage?.reasoningTokens ?? 0) > 0 ? `Reasoning ${formatTokens(turn.usage!.reasoningTokens)} (in the output count)` : "",
      turn.incomplete ? "Stopped before completion; the tokens spent still count" : "",
    ].filter((l) => l !== "");
    return [usage.title, ...extra, ...lines].join("\n");
  });
  // Live `~tok/s` while a call streams, then the measured speed and TTFT (`turnSpeedOf`).
  const speed = $derived(turnSpeedOf(turn));
  const visible = $derived(calls.length > 0 || streaming || turn.tokensUsed > 0 || (turn.liveTokens ?? 0) > 0);
</script>

{#if visible}
  <span class="usage" use:tooltip={title} data-testid="turn-usage">
    <span>{usage.text}</span>
    {#if calls.length > 1}<span class="faint">· {calls.length} calls</span>{/if}
    {#if streaming && (turn.liveCost ?? 0) > 0}<span class="faint">· {formatCost(turn.liveCost)}</span>{/if}
  </span>
{/if}
{#if speed}
  <span class="usage" use:tooltip={speed.title} data-testid="turn-speed">{speed.text}</span>
{/if}

<style>
  .usage {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--cortex-text-3);
    white-space: nowrap;
    cursor: default;
  }
</style>
