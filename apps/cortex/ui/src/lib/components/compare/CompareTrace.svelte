<script lang="ts">
  /**
   * Run compare, trace: the framework replay diff (`diffTraces`) as loops side
   * by side. Loops where both runs made the same tool calls collapse into one
   * row; a loop that differs lists each run's calls, and the step where the
   * tool sequences first part is marked. Loop numbers link to each run's view.
   */
  import Icon from "$lib/components/kit/Icon.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import {
    loopRows,
    loopSpanLabel,
    stepCallLabel,
    type CompareStep,
    type CompareTrace,
  } from "$lib/run-compare.js";

  interface Props {
    trace: Extract<CompareTrace, { available: true }>;
    runA: string;
    runB: string;
  }
  const { trace, runA, runB }: Props = $props();

  const rows = $derived(loopRows(trace));
  const first = $derived(trace.firstDivergence);
  const stepAt = (i: number): CompareStep | undefined => trace.steps[i];
</script>

{#if first}
  <p class="lead" role="status">
    <Icon name="alert" size="sm" />
    <span>
      The runs part at step {first.step + 1}{first.loopA !== null ? `, loop ${first.loopA}` : ""}:
      {#if stepAt(first.step)?.a}<code>{stepAt(first.step)?.a?.toolName}</code>{:else}nothing{/if}
      on A,
      {#if stepAt(first.step)?.b}<code>{stepAt(first.step)?.b?.toolName}</code>{:else}nothing{/if}
      on B.
    </span>
  </p>
{:else}
  <p class="lead same" role="status"><Icon name="check" size="sm" /><span>Both runs made the same tool calls in the same order.</span></p>
{/if}

{#if rows.length === 0}
  <p class="note">Neither run called a tool.</p>
{:else}
  <ol class="loops">
    {#each rows as r (r.kind === "match" ? `m${r.from}` : `l${r.loop.loop}`)}
      {#if r.kind === "match"}
        <li class="match">
          <span class="n">{loopSpanLabel(r.from, r.to)}</span>
          <span class="m">Same on both{r.calls > 0 ? `: ${r.calls} tool call${r.calls === 1 ? "" : "s"}` : ", no tool calls"}</span>
        </li>
      {:else}
        <li class="loop" class:first={r.first} aria-current={r.first ? "step" : undefined}>
          <div class="n">
            Loop {r.loop.loop}
            {#if r.first}<span class="flag">first difference</span>{/if}
          </div>
          {#each [{ side: "a" as const, ids: r.loop.a, run: runA }, { side: "b" as const, ids: r.loop.b, run: runB }] as col (col.side)}
            <div class="col">
              <span class="tag">{col.side.toUpperCase()}</span>
              {#if col.ids.length === 0}
                <span class="none">no tool calls</span>
              {:else}
                <ul>
                  {#each col.ids as i (i)}
                    {@const s = stepAt(i)}
                    {@const c = s?.[col.side]}
                    {#if s && c}
                      <li class="call" class:diverged={!s.same} class:at={first?.step === i} class:failed={!c.ok}>
                        <span class="step">{i + 1}</span>
                        <span class="label" use:tooltip={stepCallLabel(c)}>{stepCallLabel(c)}</span>
                        {#if !c.ok}<span class="bad">failed</span>{/if}
                      </li>
                    {/if}
                  {/each}
                </ul>
              {/if}
              <a class="open" href="/run/{encodeURIComponent(col.run)}">Open run {col.side.toUpperCase()}</a>
            </div>
          {/each}
        </li>
      {/if}
    {/each}
  </ol>
{/if}

<style>
  .lead { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 10px; padding: 8px 12px; border-radius: var(--cortex-r-ctl); background: var(--cortex-accent-tint); color: var(--cortex-text); font-size: var(--cortex-t-sm); }
  .lead :global(svg) { flex: none; margin-top: 2px; color: var(--cortex-accent); }
  .lead.same { background: var(--cortex-ok-tint); }
  .lead.same :global(svg) { color: var(--cortex-ok); }
  .lead code, .label { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .note { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  ol, ul { margin: 0; padding: 0; list-style: none; }
  .loops { display: grid; gap: 4px; }
  .match { display: flex; gap: 12px; align-items: baseline; padding: 6px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .n { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-2); white-space: nowrap; }
  .loop { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr) minmax(0, 1fr); gap: 12px; padding: 10px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); }
  .loop.first { border-color: var(--cortex-accent); }
  .flag { display: block; margin-top: 4px; font-family: var(--cortex-font-ui); color: var(--cortex-accent); }
  .col { display: grid; align-content: start; gap: 6px; min-width: 0; }
  .tag { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--cortex-surface-2); font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text); }
  .none { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .col ul { display: grid; gap: 2px; }
  .call { display: grid; grid-template-columns: 1.75rem minmax(0, 1fr) auto; align-items: baseline; gap: 6px; padding: 3px 6px; border-radius: 6px; color: var(--cortex-text-2); }
  .call.diverged { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .call.at { box-shadow: inset 2px 0 0 var(--cortex-accent); }
  .step { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bad { font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
  .open { justify-self: start; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); text-underline-offset: 2px; }
  .open:hover { color: var(--cortex-text); }
  .open:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 4px; }
  @media (max-width: 900px) { .loop { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .loop > .n { grid-column: 1 / -1; } }
  @media (max-width: 560px) { .loop { grid-template-columns: minmax(0, 1fr); } }
</style>
