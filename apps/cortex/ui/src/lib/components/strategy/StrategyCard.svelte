<script lang="ts">
  /**
   * The live card for the strategy a turn runs: a pill (the strategy's name, its current phase, a
   * chevron) over a body picked by the registry (strategy-visuals/registry.ts). The chrome is the
   * goal-checks card's, so the two read as one family: open while the strategy runs or a phase
   * failed, collapsed to a one-line summary once it ended, and a click pins the viewer's choice.
   */
  import type { ReactLoop, StrategyRunState } from "@reactive-agents/ui-core";
  import { strategyStatusOf } from "@reactive-agents/ui-core";
  import ReactLoopRows from "./ReactLoopRows.svelte";
  import { strategyCardModel } from "../../strategy-visuals/registry.js";
  import Icon from "../kit/Icon.svelte";
  import PhaseRows from "./PhaseRows.svelte";
  import TotLevels from "./TotLevels.svelte";
  import AttemptGroups from "./AttemptGroups.svelte";

  interface Props {
    run: StrategyRunState | undefined;
    /** True when the goal-checks card already draws the strategy's plan. */
    hasPlan?: boolean;
    /** The turn's ReAct loop (ui-core `reactLoopOf`); the `loop` view draws it, other views ignore it. */
    loop?: ReactLoop;
  }
  const { run, hasPlan = false, loop }: Props = $props();

  const model = $derived(strategyCardModel(run, { statusLine: run ? strategyStatusOf(run) : undefined, hasPlan, loop }));

  // null = follow the default; a click pins the viewer's choice.
  let pinned = $state<boolean | null>(null);
  const open = $derived(pinned ?? model.openByDefault);
  const failed = $derived(run?.rows.some((r) => r.status === "failed") ?? false);
</script>

{#if model.show && run}
  <section class="strat" aria-label="{model.title} progress" data-testid="strategy-card" data-kind={model.kind}>
    <button type="button" class="pill" data-state={run.ended ? (failed ? "failed" : "done") : "running"} aria-expanded={open} aria-controls="strategy-body" onclick={() => (pinned = !open)}>
      <Icon name="steps" size="sm" />
      <span class="head-label">{model.title}</span>
      <span class="muted" data-testid="strategy-chip">· {model.chip}</span>
      <span class="chev" class:open><Icon name="down" size="sm" /></span>
    </button>

    {#if open}
      <div id="strategy-body" class="body">
        {#if model.kind === "tree"}
          <TotLevels {run} />
        {:else if model.kind === "attempts"}
          <AttemptGroups {run} noun={model.noun} />
        {:else if model.kind === "loop" && loop}
          <ReactLoopRows {loop} />
        {:else}
          <PhaseRows rows={run.rows} />
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .strat { font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    font: inherit;
    font-size: var(--cortex-t-xs);
    font-weight: 500;
    cursor: pointer;
  }
  .pill:hover { color: var(--cortex-text); }
  .pill[data-state="running"] { color: var(--cortex-accent); background: var(--cortex-accent-tint); }
  .pill[data-state="done"] { color: var(--cortex-ok); background: var(--cortex-ok-tint); }
  .pill[data-state="failed"] { color: var(--cortex-warn); background: var(--cortex-warn-tint); }
  .head-label { white-space: nowrap; }
  .muted { opacity: 0.85; font-variant-numeric: tabular-nums; }
  .chev { display: inline-flex; transition: transform var(--cortex-d-fast); }
  .chev.open { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
  .body { margin-top: 6px; padding: 4px 0 2px 10px; border-left: 1px solid var(--cortex-line); }
</style>
