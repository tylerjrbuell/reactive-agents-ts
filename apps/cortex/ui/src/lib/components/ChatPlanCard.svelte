<script lang="ts">
  import type { ChecklistSnapshotWire } from "@reactive-agents/ui-core";
  import { planCardModel } from "$lib/checklist-view.js";
  import type { ChatTurn } from "$lib/stores/chat-store.js";

  interface Props {
    checklist: ChecklistSnapshotWire;
    /** True once the turn finished: an explicit goal still open then reads unmet. */
    turnComplete?: boolean;
    /** Latest non-accept decision of the shared exit gate (the same for every strategy). */
    exitGate?: ChatTurn["exitGate"];
  }
  const { checklist, turnComplete = false, exitGate }: Props = $props();

  // One line per gate decision, in the reader's terms; the outstanding items follow it.
  const gateLine = $derived.by(() => {
    if (exitGate === undefined) return undefined;
    const n = exitGate.outstanding.length;
    const items = `${n} item${n === 1 ? "" : "s"}`;
    if (exitGate.decision === "repair") return `Not done yet: one more try for ${items}`;
    if (exitGate.decision === "handoff") return `Stopped with ${items} unfinished`;
    return `Finished with ${items} unfinished`;
  });

  // Implicit checks (the answer floor every run has) are hidden unless they fail (checklist-view.ts
  // planCardModel); sub-agent goals ride on each sub-agent card, not here.
  const model = $derived(planCardModel(checklist, { ended: turnComplete, gateStopped: exitGate !== undefined && exitGate.decision !== "repair" }));

  // null = follow the default; a click pins the viewer's choice.
  let pinned = $state<boolean | null>(null);
  const open = $derived(pinned ?? model.openByDefault);

  const ICON = { pending: "radio_button_unchecked", in_progress: "autorenew", done: "check_circle", blocked: "block" } as const;
  const PILL_ICON = { met: "check_circle", unmet: "error", pending: "radio_button_unchecked", none: "flag" } as const;
</script>

{#if model.show}
  <section class="plan" aria-label="Goal checks" data-testid="plan-card">
    <button type="button" class="pill" data-status={model.goals.status} aria-expanded={open} aria-controls="plan-body" onclick={() => (pinned = !open)}>
      <span class="material-symbols-outlined ico" aria-hidden="true">{model.goals.show ? PILL_ICON[model.goals.status] : "checklist"}</span>
      <span class="head-label">{model.label}</span>
      {#if model.goals.show && model.planLabel}<span class="muted">· {model.planLabel}</span>{/if}
      <span class="material-symbols-outlined chev" class:open aria-hidden="true">expand_more</span>
    </button>

    {#if open}
      <div id="plan-body" class="body">
        <!-- The strategy's plan, tracked by the harness from its own state. -->
        {#if model.plan.length > 0}
          <h4 class="sec">{model.planLabel}</h4>
          <ol class="rows">
            {#each model.plan as r (r.id)}
              <li class="row" class:current={r.status === "in_progress"} data-status={r.status} data-testid="plan-row">
                <span class="material-symbols-outlined ico" aria-label={r.status.replace("_", " ")}>{ICON[r.status]}</span>
                <span class="title">{r.title}</span>
              </li>
            {/each}
          </ol>
        {/if}
        {#if model.goals.rows.length > 0}
          {#if model.plan.length > 0}<h4 class="sec">Goals</h4>{/if}
          <ul class="rows">
            {#each model.goals.rows as r (r.id)}
              <li class="row" data-status={r.status}>
                <span class="material-symbols-outlined ico" aria-label={r.status.replace("_", " ")}>{ICON[r.status]}</span>
                <span class="title">{r.title}{#if r.status === "blocked" && r.reason}<span class="reason"> — {r.reason}</span>{/if}</span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if gateLine && exitGate}
          <div class="gate" data-decision={exitGate.decision} role="status" data-testid="exit-gate">
            <span class="material-symbols-outlined ico" aria-hidden="true">{exitGate.decision === "repair" ? "replay" : "flag"}</span>
            <span>{gateLine}</span>
          </div>
          {#if exitGate.outstanding.length > 0}
            <ul class="rows gate-items">
              {#each exitGate.outstanding as item (item)}<li class="row"><span class="title">{item}</span></li>{/each}
            </ul>
          {/if}
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .plan { margin: 0 0 0.25rem; font-family: ui-monospace, monospace; font-size: 11px; color: var(--cortex-text); }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.0625rem 0.4375rem 0.0625rem 0.3125rem;
    border: 1px solid var(--cortex-border);
    border-radius: 9999px;
    background: none;
    cursor: pointer;
    font: inherit;
    font-size: 10px;
    color: var(--cortex-text-muted);
  }
  .pill:hover { color: var(--cortex-text); background: var(--cortex-surface-mid); }
  .pill:focus-visible { outline: 2px solid var(--color-secondary, #7ee3c3); outline-offset: 2px; }
  .pill .ico { font-size: 12px; line-height: 1; }
  .pill[data-status="met"] .ico { color: var(--color-secondary, #7ee3c3); }
  .pill[data-status="unmet"] { border-color: color-mix(in srgb, var(--color-error, #ff6b6b) 50%, transparent); color: var(--color-error, #ff6b6b); }
  .head-label { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: var(--cortex-text-muted); font-variant-numeric: tabular-nums; }
  .chev { font-size: 13px; line-height: 1; transition: transform 150ms; }
  .chev.open { transform: rotate(180deg); }

  .body { margin-top: 0.25rem; padding: 0.25rem 0 0.125rem 0.5rem; border-left: 1px solid var(--cortex-border); }
  .sec { margin: 0.25rem 0 0.125rem; font-size: 10px; font-weight: 600; color: var(--cortex-text-muted); }
  .rows { margin: 0; padding: 0; list-style: none; }
  .row { display: flex; align-items: flex-start; gap: 0.375rem; padding: 0.0625rem 0.25rem; border-radius: 4px; line-height: 1.45; }
  .row .ico { font-size: 14px; line-height: 1.3; flex: none; color: var(--cortex-text-muted); }
  .row[data-status="done"] .ico { color: var(--color-secondary, #7ee3c3); }
  .row[data-status="done"] .title { color: var(--cortex-text-muted); }
  .row[data-status="pending"] .title { color: var(--cortex-text-muted); }
  .row.current .title { color: var(--cortex-text); }
  .row[data-status="blocked"] .ico { color: var(--color-error, #ff6b6b); }
  .row[data-status="in_progress"] .ico { color: var(--color-secondary, #7ee3c3); }
  .reason { color: var(--color-error, #ff6b6b); font-weight: 400; }
  .gate { display: flex; align-items: center; gap: 0.375rem; margin-top: 0.375rem; padding: 0.125rem 0.25rem; font-weight: 600; }
  .gate .ico { font-size: 14px; line-height: 1; }
  .gate[data-decision="repair"] { color: var(--color-secondary, #7ee3c3); }
  .gate[data-decision="handoff"], .gate[data-decision="accept-unfinished"] { color: var(--color-error, #ff6b6b); }
  .gate-items { padding-left: 1.5rem; color: var(--cortex-text-muted); }

  @media (prefers-reduced-motion: no-preference) {
    .row[data-status="in_progress"] .ico { animation: plan-spin 2s linear infinite; }
  }
  @keyframes plan-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .chev { transition: none; }
  }
</style>
