<script lang="ts">
  /**
   * The run view header (Bench spec section 8, `run.html`) on the header band:
   * a breadcrumb `Runs › id · from chat X`, the run's name with its status,
   * and the actions: live controls while it runs, Continue in chat, Edit and
   * rerun, Export and More. Rename edits the title in place. RunDetail owns
   * every action; this component only lays them out.
   */
  import type { StatusView } from "@reactive-agents/ui-core";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import RunMenu, { type RunMenuItem } from "./RunMenu.svelte";
  import RunContinuation from "./RunContinuation.svelte";
  import { continuedFromLink } from "$lib/run-continuation.js";
  import type { RunStatus } from "$lib/stores/run-store.js";
  import { safetyCountLabel, type SafetyBadgeTone } from "$lib/run-safety.js";

  interface Props {
    runId: string;
    title: string;
    status: RunStatus;
    view: StatusView;
    /** Why a tolerated run shipped success (`AgentCompleted.outcome`), shown beside the status. */
    tolerated?: string;
    chatSessionId?: string;
    chatSessionName?: string;
    /** The run this one continues (a Continue's new run); the crumb links to it. */
    continuedFrom?: string;
    /** The run has a launch snapshot: Edit and rerun / Rerun are offered. */
    canRerun: boolean;
    busy: { readonly chat: boolean; readonly rerun: boolean; readonly delete: boolean };
    exportItems: readonly RunMenuItem[];
    moreItems: readonly RunMenuItem[];
    /** Rename in progress (the More menu's Rename sets it). */
    renaming: boolean;
    onRename: (label: string) => void;
    onCancelRename: () => void;
    onContinueInChat: () => void;
    onEditAndRerun: () => void;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
    onTerminate: () => void;
    /**
     * Set while the run waits on approvals: the header offers Approve / Deny in
     * place of the live controls (the run is paused at the gate, not working). One
     * entry per waiting request, each answered on its own (parallel sub-agents ask
     * under one run); `subAgent` names who is asking.
     */
    approvals?: readonly {
      readonly key: string;
      readonly toolName: string;
      readonly detail: string;
      readonly subAgent?: string;
      readonly busy: boolean;
      readonly onApprove: () => void;
      readonly onDeny: () => void;
    }[];
    /** Set when a safety mechanism fired (ui-core `safetySummaryOf`): a count beside the status that opens the Safety tab. */
    safety?: {
      readonly count: number;
      readonly tone: SafetyBadgeTone;
      readonly onOpen: () => void;
    };
    /** Set when the run asked judgments (ui-core `judgmentBadgeOf`): `N judgments, K failed or degraded`, opens the Judgments tab. */
    judgments?: {
      readonly text: string;
      readonly tone: SafetyBadgeTone;
      readonly onOpen: () => void;
    };
  }
  const p: Props = $props();

  let draft = $state("");
  let input = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (p.renaming && input) {
      draft = p.title;
      input.focus();
      input.select();
    }
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      p.onRename(draft);
    } else if (e.key === "Escape") {
      e.preventDefault();
      p.onCancelRename();
    }
  }
</script>

<header class="run-h band">
  <div class="main">
    <nav class="crumb" aria-label="Breadcrumb">
      <a href="/runs">Runs</a>
      <Icon name="chevron" size="sm" />
      <span class="data" use:tooltip={p.runId}>{p.runId.slice(0, 12)}</span>
      {#if p.chatSessionId}
        <span>from chat <a href="/chat?session={encodeURIComponent(p.chatSessionId)}">{p.chatSessionName ?? "a chat"}</a></span>
      {/if}
      <RunContinuation from={continuedFromLink(p)} />
    </nav>
    <div class="title">
      {#if p.renaming}
        <input bind:this={input} class="cx-control rename" bind:value={draft} onkeydown={onKey} onblur={() => p.onRename(draft)} aria-label="Run name" />
      {:else}
        <h1 use:tooltip={p.title}>{p.title}</h1>
      {/if}
      <Status tone={p.view.tone} label={p.view.label} />
      {#if p.tolerated}<span class="tol" use:tooltip={p.tolerated}>tolerated</span>{/if}
      {#if p.safety && p.safety.count > 0}
        <button type="button" class="safety tone-{p.safety.tone}" onclick={p.safety.onOpen} use:tooltip={"Open the Safety tab"}>
          <Icon name="alert-circle" size="sm" />{safetyCountLabel(p.safety.count)}
        </button>
      {/if}
      {#if p.judgments}
        <button type="button" class="safety tone-{p.judgments.tone}" data-testid="judgments-badge" onclick={p.judgments.onOpen} use:tooltip={"Open the Judgments tab"}>
          <Icon name="goal" size="sm" />{p.judgments.text}
        </button>
      {/if}
    </div>
  </div>
  <div class="actions">
    {#if p.approvals && p.approvals.length > 0}
      {#each p.approvals as a (a.key)}
        <span class="ask" data-testid="run-approval" use:tooltip={`${a.subAgent ? `${a.subAgent} · ` : ""}${a.toolName}: ${a.detail}`}>
          {#if a.subAgent}<span class="who">{a.subAgent}:</span>{/if}
          Approve <span class="data">{a.detail || a.toolName}</span>?
        </span>
        <Button size="sm" variant="primary" icon="check" disabled={a.busy} onclick={a.onApprove}>Approve</Button>
        <Button size="sm" variant="danger" icon="x" disabled={a.busy} onclick={a.onDeny}>Deny</Button>
      {/each}
    {:else if p.status === "live"}
      <Button size="sm" icon="pause" onclick={p.onPause}>Pause</Button>
      <Button size="sm" icon="stop" onclick={p.onStop}>Stop</Button>
      <Button size="sm" variant="danger" onclick={p.onTerminate}>Terminate</Button>
    {:else if p.status === "paused"}
      <Button size="sm" icon="play" onclick={p.onResume}>Resume</Button>
      <Button size="sm" icon="stop" onclick={p.onStop}>Stop</Button>
      <Button size="sm" variant="danger" onclick={p.onTerminate}>Terminate</Button>
    {/if}
    {#if p.status !== "live" && p.status !== "loading"}
      <Button icon="chat" disabled={p.busy.chat} onclick={p.onContinueInChat}>{p.busy.chat ? "Opening…" : "Continue in chat"}</Button>
    {/if}
    {#if p.canRerun}
      <Button icon="edit" onclick={p.onEditAndRerun}>Edit and rerun</Button>
    {/if}
    <RunMenu label="Export" icon="download" variant="ghost" items={p.exportItems} />
    <RunMenu title="More actions" items={p.moreItems} />
  </div>
</header>

<style>
  .run-h { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; padding: 16px 24px 12px; }
  .main { min-width: 0; flex: 1 1 320px; }
  .crumb { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .crumb a { color: var(--cortex-text-2); text-decoration: none; }
  .crumb a:hover { color: var(--cortex-text); text-decoration: underline; text-underline-offset: 2px; }
  .crumb a:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 4px; }
  .data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  .title { display: flex; align-items: center; gap: 12px; margin-top: 4px; min-width: 0; }
  h1 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--cortex-t-xl);
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: var(--cortex-lh-tight);
    color: var(--cortex-text);
  }
  .rename { max-width: 32rem; font-size: var(--cortex-t-lg); font-weight: 600; }
  .tol { font-size: var(--cortex-t-xs); color: var(--cortex-warn); }
  .safety { display: inline-flex; flex: none; align-items: center; gap: 4px; padding: 2px 8px; border: 1px solid transparent; border-radius: 999px; font: inherit; font-size: var(--cortex-t-xs); white-space: nowrap; cursor: pointer; }
  .safety.tone-accent { background: var(--cortex-accent-tint); color: var(--cortex-accent); }
  .safety.tone-warn { background: var(--cortex-warn-tint); color: var(--cortex-warn); }
  .safety.tone-bad { background: var(--cortex-bad-tint); color: var(--cortex-bad); }
  .safety.tone-ok { background: var(--cortex-ok-tint); color: var(--cortex-ok); }
  .safety:hover { border-color: currentColor; }
  .safety:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .ask { display: inline-flex; align-items: baseline; gap: 4px; max-width: 28rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .ask .who { color: var(--cortex-accent); font-weight: 500; }
  .ask .data { overflow: hidden; text-overflow: ellipsis; color: var(--cortex-text); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
</style>
