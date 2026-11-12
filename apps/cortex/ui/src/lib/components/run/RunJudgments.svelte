<script lang="ts">
  /**
   * The inspector's Judgments tab: the ledger of every typed judgment the run asked, the ones
   * that failed, and shadow comparisons. Rows come from ui-core `foldJudgments`; wording from
   * `lib/run-judgments.ts`. The events carry no question text, so a row names its question by
   * id and kind. Low-confidence and uncalibrated answers are flagged.
   */
  import type { JudgmentLedger } from "@reactive-agents/ui-core";
  import Badge from "$lib/components/kit/Badge.svelte";
  import {
    JUDGMENTS_EMPTY,
    answerText,
    calibratedText,
    confidenceText,
    latencyText,
    questionText,
    rowFlags,
    rowKindLabel,
  } from "$lib/run-judgments.js";

  interface Props {
    ledger: JudgmentLedger;
  }
  let { ledger }: Props = $props();
</script>

<section class="jl" aria-label="Judgments">
  {#if ledger.rows.length === 0}
    <p class="empty">{JUDGMENTS_EMPTY}</p>
  {:else}
    <p class="sum" data-testid="judgments-summary">
      {ledger.judgments} judgment{ledger.judgments === 1 ? "" : "s"}{ledger.failed > 0 ? `, ${ledger.failed} failed` : ""}{ledger.degraded > 0 ? `, ${ledger.degraded} low confidence or uncalibrated` : ""}{ledger.shadow > 0 ? `. ${ledger.shadow} shadow comparison${ledger.shadow === 1 ? "" : "s"}, ${ledger.shadowDisagreements} disagreeing` : ""}.
    </p>
    <ul>
      {#each ledger.rows as row (row.id)}
        {@const flags = rowFlags(row)}
        <li class="row kind-{row.kind}" class:flagged={flags.some((f) => f.tone !== "ok")}>
          <div class="top">
            <Badge tone={row.kind === "failure" ? "bad" : row.kind === "shadow" ? "neutral" : "accent"}>{rowKindLabel(row)}</Badge>
            <code class="site">{row.site}</code>
            {#if row.backend}<code class="be">{row.backend}</code>{/if}
            {#each flags as f (f.label)}<Badge tone={f.tone}>{f.label}</Badge>{/each}
          </div>
          <p class="q">{questionText(row)}</p>
          <p class="a" data-testid="judgment-answer">{answerText(row)}</p>
          {#if row.kind === "failure" && row.message}<p class="msg">{row.message}</p>{/if}
          <dl class="m">
            <div><dt>Confidence</dt><dd>{confidenceText(row)}</dd></div>
            <div><dt>Calibration</dt><dd>{calibratedText(row)}</dd></div>
            <div><dt>Latency</dt><dd>{latencyText(row)}</dd></div>
          </dl>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .jl { display: grid; gap: 8px; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  p { margin: 0; }
  .empty, .sum { color: var(--cortex-text-2); }
  ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .row { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--cortex-line); border-left-width: 3px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .row.flagged { border-left-color: var(--cortex-warn); }
  .row.kind-failure { border-left-color: var(--cortex-bad); }
  .top { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
  .site, .be { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .q { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-2); overflow-wrap: anywhere; }
  .a { font-weight: 600; overflow-wrap: anywhere; }
  .msg { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); overflow-wrap: anywhere; }
  .m { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; }
  .m div { display: flex; gap: 6px; }
  dt { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  dd { margin: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
</style>
