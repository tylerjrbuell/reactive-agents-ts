<script lang="ts">
  /**
   * "Why it ended": the framework's diagnosis of a finished run (the same
   * engine as `rax-diagnose cause`), fetched once the run settles. Shows the
   * cause in plain words, who the trace says is at fault, and the decisive
   * steps; a step in a recorded loop selects and opens that trace row. Open by
   * default when the run did not succeed. Rules and client: `lib/run-cause.ts`.
   */
  import Badge from "$lib/components/kit/Badge.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import {
    attributionView,
    causeSteps,
    confidenceLabel,
    fetchRunCause,
    reasonWords,
    unavailableNote,
    type RunCauseReport,
  } from "$lib/run-cause.js";

  interface Props {
    runId: string;
    /** The run has finished: fetch the diagnosis (a live run is not diagnosed). */
    settled: boolean;
    /** Initial open state (the run did not succeed). */
    defaultOpen: boolean;
    /** 1-based loops that have a trace row, so only those steps link. */
    loops: ReadonlySet<number>;
    onSelectLoop: (loop: number) => void;
  }
  const { runId, settled, defaultOpen, loops, onSelectLoop }: Props = $props();

  const uid = $props.id();
  let report = $state<RunCauseReport | null>(null);
  let error = $state("");
  let requested = false;
  $effect(() => {
    if (!settled || requested) return;
    requested = true;
    const load = (retry: boolean): void => {
      fetchRunCause(runId)
        .then((r) => {
          report = r;
          // A run that just ended may not have flushed its last trace line yet: read once more.
          if (retry && r.available && r.cause === "incomplete-trace") setTimeout(() => load(false), 1500);
        })
        .catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)));
    };
    load(true);
  });

  // svelte-ignore state_referenced_locally — the initial state only; the user owns it after
  let open = $state(defaultOpen);
  let touched = false;
  $effect(() => {
    // The run's ending can arrive after mount (live → failed): follow it until the user toggles.
    if (!touched) open = defaultOpen;
  });
  function toggle() {
    touched = true;
    open = !open;
  }

  const steps = $derived(report ? causeSteps(report, loops) : []);
  const who = $derived(report?.available ? attributionView(report.attribution.verdict) : null);
  const failedRun = $derived(report?.available === true && report.attribution.verdict !== "not-failed");
</script>

{#if settled}
  <section class="cause" data-testid="run-cause-card" aria-labelledby="{uid}-h">
    <button type="button" class="head" aria-expanded={open} aria-controls="{uid}-b" onclick={toggle}>
      <Icon name="chevron" size="sm" class={open ? "chev open" : "chev"} />
      <h2 id="{uid}-h">Why it ended</h2>
      <span class="sum">
        {#if report?.available}{report.headline}{:else if report}No diagnosis{:else if error}Diagnosis failed{:else}Diagnosing…{/if}
      </span>
      {#if who && failedRun}<Badge tone={who.tone}>{who.label}</Badge>{/if}
    </button>

    {#if open}
      <div class="body" id="{uid}-b">
        {#if error}
          <p class="note">Could not diagnose this run: {error}</p>
        {:else if report === null}
          <p class="note">Reading the trace…</p>
        {:else if !report.available}
          <p class="note">{unavailableNote(report.reason)}</p>
        {:else}
          <dl class="facts">
            <dt>Cause</dt>
            <dd><code>{report.cause}{report.subCause ? `/${report.subCause}` : ""}</code><span class="dim">{confidenceLabel(report.confidence)}</span></dd>
            {#if failedRun && who}
              <dt>At fault</dt>
              <dd>
                <span>{who.label}: {reasonWords(report.attribution.reason)}</span>
                <span class="dim">{confidenceLabel(report.attribution.confidence)}</span>
                {#if report.attribution.divergenceLoop !== undefined && loops.has(report.attribution.divergenceLoop)}
                  {@const n = report.attribution.divergenceLoop}
                  <button type="button" class="link" onclick={() => onSelectLoop(n)}>Went wrong in loop {n}</button>
                {/if}
              </dd>
              {#if report.attribution.target?.kind === "file"}
                <dt>File</dt>
                <dd><code>{report.attribution.target.ref}</code></dd>
              {/if}
              {#if report.attribution.alsoMatched.length > 0}
                <dt>Also</dt>
                <dd>{report.attribution.alsoMatched.map(reasonWords).join(", ")}</dd>
              {/if}
            {/if}
          </dl>

          {#if steps.length > 0}
            <h3>Decisive steps</h3>
            <ul class="steps">
              {#each steps as s (s.key)}
                <li>
                  {#if s.linked && s.loop !== null}
                    {@const n = s.loop}
                    <button type="button" class="step linked" onclick={() => onSelectLoop(n)}>
                      <span class="where">Loop {n}</span><span class="detail">{s.detail}</span><code class="ev">{s.key}</code>
                    </button>
                  {:else}
                    <div class="step">
                      <span class="where">{s.loop === null ? "Run" : `Loop ${s.loop}`}</span><span class="detail">{s.detail}</span><code class="ev">{s.key}</code>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}

          {#if report.missing.length > 0 || report.attribution.missing.length > 0}
            <h3>What would make this certain</h3>
            <ul class="missing">
              {#each [...new Set([...report.missing, ...report.attribution.missing])] as m (m)}<li>{m}</li>{/each}
            </ul>
          {/if}

          <p class="foot">Same diagnosis as <code>rax-diagnose cause {runId}</code></p>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .cause { border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); color: var(--cortex-text); }
  .head { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 10px 16px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; border-radius: var(--cortex-r-panel); }
  .head:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .head :global(.chev) { flex: none; color: var(--cortex-text-3); transition: transform 120ms ease; }
  .head :global(.chev.open) { transform: rotate(90deg); }
  h2 { margin: 0; flex: none; font-size: var(--cortex-t-sm); font-weight: 600; }
  .sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .body { display: grid; gap: 10px; padding: 0 16px 14px 40px; font-size: var(--cortex-t-sm); }
  .note { margin: 0; color: var(--cortex-text-2); }
  .facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; margin: 0; }
  dt { color: var(--cortex-text-3); }
  dd { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin: 0; min-width: 0; overflow-wrap: anywhere; }
  code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .dim { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  h3 { margin: 4px 0 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  ul { margin: 0; padding: 0; list-style: none; }
  .steps { display: grid; gap: 2px; }
  .step { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr) auto; align-items: baseline; gap: 10px; width: 100%; padding: 5px 8px; border: 0; border-radius: var(--cortex-r-ctl); background: transparent; color: inherit; font: inherit; text-align: left; }
  .step.linked { cursor: pointer; }
  .step.linked:hover { background: var(--cortex-surface-2); }
  .step.linked:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .step.linked .where { color: var(--cortex-accent); }
  .where { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); white-space: nowrap; }
  .detail { min-width: 0; overflow-wrap: anywhere; color: var(--cortex-text-2); }
  .ev { color: var(--cortex-text-3); white-space: nowrap; }
  .missing { padding-left: 18px; list-style: disc; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .link { padding: 0; border: 0; background: none; color: var(--cortex-accent); font: inherit; font-size: var(--cortex-t-xs); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .link:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .foot { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  @container trace (max-width: 30rem) { .ev { display: none; } }
  @media (max-width: 640px) { .ev { display: none; } .body { padding-left: 16px; } }
  @media (prefers-reduced-motion: reduce) { .head :global(.chev) { transition: none; } }
  :global(html[data-motion="reduce"]) .head :global(.chev) { transition: none; }
</style>
