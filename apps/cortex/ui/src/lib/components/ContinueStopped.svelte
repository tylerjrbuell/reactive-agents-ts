<script lang="ts">
  /**
   * What a loop guard stopped and how to continue it: the reason in plain words, the tool it
   * repeated, the tools already done (they do not run again) and the rows left, then an
   * optional note for the agent, how many more steps to allow, and Continue. Shared by the
   * chat thread (`ChatContinueCard`) and Runs (`runs/LoopStoppedRuns`); the host owns the
   * request. Rules and wording: `lib/loop-stop-resume.ts`.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import {
    continueBody,
    DEFAULT_EXTRA_ITERATIONS,
    loopStopFacts,
    loopStopHeadline,
    MAX_EXTRA_ITERATIONS,
    type ContinueBody,
    type LoopStopWire,
  } from "$lib/loop-stop-resume.js";

  interface Props {
    stop: LoopStopWire;
    /** A Continue is running: the form is replaced by its status and taps are ignored. */
    busy?: boolean;
    /** Why the last Continue was refused (the server's plain wording). */
    error?: string | undefined;
    onContinue: (body: ContinueBody) => void;
  }
  const { stop, busy = false, error, onContinue }: Props = $props();

  let note = $state("");
  let extra = $state(String(DEFAULT_EXTRA_ITERATIONS));
  let inputError = $state<string | undefined>(undefined);
  const facts = $derived(loopStopFacts(stop));

  function submit(): void {
    if (busy) return;
    const built = continueBody(note, extra);
    if (!built.ok) {
      inputError = built.error;
      return;
    }
    inputError = undefined;
    onContinue(built.body);
  }
</script>

<div class="stop" data-testid="continue-stopped">
  <p class="h"><Status tone="attention" label="Stopped by a loop guard" /></p>
  <p class="why">{loopStopHeadline(stop)}</p>
  {#if facts.length > 0}
    <dl class="facts">
      {#each facts as f (f.label)}
        <dt>{f.label}</dt>
        <dd class:mono={f.mono}>{f.items.join(", ")}</dd>
      {/each}
    </dl>
  {/if}
  {#if busy}
    <p class="busy" aria-live="polite"><Status tone="running" label="Continuing the run…" /></p>
  {:else}
    <form class="acts" onsubmit={(e) => { e.preventDefault(); submit(); }}>
      <input type="text" bind:value={note} placeholder="Tell the agent what to do differently (optional)" aria-label="Note for the agent" class="cx-control note" />
      <label class="steps">
        <span>More steps</span>
        <input type="text" inputmode="numeric" bind:value={extra} aria-label="More steps to allow" class="cx-control cx-mono num" size="3" />
      </label>
      <Button type="submit" size="sm" variant="primary" icon="play">Continue</Button>
    </form>
    <p class="hint">Continues the same run; work already done is not repeated. Up to {MAX_EXTRA_ITERATIONS} more steps.</p>
    {#if inputError ?? error}<p class="err" role="alert">{inputError ?? error}</p>{/if}
  {/if}
</div>

<style>
  .stop { display: grid; gap: 8px; max-width: var(--cortex-measure); font-size: var(--cortex-t-sm); }
  .h, .why, .busy, .hint, .err { margin: 0; }
  .why { color: var(--cortex-text); }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-size: var(--cortex-t-xs); }
  dt { color: var(--cortex-text-3); }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--cortex-text); }
  dd.mono { font-family: var(--cortex-font-data); }
  .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .note { flex: 1; min-width: 14rem; height: 28px; }
  .steps { display: inline-flex; align-items: center; gap: 6px; color: var(--cortex-text-3); font-size: var(--cortex-t-xs); }
  .num { width: 4.5rem; height: 28px; text-align: right; }
  .hint { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .err { color: var(--cortex-bad); overflow-wrap: anywhere; }
</style>
