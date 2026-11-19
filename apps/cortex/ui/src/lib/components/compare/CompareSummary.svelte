<script lang="ts">
  /**
   * Run compare, summary: outcome, model, strategy, loops, tokens, cost,
   * duration and output speed of both runs side by side, with B minus A where
   * a number moved. Every run Cortex stored has this, trace or not.
   */
  import { formatCost, formatCostTotal, formatFirstToken, formatTokens, formatTurnDuration } from "@reactive-agents/ui-core";
  import Status from "$lib/components/kit/Status.svelte";
  import { runRowStatus } from "$lib/runs-table.js";
  import { signedDelta, speedLabel, type CompareSide } from "$lib/run-compare.js";

  interface Props {
    a: CompareSide;
    b: CompareSide;
    strategyLabel: (id: string) => string;
  }
  const { a, b, strategyLabel }: Props = $props();

  interface Row {
    readonly label: string;
    readonly a: string;
    readonly b: string;
    /** B − A text; unset for a row with no numeric difference. */
    readonly delta?: string;
    readonly differs: boolean;
  }

  const num = (x: number | undefined, y: number | undefined, fmt: (n: number) => string): string | undefined =>
    x !== undefined && y !== undefined ? signedDelta(y - x, fmt) : undefined;

  const rows = $derived.by((): Row[] => {
    const text = (label: string, x: string, y: string): Row => ({ label, a: x, b: y, differs: x !== y });
    const sa = a.speed.tokensPerSecond?.median;
    const sb = b.speed.tokensPerSecond?.median;
    const ta = a.speed.firstTokenMs?.median;
    const tb = b.speed.firstTokenMs?.median;
    return [
      text("Model", `${a.run.provider ?? "?"} / ${a.run.model ?? "?"}`, `${b.run.provider ?? "?"} / ${b.run.model ?? "?"}`),
      text("Strategy", a.run.strategy ? strategyLabel(a.run.strategy) : "—", b.run.strategy ? strategyLabel(b.run.strategy) : "—"),
      { label: "Loops", a: String(a.run.iterationCount), b: String(b.run.iterationCount), delta: num(a.run.iterationCount, b.run.iterationCount, String), differs: a.run.iterationCount !== b.run.iterationCount },
      { label: "Tokens", a: formatTokens(a.run.tokensUsed), b: formatTokens(b.run.tokensUsed), delta: num(a.run.tokensUsed, b.run.tokensUsed, formatTokens), differs: a.run.tokensUsed !== b.run.tokensUsed },
      // A partial cost (an unpriced call) reads as a lower bound; the delta between lower bounds is not shown.
      {
        label: "Cost",
        a: formatCostTotal(a.run.cost, a.run.costComplete !== false),
        b: formatCostTotal(b.run.cost, b.run.costComplete !== false),
        delta: a.run.costComplete === false || b.run.costComplete === false ? undefined : num(a.run.cost, b.run.cost, formatCost),
        differs: a.run.cost !== b.run.cost,
      },
      {
        label: "Duration",
        a: a.durationMs !== undefined ? formatTurnDuration(a.durationMs) : "—",
        b: b.durationMs !== undefined ? formatTurnDuration(b.durationMs) : "—",
        delta: num(a.durationMs, b.durationMs, formatTurnDuration),
        differs: a.durationMs !== b.durationMs,
      },
      { label: "Speed", a: speedLabel(a.speed), b: speedLabel(b.speed), delta: num(sa, sb, (n) => `${Math.round(n)} tok/s`), differs: sa !== sb },
      {
        label: "First token",
        a: ta !== undefined ? formatFirstToken(ta) : "—",
        b: tb !== undefined ? formatFirstToken(tb) : "—",
        delta: num(ta, tb, formatFirstToken),
        differs: ta !== tb,
      },
    ];
  });

  const statusA = $derived(runRowStatus(a.run));
  const statusB = $derived(runRowStatus(b.run));
</script>

<div class="table" role="table" aria-label="Run summary, side by side">
  <div class="tr head" role="row">
    <span role="columnheader"></span>
    <span role="columnheader"><span class="tag">A</span></span>
    <span role="columnheader"><span class="tag">B</span></span>
    <span role="columnheader" class="d">B vs A</span>
  </div>
  <div class="tr" role="row" class:differs={statusA.label !== statusB.label}>
    <span role="rowheader" class="k">Outcome</span>
    <span role="cell"><Status tone={statusA.tone} label={statusA.label} /></span>
    <span role="cell"><Status tone={statusB.tone} label={statusB.label} /></span>
    <span role="cell" class="d">{statusA.label === statusB.label ? "same" : "changed"}</span>
  </div>
  {#each rows as r (r.label)}
    <div class="tr" role="row" class:differs={r.differs}>
      <span role="rowheader" class="k">{r.label}</span>
      <span role="cell" class="v">{r.a}</span>
      <span role="cell" class="v">{r.b}</span>
      <span role="cell" class="d">{r.delta ?? (r.differs ? "changed" : "same")}</span>
    </div>
  {/each}
</div>

<style>
  .table { display: grid; font-size: var(--cortex-t-sm); }
  .tr { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr) minmax(0, 1fr) 7rem; align-items: center; gap: 12px; padding: 7px 4px; border-top: 1px solid var(--cortex-line); }
  .tr.head { border-top: 0; padding-top: 0; color: var(--cortex-text-3); font-size: var(--cortex-t-xs); }
  .k { color: var(--cortex-text-3); }
  .v { min-width: 0; overflow-wrap: anywhere; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .d { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); text-align: right; }
  .differs .d { color: var(--cortex-text); }
  .differs .k { color: var(--cortex-text-2); }
  .tag { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--cortex-surface-2); font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text); }
  @media (max-width: 640px) {
    .tr { grid-template-columns: 5.5rem minmax(0, 1fr) minmax(0, 1fr); }
    .d { display: none; }
  }
</style>
