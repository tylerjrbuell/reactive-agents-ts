<script lang="ts">
  import type { ChecklistSnapshotWire } from "@reactive-agents/ui-core";
  import { checklistView, type ChecklistGroupView } from "$lib/checklist-view.js";

  interface Props {
    checklist: ChecklistSnapshotWire;
  }
  const { checklist }: Props = $props();

  const view = $derived(checklistView(checklist));

  // null = follow the default (collapsed once every requirement is done); a click pins the viewer's choice.
  let pinned = $state<boolean | null>(null);
  const open = $derived(pinned ?? !view.collapsedByDefault);
  // Child blocks: absent from the map ⇒ open while running, collapsed once finished.
  let childOpen = $state<Record<string, boolean>>({});
  const isChildOpen = (c: ChecklistGroupView) => childOpen[c.key] ?? c.live;

  const ICON = { pending: "radio_button_unchecked", in_progress: "autorenew", done: "check_circle", blocked: "block" } as const;
  const empty = $derived(
    view.sections.requirements.length === 0 && view.sections.advisory.length === 0 && view.children.length === 0,
  );
</script>

{#snippet rows(g: ChecklistGroupView)}
  <!-- The header already names a lone section ("Goal checks 0/1"); repeat the heading only when both show. -->
  {@const both = g.sections.requirements.length > 0 && g.sections.advisory.length > 0}
  {#if g.sections.requirements.length > 0}
    {#if both}<h4 class="sec">Goal checks</h4>{/if}
    <ul class="rows">
      {#each g.sections.requirements as r (r.id)}
        <li class="row" data-status={r.status}>
          <span class="material-symbols-outlined ico" aria-label={r.status.replace("_", " ")}>{ICON[r.status]}</span>
          <span class="title">{r.title}{#if r.status === "blocked" && r.reason}<span class="reason"> — {r.reason}</span>{/if}</span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if g.sections.advisory.length > 0}
    {#if both}<h4 class="sec">Agent's to-do</h4>{/if}
    <ul class="rows">
      {#each g.sections.advisory as r (r.id)}
        <li class="row" class:active={g.activeAdvisoryIds.includes(r.id)} data-status={r.status}>
          <span class="material-symbols-outlined ico" aria-label={r.status.replace("_", " ")}>{ICON[r.status]}</span>
          <span class="title">{r.title}{#if r.status === "blocked" && r.reason}<span class="reason"> — {r.reason}</span>{/if}</span>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#if !empty}
  <section class="plan" aria-label="Task checklist" data-testid="plan-card">
    <button type="button" class="head" aria-expanded={open} aria-controls="plan-body" onclick={() => (pinned = !open)}>
      <span class="material-symbols-outlined chev" class:open aria-hidden="true">chevron_right</span>
      <span class="head-label">{view.label || "Checklist"}</span>
      {#if view.label}
        <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={view.progressPct} aria-label="Progress">
          <span class="fill" style:width="{view.progressPct}%"></span>
        </span>
      {/if}
    </button>

    {#if open}
      <div id="plan-body" class="body">
        {@render rows(view)}

        {#if view.children.length > 0}
          <div class="kids">
            {#each view.children as c (c.key)}
              {@const kidOpen = isChildOpen(c)}
              <div class="kid" data-live={c.live}>
                <button
                  type="button"
                  class="kid-head"
                  aria-expanded={kidOpen}
                  onclick={() => (childOpen = { ...childOpen, [c.key]: !kidOpen })}
                >
                  <span class="material-symbols-outlined chev" class:open={kidOpen} aria-hidden="true">chevron_right</span>
                  <span class="dot" class:running={c.live} aria-label={c.live ? "running" : "finished"}></span>
                  <span class="kid-name">{c.name}</span>
                  {#if c.label}<span class="kid-prog">{c.label}</span>{/if}
                </button>
                {#if kidOpen}
                  <div class="kid-body">{@render rows(c)}</div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .plan {
    margin: 0 0 0.5rem;
    border: 1px solid var(--cortex-border);
    border-radius: 8px;
    padding: 0.25rem 0.625rem 0.375rem;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--cortex-text);
  }
  .head, .kid-head {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0;
    background: none;
    border: 0;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .head:focus-visible, .kid-head:focus-visible {
    outline: 2px solid var(--color-secondary, #7ee3c3);
    outline-offset: 2px;
    border-radius: 3px;
  }
  .head-label { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .chev { font-size: 14px; line-height: 1; color: var(--cortex-text-muted); transition: transform 150ms; }
  .chev.open { transform: rotate(90deg); }
  .bar {
    flex: 1;
    height: 3px;
    min-width: 2rem;
    border-radius: 2px;
    background: var(--cortex-border);
    overflow: hidden;
  }
  .fill { display: block; height: 100%; background: var(--color-secondary, #7ee3c3); transition: width 200ms ease-out; }

  .body { padding: 0 0 0.125rem 1.25rem; }
  .sec {
    margin: 0.375rem 0 0.125rem;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--cortex-text-muted);
  }
  .rows { margin: 0; padding: 0; list-style: none; }
  .row { display: flex; align-items: flex-start; gap: 0.375rem; padding: 0.0625rem 0.25rem; border-radius: 4px; line-height: 1.45; }
  .row .ico { font-size: 14px; line-height: 1.3; flex: none; color: var(--cortex-text-muted); }
  .row[data-status="done"] .ico { color: var(--color-secondary, #7ee3c3); }
  .row[data-status="done"] .title { color: var(--cortex-text-muted); }
  .row[data-status="blocked"] .ico { color: var(--color-error, #ff6b6b); }
  .row[data-status="in_progress"] .ico { color: var(--color-secondary, #7ee3c3); }
  .row.active { background: color-mix(in srgb, var(--color-secondary, #7ee3c3) 14%, transparent); }
  .row.active .title { font-weight: 600; }
  .reason { color: var(--color-error, #ff6b6b); font-weight: 400; }

  .kids {
    margin-top: 0.5rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.5rem;
    align-items: start;
  }
  .kid { border-left: 2px solid var(--cortex-border); padding-left: 0.5rem; min-width: 0; }
  .kid[data-live="true"] { border-left-color: var(--color-secondary, #7ee3c3); }
  .kid-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kid-prog { margin-left: auto; color: var(--cortex-text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .kid-body { padding-left: 0.25rem; }
  .dot { width: 6px; height: 6px; flex: none; border-radius: 9999px; background: var(--cortex-border); }
  .dot.running { background: var(--color-secondary, #7ee3c3); }

  @media (prefers-reduced-motion: no-preference) {
    .dot.running { animation: plan-pulse 1.4s ease-in-out infinite; }
    .row[data-status="in_progress"] .ico { animation: plan-spin 2s linear infinite; }
  }
  @keyframes plan-pulse { 50% { opacity: 0.35; } }
  @keyframes plan-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .chev, .fill { transition: none; }
  }
</style>
