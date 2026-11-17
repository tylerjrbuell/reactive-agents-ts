<script lang="ts">
  /**
   * One node on Beacon's Field (spec 5.2, `beacon.html?view=field`): a 48px
   * tile with a status icon, and a label chip with the agent's name and a
   * sentence-case status. A running node gets the live glow and one sonar
   * ring; nothing at rest glows. Click or Enter opens the run.
   */
  import type { StatusView } from "@reactive-agents/ui-core";
  import type { AgentNode } from "$lib/stores/agent-store.js";
  import { agentRunDeskTooltipText } from "$lib/stores/agent-store.js";
  import { fieldIconOf, fieldStatusLabel } from "$lib/beacon-board.js";
  import { nudgeStep } from "$lib/beacon-drag.js";
  import { fieldNodeInfo } from "$lib/beacon-field.js";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { goto } from "$app/navigation";

  interface Props {
    agent: AgentNode;
    status: StatusView;
    /** Wall clock (ms epoch) so a live node's run time ticks. */
    now?: number;
    /** Arrow keys move the node by this step (Shift = larger); the Field wires it. */
    onnudge?: (dx: number, dy: number) => void;
  }
  let { agent, status, now = Date.now(), onnudge }: Props = $props();

  const running = $derived(status.tone === "running");
  const label = $derived(fieldStatusLabel(agent, status));
  const icon = $derived(fieldIconOf(agent, status.tone));
  const runTooltip = $derived(agentRunDeskTooltipText(agent));
  const info = $derived(fieldNodeInfo(agent, status, now));

  function open() {
    void goto(`/run/${agent.runId}`);
  }
</script>

<Tooltip text={runTooltip} placement="top" class="inline-flex flex-col items-center">
  <div
    class="node"
    data-tone={status.tone}
    role="link"
    tabindex="0"
    aria-label="{agent.name}, {label}"
    onclick={open}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
        return;
      }
      const step = nudgeStep(e.key, e.shiftKey);
      if (step && onnudge) {
        e.preventDefault();
        onnudge(step.dx, step.dy);
      }
    }}
  >
    <span class="tile" class:glow-live={running}>
      {#if running}<span class="sonar" aria-hidden="true"></span>{/if}
      <Icon name={icon} size="lg" />
    </span>
    <span class="lbl">
      <span class="nm">{agent.name}</span>
      <Status tone={status.tone} label={label} class="st" />
      {#if info.metaLine}<span class="meta">{info.metaLine}</span>{/if}
      {#if info.modelLine}<span class="meta mdl">{info.modelLine}</span>{/if}
    </span>
  </div>
</Tooltip>

<style>
  .node {
    display: grid;
    justify-items: center;
    gap: 6px;
    width: 168px;
    text-align: center;
    cursor: pointer;
    outline: none;
  }
  .node:focus-visible .tile { outline: 2px solid var(--cortex-focus); outline-offset: 3px; }
  .tile {
    position: relative;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--cortex-surface-1);
    border: 1px solid var(--cortex-line-strong);
    color: var(--cortex-text-3);
  }
  .node[data-tone="running"] .tile { color: var(--cortex-accent); }
  .node[data-tone="done"] .tile { color: var(--cortex-ok); }
  .node[data-tone="failed"] .tile { color: var(--cortex-bad); }
  .node[data-tone="attention"] .tile { color: var(--cortex-warn); }
  .lbl {
    display: grid;
    justify-items: center;
    gap: 1px;
    max-width: 168px;
    padding: 3px 8px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-1);
    border: 1px solid var(--cortex-line);
  }
  .nm {
    max-width: 150px;
    font-size: var(--cortex-t-xs);
    font-weight: 600;
    color: var(--cortex-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lbl :global(.st) { font-size: var(--cortex-t-2xs); max-width: 150px; white-space: nowrap; overflow: hidden; }
  .meta {
    max-width: 150px;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    color: var(--cortex-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta.mdl { color: var(--cortex-text-3); }
</style>
