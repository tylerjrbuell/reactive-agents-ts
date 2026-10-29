<script lang="ts">
  import { addTodo, clearCompleted, todoDockMode, todoDockView, toggleTodo, type TodoItem } from "$lib/todo-dock.js";

  interface Props {
    /** The conversation's to-do list. */
    items: readonly TodoItem[];
    /** True while a turn is running: the server rejects edits mid-turn, so the controls are inert. */
    busy?: boolean;
    /** Session has the todo tool enabled: an empty list then shows a slim "+ To-do" add affordance. */
    enabled?: boolean;
    /** Persist an edited list (replaces the whole list). */
    onChange: (items: TodoItem[]) => void;
  }
  const { items, busy = false, enabled = false, onChange }: Props = $props();

  const KEY = "cortex.chat.todoOpen";
  const read = (): boolean => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  };
  let open = $state(read());
  const setOpen = (v: boolean) => {
    open = v;
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* per-viewer convenience only */
    }
  };

  let draft = $state("");
  const view = $derived(todoDockView(items));
  const mode = $derived(todoDockMode(items, enabled));
  const ICON = { pending: "radio_button_unchecked", in_progress: "autorenew", completed: "check_circle" } as const;

  function add() {
    if (busy || draft.trim().length === 0) return;
    onChange(addTodo(items, draft));
    draft = "";
  }
  const hasDone = $derived(view.done > 0);
</script>

{#if mode === "empty"}
  <section class="dock" aria-label="Conversation to-do list" data-testid="todo-dock-empty" data-open={open}>
    <button type="button" class="pill" aria-expanded={open} aria-controls="todo-dock-body" onclick={() => setOpen(!open)} data-testid="todo-add-pill">
      <span class="material-symbols-outlined chev" class:open aria-hidden="true">add</span>
      <span class="count">To-do</span>
      <span class="now"></span>
    </button>
    {#if open}
      <div id="todo-dock-body" class="panel">
        <form class="add" onsubmit={(e) => { e.preventDefault(); add(); }}>
          <input type="text" class="add-input" placeholder="Add a to-do…" aria-label="Add a to-do" bind:value={draft} disabled={busy} maxlength="200" />
          <button type="submit" class="btn" disabled={busy || draft.trim().length === 0}>Add</button>
        </form>
      </div>
    {/if}
  </section>
{:else if mode === "full"}
  <section class="dock" aria-label="Conversation to-do list" data-testid="todo-dock" data-open={open}>
    <button type="button" class="pill" aria-expanded={open} aria-controls="todo-dock-body" onclick={() => setOpen(!open)} data-testid="todo-pill">
      <span class="material-symbols-outlined chev" class:open aria-hidden="true">chevron_right</span>
      <span class="count">To-do {view.done}/{view.total}</span>
      {#if view.current}
        <span class="now" data-testid="todo-now"><span class="spin" aria-hidden="true"></span><span class="now-text">{view.current.title}</span></span>
      {:else if view.allDone}
        <span class="now done-note"><span class="material-symbols-outlined ok" aria-hidden="true">check_circle</span>All done</span>
      {:else}
        <span class="now"></span>
      {/if}
      <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={view.progressPct} aria-label="To-do progress">
        <span class="fill" style:width="{view.progressPct}%"></span>
      </span>
    </button>

    {#if open}
      <div id="todo-dock-body" class="panel">
        <ul class="rows">
          {#each items as it (it.id)}
            <li class="row" class:current={view.current?.id === it.id} data-status={it.status}>
              <button
                type="button"
                class="tick"
                disabled={busy}
                aria-pressed={it.status === "completed"}
                aria-label={it.status === "completed" ? `Mark "${it.title}" not done` : `Mark "${it.title}" done`}
                onclick={() => onChange(toggleTodo(items, it.id))}
              >
                <span class="material-symbols-outlined ico" aria-hidden="true">{ICON[it.status]}</span>
              </button>
              <span class="title">{it.title}</span>
            </li>
          {/each}
        </ul>
        <div class="tools">
          <form class="add" onsubmit={(e) => { e.preventDefault(); add(); }}>
            <input
              type="text"
              class="add-input"
              placeholder="Add a to-do…"
              aria-label="Add a to-do"
              bind:value={draft}
              disabled={busy}
              maxlength="200"
            />
            <button type="submit" class="btn" disabled={busy || draft.trim().length === 0}>Add</button>
          </form>
          <span class="spacer"></span>
          <button type="button" class="btn" disabled={busy || !hasDone} onclick={() => onChange(clearCompleted(items))}>Clear completed</button>
          <button type="button" class="btn" disabled={busy} onclick={() => onChange([])}>Clear all</button>
        </div>
      </div>
    {/if}
  </section>
{/if}

<style>
  .dock {
    margin: 0.5rem 0.75rem 0;
    border: 1px solid var(--cortex-border);
    border-radius: 8px;
    background: var(--cortex-surface-low);
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--cortex-text);
    flex-shrink: 0;
  }
  .pill {
    display: flex; width: 100%; align-items: center; gap: 0.5rem;
    padding: 0.375rem 0.625rem; background: none; border: 0; cursor: pointer;
    font: inherit; color: inherit; text-align: left;
  }
  .pill:focus-visible, .tick:focus-visible, .btn:focus-visible, .add-input:focus-visible {
    outline: 2px solid var(--color-secondary, #7ee3c3); outline-offset: 2px; border-radius: 4px;
  }
  .count { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .chev { font-size: 14px; line-height: 1; color: var(--cortex-text-muted); transition: transform 150ms; }
  .chev.open { transform: rotate(90deg); }
  .dock { min-width: 0; }
  .now {
    flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 0.375rem;
    color: var(--cortex-text);
  }
  .now-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .done-note { color: var(--cortex-text-muted); }
  .ok { font-size: 14px; color: var(--color-secondary, #7ee3c3); }
  .spin {
    width: 8px; height: 8px; flex: none; border-radius: 9999px; box-sizing: border-box;
    border: 1.5px solid var(--cortex-border); border-top-color: var(--color-secondary, #7ee3c3);
  }
  .bar { width: 4.5rem; flex: none; height: 3px; border-radius: 2px; background: var(--cortex-border); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--color-secondary, #7ee3c3); transition: width 200ms ease-out; }

  .panel { border-top: 1px solid var(--cortex-border); padding: 0.375rem 0.625rem 0.5rem; }
  .rows { margin: 0; padding: 0; list-style: none; max-height: 11rem; overflow-y: auto; }
  .row { display: flex; align-items: flex-start; gap: 0.25rem; padding: 0.0625rem 0.25rem; border-radius: 4px; line-height: 1.5; }
  .row.current { background: color-mix(in srgb, var(--color-secondary, #7ee3c3) 12%, transparent); }
  .row .title { padding-top: 0.0625rem; min-width: 0; overflow-wrap: anywhere; }
  .row[data-status="pending"] .title { color: var(--cortex-text-muted); }
  .row[data-status="completed"] .title { color: var(--cortex-text-muted); text-decoration: line-through; opacity: 0.7; }
  .row.current .title { color: var(--cortex-text); font-weight: 600; }
  .tick { flex: none; display: inline-flex; padding: 0; background: none; border: 0; cursor: pointer; color: var(--cortex-text-muted); }
  .tick:disabled { cursor: default; opacity: 0.6; }
  .ico { font-size: 15px; line-height: 1.4; }
  .row[data-status="completed"] .ico, .row[data-status="in_progress"] .ico { color: var(--color-secondary, #7ee3c3); }

  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; margin-top: 0.5rem; }
  .spacer { flex: 1; }
  .add { display: flex; gap: 0.25rem; flex: 1 1 12rem; min-width: 0; }
  .add-input {
    flex: 1; min-width: 0; padding: 0.1875rem 0.5rem; font: inherit; color: var(--cortex-text);
    background: var(--cortex-surface-low); border: 1px solid var(--cortex-border); border-radius: 6px;
  }
  .add-input::placeholder { color: var(--cortex-text-muted); }
  .btn {
    padding: 0.1875rem 0.5rem; font: inherit; color: var(--cortex-text-muted); cursor: pointer;
    background: none; border: 1px solid var(--cortex-border); border-radius: 6px;
  }
  .btn:hover:not(:disabled) { color: var(--cortex-text); border-color: var(--color-secondary, #7ee3c3); }
  .btn:disabled { cursor: default; opacity: 0.45; }

  @media (max-width: 700px) {
    .dock { margin: 0.5rem 0 0; border-left: 0; border-right: 0; border-radius: 0; }
    .bar { width: 2.5rem; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .spin { animation: dock-spin 0.9s linear infinite; }
    .row[data-status="in_progress"] .ico { animation: dock-spin 2s linear infinite; }
  }
  @keyframes dock-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .chev, .fill { transition: none; }
  }
</style>
