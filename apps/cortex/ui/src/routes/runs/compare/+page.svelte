<script lang="ts">
  /**
   * Run compare (`/runs/compare?a=&b=`): what changed between two runs.
   * Summary and config differences for every run; the step-aligned trace diff
   * and answer diff (framework replay `diffTraces`) when both runs recorded a
   * trace. Data: `GET /api/runs/compare`; rules: `lib/run-compare.ts`.
   */
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import PageHeader from "$lib/components/kit/PageHeader.svelte";
  import Panel from "$lib/components/kit/Panel.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import CompareSummary from "$lib/components/compare/CompareSummary.svelte";
  import CompareConfig from "$lib/components/compare/CompareConfig.svelte";
  import CompareTrace from "$lib/components/compare/CompareTrace.svelte";
  import CompareOutput from "$lib/components/compare/CompareOutput.svelte";
  import { loadCapabilities, strategyOptions } from "$lib/capabilities.js";
  import { runNameOf } from "$lib/runs-table.js";
  import { compareHref, fetchRunCompare, noTraceNote, type RunCompareReport } from "$lib/run-compare.js";

  const a = $derived($page.url.searchParams.get("a") ?? "");
  const b = $derived($page.url.searchParams.get("b") ?? "");

  let report = $state<RunCompareReport | null>(null);
  let error = $state("");
  let loading = $state(false);

  $effect(() => {
    const x = a;
    const y = b;
    report = null;
    error = "";
    if (!x || !y) return;
    loading = true;
    let cancelled = false;
    fetchRunCompare(x, y)
      .then((r) => {
        if (!cancelled) report = r;
      })
      .catch((e: unknown) => {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  let strategyLabels = $state<ReadonlyMap<string, string>>(new Map());
  $effect(() => {
    loadCapabilities()
      .then((m) => (strategyLabels = new Map(strategyOptions(m).map((o) => [o.value, o.label]))))
      .catch(() => {
        /* ids stay as reported */
      });
  });
  const strategyLabel = (id: string): string => strategyLabels.get(id) ?? id;

  const nameA = $derived(report ? runNameOf(report.a.run) : a.slice(0, 12));
  const nameB = $derived(report ? runNameOf(report.b.run) : b.slice(0, 12));
</script>

<svelte:head>
  <title>Compare runs · Cortex</title>
</svelte:head>

<CortexDeskShell ambient={!a || !b} class="bg-canvas">
  <div class="page">
    <div class="wrap">
      <PageHeader title="Compare runs" description="What changed between two runs: outcome, cost, config and, when both recorded a trace, each step.">
        {#snippet lead()}
          <nav class="crumb" aria-label="Breadcrumb"><a href="/runs">Runs</a><Icon name="chevron" size="sm" /><span>Compare</span></nav>
        {/snippet}
        {#snippet actions()}
          {#if a && b}
            <Button icon="retry" onclick={() => void goto(compareHref(b, a))}>Swap A and B</Button>
          {/if}
        {/snippet}
      </PageHeader>
    </div>

    <div class="wrap body">
      {#if !a || !b}
        <EmptyState hero title="Pick two runs to compare" description="Select two runs in Runs and press Compare, or open a run and choose Compare with… in its More menu.">
          {#snippet actions()}
            <Button variant="primary" icon="runs" href="/runs">Go to Runs</Button>
          {/snippet}
        </EmptyState>
      {:else if error}
        <div class="note err" role="alert">
          <span>Could not compare these runs: {error}</span>
          <Button size="sm" href="/runs">Back to Runs</Button>
        </div>
      {:else if loading || !report}
        <p class="note" role="status">Comparing…</p>
      {:else}
        <div class="pair">
          <a class="who" href="/run/{encodeURIComponent(a)}"><span class="tag">A</span><span class="name">{nameA}</span><code>{a.slice(0, 12)}</code></a>
          <a class="who" href="/run/{encodeURIComponent(b)}"><span class="tag">B</span><span class="name">{nameB}</span><code>{b.slice(0, 12)}</code></a>
        </div>

        <Panel title="Summary">
          <CompareSummary a={report.a} b={report.b} {strategyLabel} />
        </Panel>

        <Panel title="Config">
          <CompareConfig config={report.config} />
        </Panel>

        {#if report.trace.available}
          <Panel title="Steps">
            <CompareTrace trace={report.trace} runA={a} runB={b} />
          </Panel>
          <Panel title="Answer">
            <CompareOutput a={report.trace.diff.outputDiff.original} b={report.trace.diff.outputDiff.replay} equal={report.trace.diff.outputDiff.equal} />
          </Panel>
        {:else}
          <Panel title="Steps">
            <p class="note left">{noTraceNote(report.trace.missing)}</p>
          </Panel>
        {/if}
      {/if}
    </div>
  </div>
</CortexDeskShell>

<style>
  .page { position: relative; z-index: 1; height: 100%; min-height: 0; overflow-y: auto; }
  .wrap { max-width: 1280px; margin: 0 auto; }
  .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 0 32px 48px; }
  .crumb { display: flex; align-items: center; gap: 6px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .crumb a { color: var(--cortex-text-2); text-decoration: none; }
  .crumb a:hover { color: var(--cortex-text); text-decoration: underline; text-underline-offset: 2px; }
  .crumb a:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 4px; }
  .pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  .who { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px 14px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); color: var(--cortex-text); text-decoration: none; }
  .who:hover { border-color: var(--cortex-line-strong); }
  .who:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .who code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .tag { flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: var(--cortex-surface-2); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .note { margin: 24px 0; text-align: center; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .note.left { margin: 0; text-align: left; }
  .err { display: flex; justify-content: center; align-items: center; gap: 12px; color: var(--cortex-bad); }
  @media (max-width: 900px) { .body { padding: 0 16px 32px; } }
  @media (max-width: 560px) { .pair { grid-template-columns: minmax(0, 1fr); } .who code { display: none; } }
</style>
