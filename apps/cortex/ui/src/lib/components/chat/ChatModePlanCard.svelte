<script lang="ts">
  /**
   * The session's plan as a card. Editable (Plan mode, the latest reply): the framework `Plan`'s
   * steps as a checklist the user can reword, reorder, remove and extend, then Execute, which
   * records the edited plan (`session.setPlan`), switches the session to Execute and sends the
   * follow-up turn in one step. Read-only (a plan that was executed): the same steps with their
   * live status. The model's reply prose sits under the steps, folded away. Calm accent edge, no
   * motion: the live glow means "running now" and is not used here.
   */
  import type { Snippet } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import PlanChecklist from "./PlanChecklist.svelte";
  import PlanTransferMenu from "./PlanTransferMenu.svelte";
  import { chatStore } from "$lib/stores/chat-store.js";
  import PlanFindings from "./PlanFindings.svelte";
  import { chatPlan, refreshChatPlan, saveFindings, savePlan } from "$lib/stores/chat-plan-store.js";
  import { findingsOfPlan } from "$lib/plan-findings.js";
  import { planEdited, planProgressLine, type DraftStep } from "$lib/plan-edit.js";
  import { EMPTY_CATALOG, loadQuickbarCatalog, type QuickbarCatalog } from "$lib/chat-quickbar-data.js";
  import { planToolOptions } from "$lib/plan-tool-options.js";

  interface Props {
    /** Run the plan: record `edited` (when the user changed it), switch to Execute, send the follow-up turn. */
    onExecute?: (edited?: readonly DraftStep[]) => void | Promise<void>;
    /** The assistant turn's id: keeps input ids unique when several cards are on the page. */
    turnId: number;
    children: Snippet;
  }
  const { onExecute, turnId, children }: Props = $props();
  const editable = $derived(onExecute !== undefined);

  // The server's plan, re-read when the card appears and whenever a turn ends (execution moves statuses).
  $effect(() => {
    if (!$chatStore.sending) void refreshChatPlan();
  });

  let draft = $state<readonly DraftStep[] | null>(null);
  const saved = $derived<readonly DraftStep[]>($chatPlan?.steps ?? []);
  const steps = $derived(draft ?? saved);
  const findings = $derived(findingsOfPlan($chatPlan));
  const dirty = $derived(draft !== null && planEdited(saved, draft));
  let busy = $state(false);

  // The tool dropdown offers what the session offers: the quick bar's own catalog and rules.
  let catalog = $state<QuickbarCatalog>(EMPTY_CATALOG);
  $effect(() => {
    if (editable) void loadQuickbarCatalog().then((c) => (catalog = c));
  });
  const sessionConfig = $derived($chatStore.sessions.find((s) => s.sessionId === $chatStore.activeSessionId)?.agentConfig ?? {});
  const toolChoices = $derived(planToolOptions(sessionConfig, catalog, steps.flatMap((s) => (s.tool !== undefined ? [s.tool] : []))));

  async function run() {
    busy = true;
    try {
      await onExecute?.(dirty ? (draft ?? undefined) : undefined);
      draft = null;
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (draft === null) return;
    busy = true;
    try {
      if (await savePlan(draft)) draft = null;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card" class:past={!editable} aria-label="Plan" data-testid="mode-plan-card">
  <header class="head">
    <Icon name="checklist" size="sm" /><span>Plan</span>
    <span class="sub">{editable ? "Reasoning only: nothing has run" : planProgressLine(steps)}</span>
    <PlanTransferMenu idBase="plan-{turnId}" canExport={saved.length > 0} canImport={editable} dirty={dirty} onimported={() => (draft = null)} />
  </header>

  {#if steps.length > 0 || editable}
    <div class="steps">
      <PlanChecklist idBase="plan-{turnId}" {steps} {editable} {toolChoices} onchange={(next) => (draft = next)} />
    </div>
  {/if}

  <PlanFindings findings={findings} {editable} onchange={(next) => void saveFindings(next)} />

  {#if steps.length > 0}
    <details class="reply">
      <summary>The reply</summary>
      <div class="body">{@render children()}</div>
    </details>
  {:else}
    <div class="body">{@render children()}</div>
  {/if}

  {#if editable}
    <footer class="foot">
      <Button variant="primary" icon="play" disabled={busy} onclick={() => void run()} data-testid="plan-execute" title="Record this plan, switch to Execute and send “Execute the plan.”">Execute</Button>
      {#if dirty}<Button disabled={busy} onclick={() => void save()} data-testid="plan-save" title="Keep the edits without executing">Save plan</Button>{/if}
      <span class="note">{dirty ? "Edited: Execute records your changes first." : "Edit the steps, or reply to adjust the plan."}</span>
    </footer>
  {/if}
</section>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--cortex-line-strong);
    border-left: 3px solid var(--cortex-accent);
    border-radius: var(--cortex-r-panel);
    background: color-mix(in srgb, var(--cortex-accent-tint) 40%, var(--cortex-surface-1));
  }
  .card.past { border-left-color: var(--cortex-line-strong); background: var(--cortex-surface-1); }
  .head { display: flex; align-items: center; gap: 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-accent); }
  .past .head { color: var(--cortex-text-2); }
  .sub { font-weight: 400; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .steps { min-width: 0; }
  .body { min-width: 0; }
  .reply summary { cursor: pointer; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .reply .body { margin-top: 6px; }
  .foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .note { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
</style>
