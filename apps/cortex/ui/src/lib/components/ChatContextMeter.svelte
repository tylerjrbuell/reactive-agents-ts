<script lang="ts">
  import type { ChatContext } from "$lib/stores/chat-store.js";

  interface Props {
    /** Latest context-window reading; absent until a run reports one. */
    context: ChatContext | undefined;
    sessionTokens: number;
    sessionCost: number;
    /** The most recent assistant turn, for the "last turn" rows. */
    last?: { tokens: number; steps?: number; toolCalls: number } | undefined;
  }
  const { context, sessionTokens, sessionCost, last }: Props = $props();

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

  const rows = $derived([
    ...(context
      ? [
          ["Context used", `${context.tokensUsed.toLocaleString()} of ${context.windowTokens.toLocaleString()} tokens`],
          ["Window", `${pct}% full`],
        ]
      : [["Context", "No reading yet. It appears after the next reply."]]),
    ["Session tokens", sessionTokens.toLocaleString()],
    ...(sessionCost > 0 ? [["Session cost", `$${sessionCost.toFixed(4)}`]] : []),
    ...(last
      ? [
          ["Last reply", `${last.tokens.toLocaleString()} tokens`],
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
    onclick={() => (pinned = !pinned)}
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
    {#if sessionTokens > 0}<span>{fmt(sessionTokens)} tok</span>{/if}
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
