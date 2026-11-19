<script lang="ts">
  /**
   * The generic strategy view: one row per phase the run entered, in the goal-checks card's row
   * language (icon, title). A row shows the detail the framework reported for it (critique text,
   * code, sandbox output) and simply has none when it did not.
   */
  import type { StrategyRow } from "@reactive-agents/ui-core";
  import Icon from "../kit/Icon.svelte";

  interface Props {
    rows: readonly StrategyRow[];
  }
  const { rows }: Props = $props();

  const ICON = { running: "retry", done: "check-circle", failed: "alert-circle" } as const;
  const WORD = { running: "running", done: "done", failed: "failed" } as const;
</script>

<ol class="rows">
  {#each rows as r (r.key)}
    <li class="row" class:current={r.status === "running"} data-status={r.status} data-testid="strategy-row">
      <span class="ico" role="img" aria-label={WORD[r.status]}><Icon name={ICON[r.status]} size="sm" /></span>
      <span class="main">
        <span class="title">{r.label}{#if r.sub && r.sub.startsWith("retry")}<span class="muted"> (retry)</span>{/if}</span>
        {#if r.critique}
          <span class="detail" data-testid="strategy-critique">
            {#if r.accepted !== undefined}<span class="verdict" data-accepted={r.accepted} data-testid="critique-verdict">{r.accepted ? "Satisfied" : "Needs work"}</span>{/if}
            {r.critique}
          </span>
        {/if}
        {#if r.code}<pre class="code" data-testid="strategy-code">{r.code}</pre>{/if}
        {#if r.stdout}<pre class="code out" data-testid="strategy-stdout">{r.stdout}</pre>{/if}
        {#if r.stderr}<pre class="code err" data-testid="strategy-stderr">{r.stderr}</pre>{/if}
        {#if r.verify}<span class="detail" data-testid="strategy-verify" data-verdict={r.verify.verdict}><span class="verdict">{r.verify.verdict}</span> {r.verify.summary}</span>{/if}
      </span>
    </li>
  {/each}
</ol>

<style>
  .rows { margin: 0; padding: 0; list-style: none; }
  .row { display: flex; align-items: flex-start; gap: 6px; padding: 1px 4px; line-height: var(--cortex-lh-ui); }
  .ico { display: inline-flex; flex: none; padding-top: 1px; color: var(--cortex-text-3); }
  .row[data-status="done"] .ico { color: var(--cortex-ok); }
  .row[data-status="done"] .title { color: var(--cortex-text-2); }
  .row[data-status="running"] .ico { color: var(--cortex-accent); }
  .row[data-status="failed"] .ico, .row[data-status="failed"] .title { color: var(--cortex-bad); }
  .row.current .title { color: var(--cortex-text); }
  .main { display: grid; min-width: 0; gap: 2px; }
  .muted { color: var(--cortex-text-3); }
  .detail { color: var(--cortex-text-2); overflow-wrap: anywhere; }
  .code {
    margin: 0;
    padding: 4px 6px;
    max-height: 160px;
    overflow: auto;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    font-family: var(--cortex-font-mono);
    font-size: var(--cortex-t-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .out { color: var(--cortex-text); }
  .err { color: var(--cortex-bad); }
  .verdict { margin-right: 4px; font-weight: 600; color: var(--cortex-text); }
  .verdict[data-accepted="true"] { color: var(--cortex-ok); }
  .verdict[data-accepted="false"] { color: var(--cortex-warn); }
</style>
