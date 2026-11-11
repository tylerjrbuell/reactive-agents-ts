<script lang="ts">
  import { onMount } from "svelte";
  import { statusOfSubAgent, subAgentRollup, type ChecklistSnapshotWire } from "@reactive-agents/ui-core";
  import { subAgentCard, type ChatSubAgent } from "$lib/sub-agent-view.js";
  import ChatSubAgentDrawer from "$lib/components/ChatSubAgentDrawer.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";

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

  const BADGE = { running: "accent", done: "ok", failed: "bad", abstained: "neutral" } as const;
  const BADGE_TEXT = { running: "running", done: "done", failed: "failed", abstained: "declined" } as const;
  const GOAL_ICON = { met: "check-circle", unmet: "alert-circle", pending: "circle" } as const;
  const GOAL_TITLE = { met: "Goals met", unmet: "Goals not met", pending: "Goals in progress" } as const;
</script>

<!-- Background agents: one compact card each, in a min-220px grid; the detail lives in the side panel. -->
<section class="agents" aria-label="Sub-agents" data-testid="sub-agent-cards">
  <p class="rollup"><Icon name="agents" size="sm" />{rollup.label}</p>
  <ul class="grid">
    {#each cards as { agent, card } (agent.key)}
      {@const status = statusOfSubAgent(card.state)}
      <li>
        <button
          type="button"
          class="card"
          data-state={card.state}
          aria-haspopup="dialog"
          aria-pressed={openKey === agent.key}
          aria-label={`Open sub-agent ${card.title} (${status.label})`}
          onclick={() => (openKey = agent.key)}
        >
          <span class="top">
            <Status tone={status.tone} label={status.label} dotOnly />
            <span class="name" title={card.title}>{card.title}</span>
            {#if card.goals !== "none"}
              <span class="goal" data-goal={card.goals} role="img" title={GOAL_TITLE[card.goals]} aria-label={GOAL_TITLE[card.goals]}><Icon name={GOAL_ICON[card.goals]} size="sm" /></span>
            {/if}
            <span class="st"><Badge tone={BADGE[card.state]}>{BADGE_TEXT[card.state]}</Badge></span>
          </span>
          <span class="activity" title={card.activity}>{card.activity}</span>
          <span class="meta">{card.meta}{#if card.failedCalls > 0}<span class="failed">{` · ${card.failedCalls} failed`}</span>{/if}</span>
        </button>
      </li>
    {/each}
  </ul>
</section>

{#if opened}
  <ChatSubAgentDrawer agent={opened.agent} card={opened.card} onClose={() => (openKey = null)} />
{/if}

<style>
  .agents { display: grid; gap: 8px; min-width: 0; }
  .rollup { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .grid {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }
  .card {
    display: grid;
    gap: 4px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    color: var(--cortex-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .card:hover { border-color: var(--cortex-line-strong); }
  .card[aria-pressed="true"] { border-color: var(--cortex-line-strong); background: var(--cortex-surface-2); }
  .top { display: flex; align-items: center; gap: 6px; min-width: 0; }
  /* A guaranteed name width: status and badges never squeeze the name to "s" (spec 3.4). */
  .name {
    flex: 1 1 auto;
    min-width: 6ch;
    font-size: var(--cortex-t-sm);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .goal { display: inline-flex; flex: none; color: var(--cortex-text-3); }
  .goal[data-goal="met"] { color: var(--cortex-ok); }
  .goal[data-goal="unmet"] { color: var(--cortex-bad); }
  .st { margin-left: auto; flex: none; }
  .activity { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta {
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--cortex-text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .failed { color: var(--cortex-bad); }
</style>
