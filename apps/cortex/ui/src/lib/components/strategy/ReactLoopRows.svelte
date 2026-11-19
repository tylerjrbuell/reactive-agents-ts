<script lang="ts">
  /**
   * The ReAct loop of a reactive turn, one block per iteration in the phase rows' language: the
   * thought (muted), then each action (tool and compact arguments) with the one-line observation it
   * returned. The current iteration is marked while the turn runs. Observations are summaries: the
   * tool-run group above holds the full arguments and output, so nothing is repeated here.
   */
  import type { ReactLoop } from "@reactive-agents/ui-core";
  import Icon from "../kit/Icon.svelte";

  interface Props {
    loop: ReactLoop;
  }
  const { loop }: Props = $props();

  const ICON = { running: "retry", done: "check-circle", failed: "alert-circle" } as const;
  const WORD = { running: "running", done: "done", failed: "failed" } as const;
  const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
</script>

<ol class="loop">
  {#each loop.rows as r (r.iteration)}
    <li class="iter" class:current={r.current} data-testid="loop-iteration" aria-current={r.current ? "step" : undefined}>
      <span class="num" aria-hidden="true">{r.n}</span>
      <span class="main">
        {#if r.thought}<span class="thought" data-testid="loop-thought">{r.thought}</span>{/if}
        {#each r.actions as a (a.id)}
          <span class="action" data-status={a.status} data-testid="loop-action">
            <span class="ico" role="img" aria-label={WORD[a.status]}><Icon name={ICON[a.status]} size="sm" /></span>
            <span class="call"><span class="tool">{a.shortName}</span>{#if a.args}<span class="args">({a.args})</span>{/if}{#if a.durationMs !== undefined && a.status !== "running"}<span class="dur"> {fmtMs(a.durationMs)}</span>{/if}</span>
          </span>
          {#if a.observation}<span class="obs" data-status={a.status} data-testid="loop-observation">{a.observation}</span>{/if}
        {/each}
        {#if r.actions.length === 0 && !r.thought}<span class="thought">Thinking</span>{/if}
      </span>
    </li>
  {/each}
</ol>

<style>
  .loop { margin: 0; padding: 0; list-style: none; }
  .iter { display: flex; align-items: flex-start; gap: 6px; padding: 2px 4px; line-height: var(--cortex-lh-ui); }
  .iter.current { background: var(--cortex-accent-tint); border-radius: var(--cortex-r-chip); }
  .num { flex: none; min-width: 14px; color: var(--cortex-text-3); font-family: var(--cortex-font-mono); font-variant-numeric: tabular-nums; }
  .iter.current .num { color: var(--cortex-accent); }
  .main { display: grid; min-width: 0; gap: 1px; }
  .thought { color: var(--cortex-text-3); overflow-wrap: anywhere; }
  .action { display: flex; align-items: flex-start; gap: 5px; color: var(--cortex-text); }
  .ico { display: inline-flex; flex: none; padding-top: 1px; color: var(--cortex-text-3); }
  .action[data-status="done"] .ico { color: var(--cortex-ok); }
  .action[data-status="running"] .ico { color: var(--cortex-accent); }
  .action[data-status="failed"] .ico { color: var(--cortex-bad); }
  .call { min-width: 0; overflow-wrap: anywhere; }
  .tool { font-family: var(--cortex-font-mono); }
  .args, .dur { color: var(--cortex-text-3); font-family: var(--cortex-font-mono); }
  .obs { padding-left: 19px; color: var(--cortex-text-2); overflow-wrap: anywhere; }
  .obs[data-status="failed"] { color: var(--cortex-bad); }
</style>
