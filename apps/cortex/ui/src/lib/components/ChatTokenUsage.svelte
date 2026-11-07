<script lang="ts">
  import { tokenBars, tokenRangeLabel } from "$lib/chat-token-usage.js";
  import type { TurnUsage } from "@reactive-agents/ui-core";
  import { splitTokens } from "@reactive-agents/ui-core";

  interface Props {
    usage?: TurnUsage;
    tokensUsed: number;
    tokensIn?: number;
    tokensOut?: number;
    streaming?: boolean;
  }
  const { usage, tokensUsed, tokensIn, tokensOut, streaming = false }: Props = $props();

  const split = $derived(splitTokens(tokensIn, tokensOut, tokensUsed));
  const bars = $derived(tokenBars(usage?.calls ?? []));
  const label = $derived(
    usage && usage.calls.length > 0
      ? tokenRangeLabel(usage)
      : `${split.estimated ? "~" : ""}${tokensUsed.toLocaleString()} tok`,
  );
  const hasUsage = $derived((usage?.calls.length ?? 0) > 0);
</script>

<span class="inline-flex items-center gap-2 text-[11px] tabular-nums text-[var(--cortex-text-muted)]">
  {#if streaming && !hasUsage}
    <span class="animate-pulse">~{tokensUsed.toLocaleString()} tok</span>
  {:else}
    <span>{label}</span>
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
