<script lang="ts">
  /**
   * Why a run did not finish and how to continue it: a chip from the stop's kind (paused or
   * stopped by you, loop guard, budget, timeout, error, interrupted), the reason in plain
   * words, the tools already done (they do not run again) and the rows left, then an optional
   * note for the agent, how many more steps to allow, and Continue. Shared by the chat thread
   * (`ChatContinueCard`) and Runs (`runs/LoopStoppedRuns`); the host owns the request. Wording:
   * `lib/run-stop.ts`; input rules: `lib/loop-stop-resume.ts`.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { continueBody, DEFAULT_EXTRA_ITERATIONS, MAX_EXTRA_ITERATIONS, type ContinueBody } from "$lib/loop-stop-resume.js";
  import { stopFacts, stopHeadline, stopKindChip, type RunStopKind, type StopWire } from "$lib/run-stop.js";

  interface Props {
    /** Why the run is not finished (the stop's `kind`; `crash` when the framework wrote no stop). */
    kind: RunStopKind;
    /** What it had done and what was open; absent for a crash. */
    stop?: StopWire | undefined;
    /** A Continue is running: the form is replaced by its status and taps are ignored. */
    busy?: boolean;
    /** Why the last Continue was refused (the server's plain wording). */
    error?: string | undefined;
    onContinue: (body: ContinueBody) => void;
  }
  const { kind, stop, busy = false, error, onContinue }: Props = $props();

  let note = $state("");
  let extra = $state(String(DEFAULT_EXTRA_ITERATIONS));
  let inputError = $state<string | undefined>(undefined);
  const facts = $derived(stopFacts(stop));
  const chip = $derived(stopKindChip(kind));

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
  <p class="h"><Status tone={chip.tone} label={chip.label} /></p>
  <p class="why">{stopHeadline(kind, stop)}</p>
  {#if facts.length > 0}
    <dl class="facts">
      {#each facts as f (f.label)}
        <dt>{f.label}</dt>
        {#if f.list}
          <dd><ul class="left">{#each f.items as item (item)}<li>{item}</li>{/each}</ul></dd>
        {:else}
          <dd class:mono={f.mono}>{f.items.join(", ")}</dd>
        {/if}
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
  .left { margin: 0; padding-left: 16px; display: grid; gap: 2px; }
  .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .note { flex: 1; min-width: 14rem; height: 28px; }
  .steps { display: inline-flex; align-items: center; gap: 6px; color: var(--cortex-text-3); font-size: var(--cortex-t-xs); }
  .num { width: 4.5rem; height: 28px; text-align: right; }
  .hint { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .err { color: var(--cortex-bad); overflow-wrap: anywhere; }
</style>
