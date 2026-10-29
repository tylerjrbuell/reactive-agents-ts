<script lang="ts">
  import Tooltip from "$lib/components/Tooltip.svelte";
  import { chatGoalStore } from "$lib/stores/chat-goal.js";
  import { chatStore } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { goalView, scheduleLabel, shouldPoll, type GoalAction } from "$lib/goal-view.js";

  interface Props {
    sessionId: string;
    /** Turn count; a change means a segment or schedule fire may have landed, so schedules re-read. */
    turnCount: number;
  }
  const { sessionId, turnCount }: Props = $props();

  const POLL_MS = 2000;
  const goal = $derived($chatGoalStore.sessionId === sessionId ? $chatGoalStore.goal : null);
  const schedules = $derived($chatGoalStore.sessionId === sessionId ? $chatGoalStore.schedules : []);
  const view = $derived(goal ? goalView(goal) : null);
  const reason = $derived($chatGoalStore.sessionId === sessionId ? $chatGoalStore.reason : null);
  let dismissedId = $state<string | null>(null);
  let busy = $state(false);

  // New session: clear the other chat's goal immediately, then load this one's.
  $effect(() => {
    const sid = sessionId;
    chatGoalStore.reset(sid);
    dismissedId = null;
    void chatGoalStore.loadGoal(sid).catch(() => {});
    void chatGoalStore.loadSchedules(sid).catch(() => {});
  });

  $effect(() => {
    void turnCount;
    void chatGoalStore.loadSchedules(sessionId).catch(() => {});
  });

  // Poll only while the goal can change by itself.
  $effect(() => {
    if (!shouldPoll(goal?.status)) return;
    const sid = sessionId;
    const t = setInterval(() => void chatGoalStore.loadGoal(sid).catch(() => {}), POLL_MS);
    return () => clearInterval(t);
  });

  // A segment boundary means new turns exist server-side.
  let lastSegments: number | null = null;
  $effect(() => {
    const n = goal?.segments ?? null;
    if (lastSegments !== null && n !== null && n !== lastSegments) void chatStore.refreshActive();
    lastSegments = n;
  });

  async function act(a: GoalAction) {
    if (busy) return;
    busy = true;
    try {
      await chatGoalStore.transition(sessionId, a);
    } catch (e) {
      toast.error(`Goal ${a} failed`, e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
  async function removeSchedule(id: string) {
    try {
      await chatGoalStore.removeSchedule(sessionId, id);
    } catch (e) {
      toast.error("Remove failed", e instanceof Error ? e.message : String(e));
    }
  }
  const LABEL: Record<GoalAction, string> = { accept: "Accept", pause: "Pause", resume: "Resume", cancel: "Cancel" };
  const STATE_ICON = { met: "check_circle", undecided: "radio_button_unchecked" } as const;
</script>

{#if goal && view && !(view.terminal && dismissedId === goal.id)}
  <section class="goal" data-tone={view.tone} data-testid="goal-bar" aria-label="Goal">
    <div class="head">
      <span class="material-symbols-outlined flag" aria-hidden="true">flag</span>
      <Tooltip text={goal.objective} class="min-w-0 flex-[1_1_8rem]"><span class="objective">{goal.objective}</span></Tooltip>
      <span class="status" data-tone={view.tone}>{view.statusLabel}</span>
    </div>
    {#if view.criteria.length > 0}
      <ul class="rows">
        {#each view.criteria as c (c.id)}
          <li class="row" data-state={c.state}>
            <span class="material-symbols-outlined ico" aria-hidden="true">{STATE_ICON[c.state]}</span>
            <span class="title">{c.text}</span>
            <span class="st">{c.stateText}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="meters">
      {#each view.meters as m (m.label)}
        <Tooltip text="{m.label} {m.text}"><div class="meter">
          <span class="m-label">{m.label}</span>
          <span class="m-text">{m.text}</span>
          {#if m.pct !== null}<span class="bar"><i style="width:{m.pct}%" class:hot={m.pct >= 90}></i></span>{/if}
        </div></Tooltip>
      {/each}
    </div>
    <div class="foot">
      <span class="verdict" data-testid="goal-verdict">{view.verdictText}</span>
      {#if reason && (goal.status === "blocked" || goal.status === "stalled")}
        <span class="reason" data-testid="goal-reason">{reason}</span>
      {/if}
      <span class="actions">
        {#each view.actions as a (a)}
          <button type="button" class="btn" class:primary={a === "accept" || a === "resume"} disabled={busy} onclick={() => void act(a)}>{LABEL[a]}</button>
        {/each}
        {#if view.terminal}
          <button type="button" class="btn" onclick={() => (dismissedId = goal.id)}>Dismiss</button>
        {/if}
      </span>
    </div>
  </section>
{/if}

{#if schedules.length > 0}
  <div class="chips" data-testid="schedule-chips" aria-label="Active schedules">
    {#each schedules as s (s.id)}
      <Tooltip text="{s.prompt} · {s.runs} run{s.runs === 1 ? '' : 's'}{s.lastStatus ? ` · last: ${s.lastStatus}` : ''}"><span class="chip">
        <span class="material-symbols-outlined chip-ico" aria-hidden="true">{s.kind === "loop" ? "repeat" : "schedule"}</span>
        <span class="chip-text">{scheduleLabel(s)}</span>
        <button type="button" class="chip-x" aria-label="Remove schedule {s.id}" onclick={() => void removeSchedule(s.id)}>
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </span></Tooltip>
    {/each}
  </div>
{/if}

<style>
  .goal {
    margin: 0 0.75rem 0.375rem;
    border: 1px solid var(--cortex-border);
    border-left-width: 3px;
    border-radius: 8px;
    background: var(--cortex-surface-low);
    padding: 0.375rem 0.625rem 0.5rem;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--cortex-text);
    min-width: 0;
  }
  .goal[data-tone="live"] { border-left-color: var(--color-secondary, #7ee3c3); }
  .goal[data-tone="good"] { border-left-color: var(--color-secondary, #7ee3c3); }
  .goal[data-tone="warn"] { border-left-color: var(--color-warning, #f5b84b); }
  .goal[data-tone="bad"] { border-left-color: var(--color-error, #ff6b6b); }
  .head { display: flex; align-items: center; gap: 0.375rem; min-width: 0; flex-wrap: wrap; }
  .flag { font-size: 15px; color: var(--cortex-text-muted); flex: none; }
  .objective { display: block; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { color: var(--cortex-text-muted); font-size: 10px; }
  .status[data-tone="good"], .status[data-tone="live"] { color: var(--color-secondary, #7ee3c3); }
  .status[data-tone="warn"] { color: var(--color-warning, #f5b84b); }
  .status[data-tone="bad"] { color: var(--color-error, #ff6b6b); }
  .rows { margin: 0.25rem 0 0; padding: 0; list-style: none; }
  .row { display: flex; align-items: flex-start; gap: 0.375rem; padding: 0.0625rem 0.25rem; line-height: 1.45; }
  .ico { font-size: 14px; line-height: 1.3; flex: none; color: var(--cortex-text-muted); }
  .row[data-state="met"] .ico { color: var(--color-secondary, #7ee3c3); }
  .title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .st { color: var(--cortex-text-muted); font-size: 10px; white-space: nowrap; }
  .meters { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; margin-top: 0.375rem; }
  .meter { display: flex; align-items: center; gap: 0.375rem; font-variant-numeric: tabular-nums; }
  .m-label { color: var(--cortex-text-muted); }
  .bar { width: 3.5rem; height: 4px; border-radius: 2px; background: var(--cortex-border); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--color-secondary, #7ee3c3); }
  .bar i.hot { background: var(--color-error, #ff6b6b); }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.375rem; }
  .verdict { color: var(--cortex-text-muted); }
  .reason { color: var(--color-warning, #f5b84b); flex: 1 1 100%; overflow-wrap: anywhere; }
  .actions { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .btn {
    cursor: pointer; font: inherit; padding: 0.125rem 0.5rem; border-radius: 6px;
    border: 1px solid var(--cortex-border); background: none; color: var(--cortex-text);
  }
  .btn:hover:not(:disabled) { background: var(--cortex-surface-mid); }
  .btn.primary { border-color: color-mix(in srgb, var(--color-primary, #8b5cf6) 45%, transparent); color: var(--color-primary, #8b5cf6); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn:focus-visible, .chip-x:focus-visible { outline: 2px solid var(--color-secondary, #7ee3c3); outline-offset: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.25rem; margin: 0 0.75rem 0.375rem; font-family: ui-monospace, monospace; font-size: 10px; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.25rem; max-width: 100%;
    border: 1px solid var(--cortex-border); border-radius: 9999px; padding: 0.0625rem 0.25rem 0.0625rem 0.5rem;
    color: var(--cortex-text-muted);
  }
  .chip-ico { font-size: 13px; }
  .chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .chip-x { display: inline-flex; cursor: pointer; background: none; border: 0; padding: 0; color: inherit; border-radius: 9999px; }
  .chip-x:hover { color: var(--cortex-text); }
  .chip-x .material-symbols-outlined { font-size: 13px; }
</style>
