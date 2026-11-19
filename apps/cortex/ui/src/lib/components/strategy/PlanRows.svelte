<script lang="ts">
  /**
   * The plan-style strategy view (plan-execute-reflect, blueprint, rewoo): one row per phase, and for
   * every plan step its badges (retried, patched, failed) with the ordered history one click away, so
   * a retry or patch stays visible after the step settled. With `historyOnly` (the goal-checks card
   * already draws the plan) only the steps that have something to tell are listed.
   */
  import { planStepBadgesOf, planStepEventLine, planStepsOf, type StrategyRow } from "@reactive-agents/ui-core";
  import type { StrategyRunState } from "@reactive-agents/ui-core";
  import Icon from "../kit/Icon.svelte";
  import PhaseRows from "./PhaseRows.svelte";

  interface Props {
    run: StrategyRunState;
    historyOnly?: boolean;
  }
  const { run, historyOnly = false }: Props = $props();

  const steps = $derived(planStepsOf(run));
  const byKey = $derived(new Map(steps.map((s) => [s.key, s])));
  const rows = $derived<readonly StrategyRow[]>(historyOnly ? run.rows.filter((r) => byKey.get(r.key)?.notable === true) : run.rows);

  const ICON = { running: "retry", done: "check-circle", failed: "alert-circle" } as const;
</script>

{#if !historyOnly && steps.every((s) => s.events.length === 0)}
  <PhaseRows rows={run.rows} />
{:else}
  <ol class="rows">
    {#each rows as r (r.key)}
      {@const step = byKey.get(r.key)}
      <li class="row" data-status={r.status} data-testid="plan-row">
        <span class="ico" role="img" aria-label={r.status}><Icon name={ICON[r.status]} size="sm" /></span>
        <span class="main">
          <span class="title">
            {r.label}
            {#if step}
              {#each planStepBadgesOf(step) as badge (badge)}<span class="badge" data-badge={badge.split(" ")[0]} data-testid="plan-badge">{badge}</span>{/each}
            {/if}
          </span>
          {#if step && step.events.length > 0 && step.notable}
            <details class="hist" data-testid="plan-history">
              <summary>History ({step.events.length})</summary>
              <ol class="events">
                {#each step.events as e, i (i)}<li data-kind={e.kind}>{planStepEventLine(e)}</li>{/each}
              </ol>
            </details>
          {/if}
        </span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .rows, .events { margin: 0; padding: 0; list-style: none; }
  .row { display: flex; align-items: flex-start; gap: 6px; padding: 1px 4px; line-height: var(--cortex-lh-ui); }
  .ico { display: inline-flex; flex: none; padding-top: 1px; color: var(--cortex-text-3); }
  .row[data-status="done"] .ico { color: var(--cortex-ok); }
  .row[data-status="done"] .title { color: var(--cortex-text-2); }
  .row[data-status="running"] .ico { color: var(--cortex-accent); }
  .row[data-status="failed"] .ico, .row[data-status="failed"] .title { color: var(--cortex-bad); }
  .main { display: grid; min-width: 0; gap: 2px; }
  .badge {
    margin-left: 6px;
    padding: 0 6px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    font-size: var(--cortex-t-xs);
  }
  .badge[data-badge="failed"] { color: var(--cortex-bad); }
  .badge[data-badge="retried"], .badge[data-badge="patched"] { color: var(--cortex-warn); }
  .hist { color: var(--cortex-text-2); }
  .hist summary { cursor: pointer; color: var(--cortex-text-3); }
  .events { padding-left: 10px; overflow-wrap: anywhere; }
  .events li { padding: 1px 0; }
  .events li[data-kind="failed"] { color: var(--cortex-bad); }
</style>
