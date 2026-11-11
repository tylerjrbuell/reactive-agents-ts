<script lang="ts">
  import type { ChecklistSnapshotWire } from "@reactive-agents/ui-core";
  import { planCardModel } from "$lib/checklist-view.js";
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import Icon from "$lib/components/kit/Icon.svelte";

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

  const ICON = { pending: "circle", in_progress: "retry", done: "check-circle", blocked: "ban" } as const;
  const PILL_ICON = { met: "check-circle", unmet: "alert-circle", pending: "circle", none: "goal" } as const;
</script>

{#if model.show}
  <section class="plan" aria-label="Goal checks" data-testid="plan-card">
    <button type="button" class="pill" data-status={model.goals.status} aria-expanded={open} aria-controls="plan-body" onclick={() => (pinned = !open)}>
      <Icon name={model.goals.show ? PILL_ICON[model.goals.status] : "checklist"} size="sm" />
      <span class="head-label">{model.label}</span>
      {#if model.goals.show && model.planLabel}<span class="muted">· {model.planLabel}</span>{/if}
      <span class="chev" class:open><Icon name="down" size="sm" /></span>
    </button>

    {#if open}
      <div id="plan-body" class="body">
        <!-- The strategy's plan, tracked by the harness from its own state. -->
        {#if model.plan.length > 0}
          <h4 class="sec">{model.planLabel}</h4>
          <ol class="rows">
            {#each model.plan as r (r.id)}
              <li class="row" class:current={r.status === "in_progress"} data-status={r.status} data-testid="plan-row">
                <span class="ico" role="img" aria-label={r.status.replace("_", " ")}><Icon name={ICON[r.status]} size="sm" /></span>
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
                <span class="ico" role="img" aria-label={r.status.replace("_", " ")}><Icon name={ICON[r.status]} size="sm" /></span>
                <span class="title">{r.title}{#if r.status === "blocked" && r.reason}<span class="reason">: {r.reason}</span>{/if}</span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if gateLine && exitGate}
          <div class="gate" data-decision={exitGate.decision} role="status" data-testid="exit-gate">
            <Icon name={exitGate.decision === "repair" ? "retry" : "goal"} size="sm" />
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
  .plan { font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    font: inherit;
    font-size: var(--cortex-t-xs);
    font-weight: 500;
    cursor: pointer;
  }
  .pill:hover { color: var(--cortex-text); }
  .pill[data-status="met"] { color: var(--cortex-ok); background: var(--cortex-ok-tint); }
  .pill[data-status="unmet"] { color: var(--cortex-warn); background: var(--cortex-warn-tint); }
  .pill[data-status="pending"] { color: var(--cortex-accent); background: var(--cortex-accent-tint); }
  .head-label { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { opacity: 0.85; font-variant-numeric: tabular-nums; }
  .chev { display: inline-flex; transition: transform var(--cortex-d-fast); }
  .chev.open { transform: rotate(180deg); }

  .body { margin-top: 6px; padding: 4px 0 2px 10px; border-left: 1px solid var(--cortex-line); }
  .sec { margin: 4px 0 2px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .rows { margin: 0; padding: 0; list-style: none; }
  .row { display: flex; align-items: flex-start; gap: 6px; padding: 1px 4px; line-height: var(--cortex-lh-ui); }
  .row .ico { display: inline-flex; flex: none; padding-top: 1px; color: var(--cortex-text-3); }
  .row[data-status="done"] .ico { color: var(--cortex-ok); }
  .row[data-status="done"] .title, .row[data-status="pending"] .title { color: var(--cortex-text-2); }
  .row.current .title { color: var(--cortex-text); }
  .row[data-status="blocked"] .ico, .reason { color: var(--cortex-bad); }
  .row[data-status="in_progress"] .ico { color: var(--cortex-accent); }
  .gate { display: flex; align-items: center; gap: 6px; margin-top: 6px; padding: 2px 4px; font-weight: 600; }
  .gate[data-decision="repair"] { color: var(--cortex-accent); }
  .gate[data-decision="handoff"], .gate[data-decision="accept-unfinished"] { color: var(--cortex-bad); }
  .gate-items { padding-left: 24px; color: var(--cortex-text-2); }
</style>
