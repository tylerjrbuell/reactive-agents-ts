<script lang="ts">
  import Tooltip from "$lib/components/Tooltip.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { chatGoalStore } from "$lib/stores/chat-goal.js";
  import { chatStore } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { goalView, scheduleFired, scheduleLabel, shouldPoll, type GoalAction } from "$lib/goal-view.js";

  interface Props {
    sessionId: string;
    /** Turn count; a change means a segment or schedule fire may have landed, so schedules re-read. */
    turnCount: number;
  }
  const { sessionId: sessionIdProp, turnCount: turnCountProp }: Props = $props();
  // The parent passes these as live getters over the whole chat store, so reading them directly would re-run
  // every effect below on EVERY store update (including the refresh those effects trigger: a fetch storm).
  // A $derived compares by value, so effects only re-run when the id or count actually changes.
  const sessionId = $derived(sessionIdProp);
  const turnCount = $derived(turnCountProp);

  const POLL_MS = 2000;
  const SCHEDULE_POLL_MS = 5000;
  const goal = $derived($chatGoalStore.sessionId === sessionId ? $chatGoalStore.goal : null);
  const schedules = $derived($chatGoalStore.sessionId === sessionId ? $chatGoalStore.schedules : []);
  const view = $derived(goal ? goalView(goal) : null);
  const reason = $derived($chatGoalStore.sessionId === sessionId ? $chatGoalStore.reason : null);
  let dismissedId = $state<string | null>(null);
  let busy = $state(false);

  // New session: clear the other chat's goal immediately, then load this one's.
  $effect(() => {
    const sid = sessionId;
    lastRuns = new Map();
    chatGoalStore.reset(sid);
    dismissedId = null;
    void chatGoalStore.loadGoal(sid).catch(() => {});
    void chatGoalStore.loadSchedules(sid).catch(() => {});
  });

  $effect(() => {
    void turnCount;
    void chatGoalStore.loadSchedules(sessionId).catch(() => {});
  });

  // Loops and schedules fire server-side while the page is open. Watch the fire counters and re-read the
  // conversation whenever one moves, so scheduled turns show up without a refresh.
  $effect(() => {
    if (schedules.length === 0) return;
    const sid = sessionId;
    const t = setInterval(() => void chatGoalStore.loadSchedules(sid).catch(() => {}), SCHEDULE_POLL_MS);
    return () => clearInterval(t);
  });
  // Per-schedule run counts: only an already-known schedule whose counter rose is a fire, so the list being
  // cleared/reloaded on a session switch can never look like one.
  let lastRuns = new Map<string, number>();
  $effect(() => {
    const list = schedules;
    if (scheduleFired(lastRuns, list)) void chatStore.refreshActive();
    lastRuns = new Map(list.map((s) => [s.id, s.runs]));
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
  const STATE_ICON = { met: "check-circle", undecided: "circle" } as const;
</script>

{#if goal && view && !(view.terminal && dismissedId === goal.id)}
  <section class="goal" data-tone={view.tone} data-testid="goal-bar" aria-label="Goal">
    <div class="head">
      <span class="flag"><Icon name="goal" /></span>
      <Tooltip text={goal.objective} class="min-w-0 flex-[1_1_8rem]"><span class="objective">{goal.objective}</span></Tooltip>
      <span class="status" data-tone={view.tone}>{view.statusLabel}</span>
    </div>
    {#if view.criteria.length > 0}
      <ul class="rows">
        {#each view.criteria as c (c.id)}
          <li class="row" data-state={c.state}>
            <span class="ico"><Icon name={STATE_ICON[c.state]} size="sm" /></span>
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
        <span class="chip-ico"><Icon name={s.kind === "loop" ? "retry" : "clock"} size="sm" /></span>
        <span class="chip-text">{scheduleLabel(s)}</span>
        <button type="button" class="chip-x" aria-label="Remove schedule {s.id}" onclick={() => void removeSchedule(s.id)}>
          <Icon name="x" size="sm" />
        </button>
      </span></Tooltip>
    {/each}
  </div>
{/if}

<style>
  .goal {
    margin: 0 0 8px;
    border: 1px solid var(--cortex-line);
    border-left-width: 3px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    padding: 8px 12px;
    font-family: var(--cortex-font-ui);
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text);
    min-width: 0;
  }
  .goal[data-tone="live"] { border-left-color: var(--cortex-accent); }
  .goal[data-tone="good"] { border-left-color: var(--cortex-ok); }
  .goal[data-tone="warn"] { border-left-color: var(--cortex-warn); }
  .goal[data-tone="bad"] { border-left-color: var(--cortex-bad); }
  .head { display: flex; align-items: center; gap: 0.375rem; min-width: 0; flex-wrap: wrap; }
  .flag { display: inline-flex; color: var(--cortex-text-3); flex: none; }
  .objective { display: block; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { color: var(--cortex-text-2); font-size: var(--cortex-t-2xs); }
  .status[data-tone="good"], .status[data-tone="live"] { color: var(--cortex-ok); }
  .status[data-tone="warn"] { color: var(--cortex-warn); }
  .status[data-tone="bad"] { color: var(--cortex-bad); }
  .rows { margin: 0.25rem 0 0; padding: 0; list-style: none; }
  .row { display: flex; align-items: flex-start; gap: 0.375rem; padding: 0.0625rem 0.25rem; line-height: 1.45; }
  .ico { display: inline-flex; padding-top: 1px; flex: none; color: var(--cortex-text-3); }
  .row[data-state="met"] .ico { color: var(--cortex-ok); }
  .title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .st { color: var(--cortex-text-2); font-size: var(--cortex-t-2xs); white-space: nowrap; }
  .meters { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; margin-top: 0.375rem; }
  .meter { display: flex; align-items: center; gap: 0.375rem; font-variant-numeric: tabular-nums; }
  .m-label { color: var(--cortex-text-2); }
  .bar { width: 3.5rem; height: 4px; border-radius: 2px; background: var(--cortex-line); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--cortex-ok); }
  .bar i.hot { background: var(--cortex-bad); }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.375rem; }
  .verdict { color: var(--cortex-text-2); }
  .reason { color: var(--cortex-warn); flex: 1 1 100%; overflow-wrap: anywhere; }
  .actions { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .btn {
    cursor: pointer; font: inherit; padding: 0.125rem 0.5rem; border-radius: 6px;
    border: 1px solid var(--cortex-line); background: none; color: var(--cortex-text);
  }
  .btn:hover:not(:disabled) { background: var(--cortex-surface-3); }
  .btn.primary { border-color: color-mix(in srgb, var(--cortex-accent) 45%, transparent); color: var(--cortex-accent); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn:focus-visible, .chip-x:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 8px; font-family: var(--cortex-font-ui); font-size: var(--cortex-t-2xs); }
  .chip {
    display: inline-flex; align-items: center; gap: 0.25rem; max-width: 100%;
    border: 1px solid var(--cortex-line); border-radius: 9999px; padding: 0.0625rem 0.25rem 0.0625rem 0.5rem;
    color: var(--cortex-text-2);
  }
  .chip-ico { display: inline-flex; }
  .chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .chip-x { display: inline-flex; cursor: pointer; background: none; border: 0; padding: 0; color: inherit; border-radius: 9999px; }
  .chip-x:hover { color: var(--cortex-text); }
</style>
