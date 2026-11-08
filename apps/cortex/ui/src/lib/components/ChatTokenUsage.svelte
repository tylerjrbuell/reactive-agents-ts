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
  const split = $derived.by(() => {
    if (usage && usage.calls.length > 0) {
      const reportedIn = usage.tokensIn;
      const reportedOut = usage.tokensOut;
      // While streaming, grow the output half as the live total grows so the
      // counter rolls in realtime instead of freezing between TokenUsage events.
      if (streaming && total > reportedIn + reportedOut) {
        return { tokensIn: reportedIn, tokensOut: total - reportedIn, estimated: true };
      }
      return { tokensIn: reportedIn, tokensOut: reportedOut, estimated: usage.estimated };
    }
    return splitTokens(tokensIn, tokensOut, total);
  });
  const bars = $derived(tokenBars(usage?.calls ?? []));
  const hasUsage = $derived((usage?.calls.length ?? 0) > 0);
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  const estimated = $derived(split.estimated);

  let bumpIn = $state(false);
  let bumpOut = $state(false);
  $effect(() => {
    split.tokensIn;
    bumpIn = true;
    const t = setTimeout(() => (bumpIn = false), 320);
    return () => clearTimeout(t);
  });
  $effect(() => {
    split.tokensOut;
    bumpOut = true;
    const t = setTimeout(() => (bumpOut = false), 320);
    return () => clearTimeout(t);
  });
</script>

<span class="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--cortex-text-muted)]">
  {#if streaming && !hasUsage}
    <span class="animate-pulse">~<RollingNumber value={total} format={fmt} /> tok</span>
  {:else}
    <span class="inline-flex items-center gap-0.5">
      <span class="inline-block w-3 text-center transition-transform duration-200 {bumpIn ? 'scale-125 text-[var(--ra-cyan,#22d3ee)]' : ''}">↑</span>
      <RollingNumber value={split.tokensIn} format={fmt} />
    </span>
    <span class="inline-flex items-center gap-0.5">
      <span class="inline-block w-3 text-center transition-transform duration-200 {bumpOut ? 'scale-125 text-[var(--ra-primary,#8b5cf6)]' : ''}">↓</span>
      <RollingNumber value={split.tokensOut} format={fmt} />
    </span>
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
