<script lang="ts">
  /**
   * The run debrief, inside the inspector's Summary (Bench spec section 8):
   * outcome, summary, findings, lessons, decision rationale, errors, tools and
   * metrics, or its markdown source. Without a debrief it says how to get one.
   */
  import { formatCost, formatTurnDuration } from "@reactive-agents/ui-core";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import { loopsLabel } from "$lib/run-view.js";
  import { debriefEmptyState } from "$lib/debrief-memory.js";

  interface Props {
    debrief: unknown;
    status?: string;
    /** For the empty state: the run id and its launch snapshot (whether memory was on, Edit and rerun link). */
    runId?: string;
    launchParams?: Record<string, unknown> | null;
  }
  let { debrief, status = "", runId = "", launchParams = null }: Props = $props();
  const empty = $derived(debriefEmptyState(status, runId, launchParams));

  type DebriefView = {
    outcome?: string;
    summary?: string;
    keyFindings?: string[];
    lessonsLearned?: string[];
    errors?: string[];
    markdown?: string;
    metrics?: { iterations?: number; tokens?: number; duration?: number; cost?: number };
    toolsUsed?: ReadonlyArray<{ name?: string; calls?: number; errors?: number; avgDurationMs?: number }>;
    rationale?: ReadonlyArray<{
      readonly iteration: number;
      readonly decision: string;
      readonly toolName?: string;
      readonly rationale: { readonly why: string; readonly refs?: readonly string[]; readonly confidence?: number };
    }>;
  };

  const d = $derived((debrief && typeof debrief === "object" ? debrief : null) as DebriefView | null);
  const isFailed = $derived(status === "failed" || d?.outcome === "failure" || d?.outcome === "failed");

  let copied = $state(false);
  let raw = $state(false);

  async function copyMarkdown() {
    const md = d?.markdown;
    if (typeof md !== "string" || !md) return;
    await navigator.clipboard.writeText(md);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<section class="sec" aria-label="Debrief">
  <div class="head">
    <h3>Debrief</h3>
    {#if d}
      <Badge tone={isFailed ? "bad" : "ok"}>{isFailed ? "failed" : "succeeded"}</Badge>
      <div class="acts">
        {#if typeof d.markdown === "string" && d.markdown}
          <Button size="sm" variant="ghost" aria-pressed={raw} onclick={() => (raw = !raw)}>{raw ? "View" : "Markdown"}</Button>
          <Button size="sm" variant="ghost" icon={copied ? "check" : "copy"} onclick={copyMarkdown}>{copied ? "Copied" : "Copy"}</Button>
        {/if}
      </div>
    {/if}
  </div>

  {#if !d}
    <p class="hint">
      {empty.text}
      {#if empty.href}<a class="hint-link" href={empty.href}>Open this run's config in the Lab</a>{/if}
    </p>
  {:else if raw}
    <pre class="md">{d.markdown ?? ""}</pre>
  {:else}
    {#if d.summary}<p class="summary">{d.summary}</p>{/if}

    {#if (d.keyFindings?.length ?? 0) > 0}
      <h4>Key findings</h4>
      <ul>{#each d.keyFindings ?? [] as f, i (i)}<li>{f}</li>{/each}</ul>
    {/if}
    {#if (d.lessonsLearned?.length ?? 0) > 0}
      <h4>Lessons learned</h4>
      <ul>{#each d.lessonsLearned ?? [] as l, i (i)}<li>{l}</li>{/each}</ul>
    {/if}

    {#if (d.rationale?.length ?? 0) > 0}
      <h4>Decision rationale</h4>
      <ul class="rat">
        {#each d.rationale ?? [] as r, i (i)}
          <li>
            <span class="meta">Loop {r.iteration} · {r.decision}{#if r.toolName} · <span class="io">{r.toolName}</span>{/if}{#if r.rationale.confidence != null} · {Math.round(r.rationale.confidence * 100)}%{/if}</span>
            <span>{r.rationale.why}</span>
            {#if r.rationale.refs?.length}<span class="meta">refs: {r.rationale.refs.join(", ")}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if (d.errors?.length ?? 0) > 0}
      <h4>Errors</h4>
      <ul class="errs">{#each d.errors ?? [] as e, i (i)}<li>{e}</li>{/each}</ul>
    {/if}

    {#if (d.toolsUsed?.length ?? 0) > 0}
      <h4>Tools used</h4>
      <div class="chips">
        {#each d.toolsUsed ?? [] as t, i (i)}
          <Badge tone={t.errors ? "bad" : "io"} data>{t.name ?? "?"} ×{t.calls ?? 1}{#if t.errors} · {t.errors} failed{/if}</Badge>
        {/each}
      </div>
    {/if}

    {#if d.metrics}
      <p class="metrics">
        {#if d.metrics.iterations}<span>{loopsLabel(d.metrics.iterations)}</span>{/if}
        {#if d.metrics.tokens}<span>{d.metrics.tokens.toLocaleString()} tokens</span>{/if}
        {#if d.metrics.cost}<span>{formatCost(d.metrics.cost)}</span>{/if}
        {#if d.metrics.duration}<span>{formatTurnDuration(d.metrics.duration)}</span>{/if}
      </p>
    {/if}
  {/if}
</section>

<style>
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  h3 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .acts { margin-left: auto; display: flex; gap: 4px; }
  h4 { margin: 12px 0 4px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .hint-link { margin-left: 4px; color: var(--cortex-accent); text-decoration: underline; text-underline-offset: 2px; }
  .hint-link:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 2px; }
  .summary { margin: 0; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-read); color: var(--cortex-text); }
  ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: var(--cortex-t-sm); color: var(--cortex-text); line-height: var(--cortex-lh-ui); }
  .rat { list-style: none; padding: 0; }
  .rat li { display: grid; gap: 2px; padding-left: 10px; border-left: 2px solid var(--cortex-line-strong); }
  .meta { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .io { color: var(--cortex-io); font-family: var(--cortex-font-data); }
  .errs li { color: var(--cortex-bad); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .metrics { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 0; padding-top: 8px; border-top: 1px solid var(--cortex-line); font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .md { margin: 0; max-height: 24rem; overflow: auto; padding: 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
