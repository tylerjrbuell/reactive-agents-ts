<script lang="ts">
  import type { ChatContext } from "$lib/stores/chat-store.js";
  import { formatSessionCost as formatCost } from "$lib/stores/chat-cost.js";
  import { formatTokens, splitTokens } from "@reactive-agents/ui-core";
  import RollingNumber from "$lib/components/RollingNumber.svelte";
  import Meter from "$lib/components/kit/Meter.svelte";

  interface Props {
    /** Latest context-window reading; absent until a run reports one. */
    context: ChatContext | undefined;
    sessionTokens: number;
    sessionTokensIn?: number;
    sessionTokensOut?: number;
    splitComplete?: boolean;
    /** Per-half live estimation flags while a turn is streaming. */
    sessionInEstimated?: boolean;
    sessionOutEstimated?: boolean;
    streaming?: boolean;
    sessionCost: number;
    /** False when the cost is unpriced or a lower bound (a failed sub-agent is not counted). */
    costKnown?: boolean;
    /** The most recent assistant turn, for the "last turn" rows. */
    last?: { tokens: number; tokensIn?: number; tokensOut?: number; steps?: number; toolCalls: number } | undefined;
    /** Opens the consolidated inspector on the Context tab. */
    onOpenPanel?: () => void;
  }
  const {
    context,
    sessionTokens,
    sessionTokensIn = 0,
    sessionTokensOut = 0,
    splitComplete = true,
    sessionInEstimated = false,
    sessionOutEstimated = false,
    streaming = false,
    sessionCost,
    costKnown = true,
    last,
    onOpenPanel,
  }: Props = $props();

  // Without a known window (a compaction estimate on a fresh session) there is no percentage: tokens only.
  const pct = $derived(context?.utilizationPct === undefined ? 0 : Math.min(100, Math.max(0, Math.round(context.utilizationPct))));
  const filling = $derived(context?.level === "high" || context?.level === "critical");

  // Opens on hover/focus for a quick peek and stays open on click.
  let hover = $state(false);
  let pinned = $state(false);
  const open = $derived(hover || pinned);

  const lastSplit = $derived(last ? splitTokens(last.tokensIn, last.tokensOut, last.tokens) : null);

  const rows = $derived([
    ...(context
      ? [
          ["Context used", `${context.estimated ? "~" : ""}${context.tokensUsed.toLocaleString()}${context.windowTokens !== undefined ? ` of ${context.windowTokens.toLocaleString()}` : ""} tokens`],
          ...(context.utilizationPct !== undefined ? [["Window", `${pct}% full`]] : []),
        ]
      : [["Context", "No reading yet. It appears after the next reply."]]),
    ["Session tokens", sessionTokens.toLocaleString()],
    ...(sessionTokens > 0
      ? [
          ["Session input", `${!splitComplete || sessionInEstimated ? "~" : ""}${sessionTokensIn.toLocaleString()}`],
          ["Session output", `${!splitComplete || sessionOutEstimated ? "~" : ""}${sessionTokensOut.toLocaleString()}`],
        ]
      : []),
    ...(sessionCost > 0 || !costKnown ? [["Session cost", formatCost(sessionCost, costKnown)]] : []),
    ...(last
      ? [
          ["Last reply", `${lastSplit!.estimated ? "~" : ""}${last.tokens.toLocaleString()} tokens`],
          ...(lastSplit!.estimated
            ? [
                ["Last reply in", `~${lastSplit!.tokensIn.toLocaleString()}`],
                ["Last reply out", `~${lastSplit!.tokensOut.toLocaleString()}`],
              ]
            : [
                ["Last reply in", lastSplit!.tokensIn.toLocaleString()],
                ["Last reply out", lastSplit!.tokensOut.toLocaleString()],
              ]),
          ...(last.steps ? [["Steps", String(last.steps)]] : []),
          ["Tool calls", String(last.toolCalls)],
        ]
      : []),
  ] as [string, string][]);
</script>

<svelte:window onclick={() => (pinned = false)} />

<div
  class="relative"
  role="presentation"
  onmouseenter={() => (hover = true)}
  onmouseleave={() => (hover = false)}
  onclick={(e) => e.stopPropagation()}
>
  <button
    type="button"
    onclick={() => {
      if (onOpenPanel) {
        pinned = false;
        hover = false;
        onOpenPanel();
      } else {
        pinned = !pinned;
      }
    }}
    onfocus={() => (hover = true)}
    onblur={() => (hover = false)}
    aria-expanded={open}
    aria-label="Context and usage details"
    class="trigger"
  >
    <!-- Linear context meter (kit Meter): the signal fill only while a reply streams. -->
    <span class="ctx-meter">
      <Meter
        value={context?.utilizationPct ?? 0}
        max={100}
        label="Context window in use"
        live={streaming}
        tone={context?.level === "critical" ? "bad" : context?.level === "high" ? "warn" : "neutral"}
      />
      <span class="ctx-data">
        <span>{context?.utilizationPct !== undefined ? `context ${pct}%` : context ? "context" : "no reading yet"}</span>
        {#if context}<span>{context.estimated ? "~" : ""}{formatTokens(context.tokensUsed)}{context.windowTokens !== undefined ? ` / ${formatTokens(context.windowTokens)}` : ""}</span>{:else if sessionTokens > 0}<span><RollingNumber value={sessionTokens} format={formatTokens} /> tok</span>{/if}
      </span>
    </span>
    {#if sessionCost > 0 || (!costKnown && sessionTokens > 0)}
      <!-- No tooltip: hovering this button opens the details popover, which names the cost. -->
      <span class="cost">{formatCost(sessionCost, costKnown)}</span>
    {/if}
  </button>

  {#if open}
    <div
      role="dialog"
      aria-label="Context and usage"
      class="chat-menu-in pop"
    >
      <dl>
        {#each rows as [label, value] (label)}
          <div class="pop-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        {/each}
      </dl>
      {#if filling}
        <p class="filling">Context is filling up. Run /compact to summarise older messages.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .trigger {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 6px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: none;
    color: var(--cortex-text-3);
    font: inherit;
    cursor: pointer;
  }
  .trigger:hover { background: var(--cortex-surface-2); }
  .ctx-meter { display: grid; gap: 3px; width: 170px; }
  .ctx-data, .cost {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--cortex-text-3);
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    z-index: var(--cortex-z-drawer);
    width: 18rem;
    padding: 12px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop);
    font-size: var(--cortex-t-xs);
    transform-origin: top right;
  }
  dl { display: grid; gap: 6px; margin: 0; }
  .pop-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  dt { color: var(--cortex-text-2); }
  dd { margin: 0; text-align: right; font-family: var(--cortex-font-data); font-variant-numeric: tabular-nums; color: var(--cortex-text); }
  .filling { margin: 8px 0 0; color: var(--cortex-warn); }
</style>
