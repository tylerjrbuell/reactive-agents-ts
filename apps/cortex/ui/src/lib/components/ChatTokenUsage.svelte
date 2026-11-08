<script lang="ts">
  import { tokenBars, tokenRangeLabel } from "$lib/chat-token-usage.js";
  import type { TurnUsage } from "@reactive-agents/ui-core";
  import { splitTokens } from "@reactive-agents/ui-core";
  import RollingNumber from "$lib/components/RollingNumber.svelte";

  interface Props {
    usage?: TurnUsage;
    tokensUsed: number;
    tokensIn?: number;
    tokensOut?: number;
    liveTokens?: number;
    streaming?: boolean;
  }
  const { usage, tokensUsed, tokensIn, tokensOut, liveTokens, streaming = false }: Props = $props();

  const total = $derived(streaming ? (liveTokens ?? tokensUsed) : tokensUsed);
  const split = $derived(
    usage && usage.calls.length > 0
      ? { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, estimated: usage.estimated }
      : splitTokens(tokensIn, tokensOut, total),
  );
  const bars = $derived(tokenBars(usage?.calls ?? []));
  const hasUsage = $derived((usage?.calls.length ?? 0) > 0);
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  const estimated = $derived(split.estimated);
</script>

<span class="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--cortex-text-muted)]">
  {#if streaming && !hasUsage}
    <span class="animate-pulse">~<RollingNumber value={total} format={fmt} /> tok</span>
  {:else}
    <span>↑<RollingNumber value={split.tokensIn} format={fmt} /></span>
    <span>↓<RollingNumber value={split.tokensOut} format={fmt} /></span>
    {#if estimated}<span class="opacity-60">~</span>{/if}
  {/if}
  {#if hasUsage}
    <span class="text-[10px] opacity-70">{usage!.calls.length} call{usage!.calls.length === 1 ? "" : "s"}</span>
  {/if}
</span>

{#if hasUsage}
  <span class="inline-flex items-end gap-[2px] h-3" title="Per-LLM-call token split (cyan = input, violet = output)">
    {#each bars.bars as bar, i (i)}
      <span
        class="relative inline-block rounded-sm bg-[var(--cortex-surface-mid)] overflow-hidden"
        style:width="{Math.max(2, bar.width * 16)}px"
        style:height="100%"
        title={`call ${i + 1}: ${bar.total} tok${bar.total === 0 ? "" : ` (${bar.in} in / ${bar.out} out)`}`}
      >
        <span class="block bg-[var(--ra-cyan,#22d3ee)]" style:height="{bar.inShare * 100}%"></span>
        <span class="block bg-[var(--ra-primary,#8b5cf6)]" style:height="{bar.outShare * 100}%"></span>
      </span>
    {/each}
    {#if bars.overflow > 0}
      <span class="text-[9px] opacity-60">+{bars.overflow}</span>
    {/if}
  </span>
{/if}
