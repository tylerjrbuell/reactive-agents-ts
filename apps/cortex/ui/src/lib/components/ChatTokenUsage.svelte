<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { splitOfTurn, tokenBars } from "$lib/chat-token-usage.js";
  import TokenCounter from "$lib/components/TokenCounter.svelte";

  interface Props {
    turn: ChatTurn;
  }
  const { turn }: Props = $props();

  const split = $derived(splitOfTurn(turn));
  const bars = $derived(tokenBars(turn.usage?.calls ?? []));
  const hasUsage = $derived((turn.usage?.calls.length ?? 0) > 0);
  const streaming = $derived(turn.streaming === true);
  const visible = $derived(hasUsage || streaming || turn.tokensUsed > 0 || (turn.liveTokens ?? 0) > 0);
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
</script>

{#if visible}
  <span class="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--cortex-text-muted)]">
    <TokenCounter direction="in" value={split.tokensIn} estimated={split.estimatedIn} format={fmt} />
    <TokenCounter direction="out" value={split.tokensOut} estimated={split.estimatedOut} format={fmt} />
    {#if streaming}
      <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ra-cyan,#22d3ee)]" title="Streaming" aria-label="Streaming"></span>
    {/if}
    {#if hasUsage}
      <span class="text-[10px] opacity-70">{turn.usage!.calls.length} call{turn.usage!.calls.length === 1 ? "" : "s"}</span>
    {/if}
  </span>
{/if}

{#if hasUsage}
  <span class="inline-flex h-3 items-end gap-[2px]" title="Per-LLM-call token split (cyan = input, violet = output)">
    {#each bars.bars as bar, i (i)}
      <span
        class="relative inline-block overflow-hidden rounded-sm bg-[var(--cortex-surface-mid)]"
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
