<script lang="ts">
  /**
   * A "Running now" card on the Board (spec section 8, `beacon.html`): the
   * live glow and gradient edge (running only), name, source and run time,
   * the goal, what the agent is doing now, a 96px entropy line with `η`, the
   * live loop meter and the step / tokens / cost line. Model: `LiveCard` from
   * `lib/beacon-board.ts`.
   */
  import { formatTurnDuration } from "@reactive-agents/ui-core";
  import Badge from "../kit/Badge.svelte";
  import Button from "../kit/Button.svelte";
  import EntropyLine from "../kit/EntropyLine.svelte";
  import Meter from "../kit/Meter.svelte";
  import Status from "../kit/Status.svelte";
  import type { LiveCard } from "../../beacon-board.js";

  interface Props {
    card: LiveCard;
  }

  let { card }: Props = $props();
</script>

<article class="livecard rail rail-live glow-live" aria-label="{card.name}, running" data-run-id={card.runId}>
  <div class="top">
    <Status tone="running" label="Running" dotOnly />
    <a class="nm" href="/run/{card.runId}">{card.name}</a>
    <Badge>{card.source}</Badge>
    {#if card.elapsedMs !== undefined}<span class="data t">{formatTurnDuration(card.elapsedMs)}</span>{/if}
  </div>
  {#if card.goal}<p class="goal">{card.goal}</p>{/if}
  <div class="mid">
    <div class="now">
      {card.activity.verb}
      {#if card.activity.tool}<span class="tool">{card.activity.tool}</span>{/if}
      {#if card.activity.detail}<span class="faint">{card.activity.detail}</span>{/if}
    </div>
    {#if card.entropy.length > 0}
      <EntropyLine values={card.entropy} width={96} height={24} label="Entropy per step" />
    {/if}
  </div>
  <div class="foot">
    {#if card.max > 0}
      <Meter class="meter" value={card.loop} max={card.max} live label="Loop {card.loop} of {card.max}" />
    {:else}
      <span class="meter-gap"></span>
    {/if}
    {#if card.foot}<span class="data">{card.foot}</span>{/if}
    <Button size="sm" href="/run/{card.runId}">Open</Button>
  </div>
</article>

<style>
  .livecard {
    min-width: 0;
    display: grid;
    gap: 12px;
    padding: 16px 16px 16px 20px;
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    border: 1px solid var(--cortex-line);
  }
  .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--cortex-t-md);
    font-weight: 600;
    color: var(--cortex-text);
    text-decoration: none;
  }
  .nm:hover { text-decoration: underline; text-underline-offset: 3px; }
  .data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); font-variant-numeric: tabular-nums; }
  .t { margin-left: auto; flex: none; }
  .goal { margin: 0; max-width: 60ch; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); line-height: var(--cortex-lh-ui); }
  .mid { display: flex; align-items: flex-end; gap: 16px; }
  .now {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-2);
    white-space: nowrap;
    overflow: hidden;
  }
  .tool { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-io); }
  .faint { color: var(--cortex-text-3); overflow: hidden; text-overflow: ellipsis; }
  .foot { display: flex; align-items: center; gap: 16px; }
  .foot :global(.meter), .meter-gap { flex: 1; min-width: 60px; }
</style>
