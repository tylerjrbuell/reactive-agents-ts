<script lang="ts">
  import { onMount } from "svelte";
  import { subAgentView, type ChatSubAgent } from "$lib/sub-agent-view.js";
  import ChatTurnTimeline from "$lib/components/ChatTurnTimeline.svelte";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";

  interface Props {
    agent: ChatSubAgent;
    compact?: boolean;
  }
  const { agent, compact = false }: Props = $props();

  // Open state is the viewer's choice; absent ⇒ collapsed (the row is the summary).
  let open = $state(false);
  let now = $state(Date.now());

  const view = $derived(subAgentView(agent, now));
  const running = $derived(agent.status === "running");
  const panelId = $derived(`sub-agent-${agent.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`);

  // Tick only while the child runs, so a finished block costs nothing.
  onMount(() => {
    const id = setInterval(() => {
      if (agent.status === "running") now = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });
</script>

<!-- A sub-agent reads as a child of the turn: the rail on the left carries its
     status colour, the row carries its identity and cost, the preview shows what
     it is doing right now. Expanding reuses the turn transcript components. -->
<section class="sub-agent" data-status={agent.status} aria-label={`Sub-agent ${view.title}`}>
  <button
    type="button"
    class="sub-agent-row"
    aria-expanded={open}
    aria-controls={panelId}
    onclick={() => (open = !open)}
  >
    <span class="material-symbols-outlined chevron" class:open aria-hidden="true">chevron_right</span>
    <span class="dot" class:running aria-label={agent.status}></span>
    <span class="name">{view.title}</span>
    <span class="summary">{view.summary}</span>
    <!-- Link slot: run trace (plan 2 Task 7) lands here via agent.traceHref. -->
  </button>

  {#if !open && view.previewLines.length > 0}
    <ol class="preview" aria-live="off">
      {#each view.previewLines as line, i (i)}
        <li class:latest={running && i === view.previewLines.length - 1}>{line}</li>
      {/each}
    </ol>
  {/if}

  {#if open}
    <div id={panelId} class="sub-agent-body">
      <ChatTurnTimeline turn={agent.turn} {compact} />
      {#if agent.turn.streaming && agent.turn.liveText}
        <p class="live">{agent.turn.liveText}</p>
      {/if}
      {#if agent.output}
        <GuardedMarkdown markdown={agent.output} class="text-[11px]" />
      {:else if running}
        <p class="live">working…</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .sub-agent {
    --rail: var(--cortex-border);
    border-left: 2px solid var(--rail);
    padding-left: 0.625rem;
  }
  .sub-agent[data-status="running"] { --rail: var(--color-secondary, #7ee3c3); }
  .sub-agent[data-status="failed"] { --rail: var(--color-error, #ff6b6b); }

  .sub-agent-row {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.375rem;
    padding: 0.125rem 0;
    cursor: pointer;
    text-align: left;
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: var(--cortex-text);
    background: none;
    border: 0;
  }
  .sub-agent-row:focus-visible {
    outline: 2px solid var(--rail);
    outline-offset: 2px;
    border-radius: 3px;
  }
  .chevron {
    font-size: 12px;
    line-height: 1;
    color: var(--cortex-text-muted);
    transition: transform 150ms;
  }
  .chevron.open { transform: rotate(90deg); }
  .dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 9999px;
    background: var(--rail);
  }
  .name { font-weight: 600; }
  .summary {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--cortex-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .preview {
    margin: 0.125rem 0 0.25rem 1.1rem;
    padding: 0;
    list-style: none;
    font-family: ui-monospace, monospace;
    font-size: 9.5px;
    line-height: 1.5;
    color: var(--cortex-text-muted);
  }
  .preview li {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.65;
  }
  .preview li.latest { opacity: 1; color: var(--cortex-text); }

  .sub-agent-body {
    margin: 0.25rem 0 0.25rem 0.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .live {
    margin: 0;
    font-size: 11px;
    font-style: italic;
    white-space: pre-wrap;
    color: var(--cortex-text-muted);
  }

  /* Running pulse is the only motion here; it is attention, not decoration. */
  @media (prefers-reduced-motion: no-preference) {
    .dot.running { animation: sub-agent-pulse 1.4s ease-in-out infinite; }
    .preview li.latest { animation: sub-agent-in 160ms ease-out; }
  }
  @keyframes sub-agent-pulse { 50% { opacity: 0.35; } }
  @keyframes sub-agent-in { from { opacity: 0; transform: translateY(2px); } }
  @media (prefers-reduced-motion: reduce) {
    .chevron { transition: none; }
  }
</style>
