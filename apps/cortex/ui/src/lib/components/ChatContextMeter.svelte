<script lang="ts">
  import Tooltip from "$lib/components/Tooltip.svelte";
  import type { ChatContext } from "$lib/stores/chat-store.js";
  import { formatCost } from "$lib/stores/chat-cost.js";
  import { splitTokens } from "@reactive-agents/ui-core";
  import TokenCounter from "$lib/components/TokenCounter.svelte";
  import RollingNumber from "$lib/components/RollingNumber.svelte";

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

  const R = 10;
  const CIRC = 2 * Math.PI * R;
  const pct = $derived(context ? Math.min(100, Math.max(0, Math.round(context.utilizationPct))) : 0);
  const stroke = $derived(
    context?.level === "critical" ? "var(--color-error, #f87171)"
    : context?.level === "high" ? "#f59e0b"
    : "var(--ra-cyan, #22d3ee)",
  );
  const filling = $derived(context?.level === "high" || context?.level === "critical");
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

  // Opens on hover/focus for a quick peek and stays open on click.
  let hover = $state(false);
  let pinned = $state(false);
  const open = $derived(hover || pinned);

  const lastSplit = $derived(last ? splitTokens(last.tokensIn, last.tokensOut, last.tokens) : null);

  const rows = $derived([
    ...(context
      ? [
          ["Context used", `${context.estimated ? "~" : ""}${context.tokensUsed.toLocaleString()} of ${context.windowTokens.toLocaleString()} tokens`],
          ["Window", `${pct}% full`],
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
    class="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)]"
  >
    <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r={R} fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="3.5" />
      {#if context}
        <circle
          cx="13"
          cy="13"
          r={R}
          fill="none"
          {stroke}
          stroke-width="3.5"
          stroke-linecap="round"
          stroke-dasharray={CIRC}
          stroke-dashoffset={CIRC * (1 - pct / 100)}
          transform="rotate(-90 13 13)"
          style="transition: stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.3s"
        />
      {/if}
    </svg>
    {#if context}<span class="text-[var(--cortex-text)]">{pct}%</span>{/if}
    {#if sessionTokens > 0}
      <span class="inline-flex items-baseline gap-1">
        <span class="text-[var(--cortex-text)]"><RollingNumber value={sessionTokens} format={fmt} /></span>
        <span class="text-[10px] opacity-60">tok</span>
      </span>
      <TokenCounter direction="in" value={sessionTokensIn} estimated={sessionInEstimated} format={fmt} />
      <TokenCounter direction="out" value={sessionTokensOut} estimated={sessionOutEstimated} format={fmt} />
    {/if}
    {#if streaming}
      <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ra-cyan,#22d3ee)]" aria-label="Streaming"></span>
    {/if}
    {#if sessionCost > 0 || (!costKnown && sessionTokens > 0)}
      <Tooltip text={costKnown ? "Session cost" : "Session cost: unpriced or incomplete"}><span>{formatCost(sessionCost, costKnown)}</span></Tooltip>
    {/if}
  </button>

  {#if open}
    <div
      role="dialog"
      aria-label="Context and usage"
      class="chat-menu-in absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] p-3 text-[12px] shadow-xl backdrop-blur-md"
      style="transform-origin: top right"
    >
      <dl class="m-0 space-y-1.5">
        {#each rows as [label, value] (label)}
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-[var(--cortex-text-muted)]">{label}</dt>
            <dd class="m-0 text-right tabular-nums text-[var(--cortex-text)]">{value}</dd>
          </div>
        {/each}
      </dl>
      {#if context}
        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--cortex-surface-mid)]" aria-hidden="true">
          <div class="h-full rounded-full transition-[width] duration-500" style:width="{pct}%" style:background={stroke}></div>
        </div>
      {/if}
      {#if filling}
        <p class="m-0 mt-2 text-amber-500">Context is filling up. Run /compact to summarise older messages.</p>
      {/if}
    </div>
  {/if}
</div>
