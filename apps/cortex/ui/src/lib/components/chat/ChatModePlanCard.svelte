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
  import Select from "$lib/components/kit/Select.svelte";
  import { extrasEdited, extrasOfSteps, planProblem, pruneExtras, type ExtrasMap } from "$lib/plan-extras.js";
  import { PLAN_STRATEGY_OPTIONS, choiceOfValue, strategyNote, type PlanStrategyChoice } from "$lib/plan-strategy.js";
  import type { PlanExecuteHandler } from "$lib/stores/chat-mode-store.js";

  interface Props {
    /** Run the plan: record `edited` (when the user changed it), switch to Execute, run it in the chosen strategy. Resolves the line to show when it failed. */
    onExecute?: PlanExecuteHandler;
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
  // Each step's dependsOn / args ride beside the steps (`lib/plan-extras.ts`).
  let extrasDraft = $state<ExtrasMap | null>(null);
  const savedExtras = $derived(extrasOfSteps($chatPlan?.steps ?? []));
  const extras = $derived(extrasDraft ?? savedExtras);
  const dirty = $derived((draft !== null && planEdited(saved, draft)) || (extrasDraft !== null && extrasEdited(savedExtras, extrasDraft)));
  // Whether the edited graph can run is the framework's check (`findPlanDependencyProblem`); the server's `PlanInvalidError` reason lands in `runError`.
  const problem = $derived(planProblem(steps, extras));
  let runError = $state<string | undefined>(undefined);
  let strategy = $state<PlanStrategyChoice>("auto");
  let busy = $state(false);
  const reset = () => {
    draft = null;
    extrasDraft = null;
  };
  function changeSteps(next: readonly DraftStep[]) {
    draft = next;
    const kept = pruneExtras(extras, next);
    if (kept !== extras) extrasDraft = kept; // a removed step takes its entry and the prerequisites on it
  }

  // The tool dropdown offers what the session offers: the quick bar's own catalog and rules.
  let catalog = $state<QuickbarCatalog>(EMPTY_CATALOG);
  $effect(() => {
    if (editable) void loadQuickbarCatalog().then((c) => (catalog = c));
  });
  const sessionConfig = $derived($chatStore.sessions.find((s) => s.sessionId === $chatStore.activeSessionId)?.agentConfig ?? {});
  const toolChoices = $derived(planToolOptions(sessionConfig, catalog, steps.flatMap((s) => (s.tool !== undefined ? [s.tool] : []))));

  async function run() {
    busy = true;
    runError = undefined;
    try {
      const failed = await onExecute?.(dirty ? steps : undefined, { strategy, extras });
      if (failed === undefined) reset();
      else runError = failed;
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (!dirty) return;
    busy = true;
    try {
      if (await savePlan(steps, undefined, extras)) reset();
    } finally {
      busy = false;
    }
  }
</script>

<section class="card" class:past={!editable} aria-label="Plan" data-testid="mode-plan-card">
  <header class="head">
    <Icon name="checklist" size="sm" /><span>Plan</span>
    <span class="sub">{editable ? "Reasoning only: nothing has run" : planProgressLine(steps)}</span>
    <PlanTransferMenu idBase="plan-{turnId}" canExport={saved.length > 0} canImport={editable} dirty={dirty} onimported={reset} />
  </header>

  {#if steps.length > 0 || editable}
    <div class="steps">
      <PlanChecklist idBase="plan-{turnId}" {steps} {editable} {toolChoices} {extras} onchange={changeSteps} onextras={(next) => (extrasDraft = next)} />
    </div>
  {/if}

  {#if editable && problem}
    <p class="problem" role="alert" data-testid="plan-problem">{problem}</p>
  {:else if runError}
    <p class="problem" role="alert" data-testid="plan-run-error">{runError}</p>
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
      <Button variant="primary" icon="play" disabled={busy || problem !== undefined} onclick={() => void run()} data-testid="plan-execute" title="Record this plan, switch to Execute and run it">Execute</Button>
      <Select id="plan-{turnId}-strategy" class="strategy" value={strategy} options={PLAN_STRATEGY_OPTIONS} aria-label="Execute strategy" onchange={(v) => (strategy = choiceOfValue(v))} />
      {#if dirty}<Button disabled={busy || problem !== undefined} onclick={() => void save()} data-testid="plan-save" title="Keep the edits without executing">Save plan</Button>{/if}
      <span class="note" data-testid="plan-strategy-note">{strategyNote(strategy, extras)}{dirty ? " Execute records your changes first." : ""}</span>
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
  .problem { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
  .foot :global(.strategy) { flex: 0 0 190px; min-width: 0; }
</style>
