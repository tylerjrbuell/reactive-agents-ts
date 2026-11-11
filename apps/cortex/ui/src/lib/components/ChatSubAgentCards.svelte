<script lang="ts">
  import { onMount } from "svelte";
  import { subAgentRollup, type ChecklistSnapshotWire } from "@reactive-agents/ui-core";
  import { subAgentCard, type ChatSubAgent } from "$lib/sub-agent-view.js";
  import ChatSubAgentDrawer from "$lib/components/ChatSubAgentDrawer.svelte";

  interface Props {
    agents: readonly ChatSubAgent[];
    /** The parent turn's checklist: a child's goal status is read from its group there. */
    checklist?: ChecklistSnapshotWire;
  }
  const { agents, checklist }: Props = $props();

  let now = $state(Date.now());
  const anyRunning = $derived(agents.some((a) => a.status === "running"));
  // Tick only while a child runs, so finished cards cost nothing.
  onMount(() => {
    const id = setInterval(() => {
      if (anyRunning) now = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  const cards = $derived(agents.map((a) => ({ agent: a, card: subAgentCard(a, now, checklist) })));
  const rollup = $derived(subAgentRollup(cards.map((c) => c.card)));
  let openKey = $state<string | null>(null);
  const opened = $derived(cards.find((c) => c.agent.key === openKey));

  const GOAL_ICON = { met: "check_circle", unmet: "error", pending: "radio_button_unchecked" } as const;
  const GOAL_TITLE = { met: "Goals met", unmet: "Goals not met", pending: "Goals in progress" } as const;
</script>

<!-- Background agents: one compact card each; the detail lives in the side panel. -->
<section class="agents" aria-label="Sub-agents" data-testid="sub-agent-cards">
  <p class="rollup">
    <span class="material-symbols-outlined" aria-hidden="true">hub</span>{rollup.label}
  </p>
  <ul class="grid">
    {#each cards as { agent, card } (agent.key)}
      <li>
        <button
          type="button"
          class="card"
          data-state={card.state}
          aria-haspopup="dialog"
          aria-label={`Open sub-agent ${card.title} (${card.state})`}
          onclick={() => (openKey = agent.key)}
        >
          <span class="top">
            <span class="dot" aria-hidden="true"></span>
            <span class="name">{card.title}</span>
            {#if card.goals !== "none"}
              <span class="material-symbols-outlined goal" data-goal={card.goals} title={GOAL_TITLE[card.goals]} aria-label={GOAL_TITLE[card.goals]}>{GOAL_ICON[card.goals]}</span>
            {/if}
            <span class="meta">{card.meta}{#if card.failedCalls > 0}<span class="failed">{`· ${card.failedCalls} failed`}</span>{/if}</span>
          </span>
          <span class="activity" title={card.activity}>{card.activity}</span>
        </button>
      </li>
    {/each}
  </ul>
</section>

{#if opened}
  <ChatSubAgentDrawer agent={opened.agent} card={opened.card} onClose={() => (openKey = null)} />
{/if}

<style>
  .agents { margin: 0.375rem 0; }
  .rollup {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin: 0 0 0.25rem;
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: var(--cortex-text-muted);
  }
  .rollup .material-symbols-outlined { font-size: 12px; line-height: 1; }
  .grid {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.375rem;
  }
  .card {
    --tone: var(--cortex-text-muted);
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.3125rem 0.5rem;
    border: 1px solid var(--cortex-border);
    border-left: 2px solid var(--tone);
    border-radius: 6px;
    background: var(--cortex-surface-low);
    text-align: left;
    cursor: pointer;
    font-family: ui-monospace, monospace;
    color: var(--cortex-text);
  }
  .card:hover { background: var(--cortex-surface-mid); }
  .card:focus-visible { outline: 2px solid var(--color-secondary, #7ee3c3); outline-offset: 1px; }
  .card[data-state="running"] { --tone: var(--color-secondary, #7ee3c3); }
  .card[data-state="done"] { --tone: color-mix(in srgb, var(--color-secondary, #7ee3c3) 45%, var(--cortex-border)); }
  .card[data-state="failed"] { --tone: var(--color-error, #ff6b6b); }
  .card[data-state="abstained"] { --tone: #e0b25c; }
  .top { display: flex; align-items: center; gap: 0.375rem; min-width: 0; font-size: 10px; }
  .dot { width: 6px; height: 6px; flex: none; border-radius: 9999px; background: var(--tone); }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .goal { font-size: 12px; line-height: 1; flex: none; color: var(--cortex-text-muted); }
  .goal[data-goal="met"] { color: var(--color-secondary, #7ee3c3); }
  .goal[data-goal="unmet"] { color: var(--color-error, #ff6b6b); }
  .meta { margin-left: auto; flex: none; color: var(--cortex-text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .failed { margin-left: 0.25rem; color: var(--color-error, #ff6b6b); }
  .activity {
    font-size: 9.5px;
    line-height: 1.45;
    color: var(--cortex-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: no-preference) {
    .card[data-state="running"] .dot { animation: agent-pulse 1.4s ease-in-out infinite; }
  }
  @keyframes agent-pulse { 50% { opacity: 0.35; } }
</style>
