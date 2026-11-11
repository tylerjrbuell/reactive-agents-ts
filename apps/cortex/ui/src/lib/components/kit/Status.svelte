<script lang="ts">
  /**
   * The one status vocabulary (spec section 1.6, ui-core `StatusTone`): a dot
   * plus a label for runs, turns, sub-agents and Beacon nodes. Map a surface's
   * own state with ui-core `statusOfRun` / `statusOfTurn` / `statusOfSubAgent`
   * and pass the result here. `running` pulses (the dot holds still under
   * reduced motion); the label always says the state, so colour is never the
   * only cue.
   * `dotOnly` hides the label visually but keeps it for screen readers.
   */
  import type { StatusTone } from "@reactive-agents/ui-core";

  interface Props {
    tone: StatusTone;
    label: string;
    dotOnly?: boolean;
    class?: string;
  }

  let { tone, label, dotOnly = false, class: className = "" }: Props = $props();
</script>

<span class="cx-status cx-tone-{tone} {className}" data-tone={tone}>
  <span class="cx-dot" aria-hidden="true"></span>
  <span class:cx-sr-only={dotOnly}>{label}</span>
</span>

<style>
  .cx-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--cortex-t-xs);
    font-weight: 500;
  }
  .cx-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--cortex-text-3); }
  .cx-tone-running { color: var(--cortex-accent); }
  .cx-tone-running .cx-dot {
    background: var(--cortex-signal);
    box-shadow: 0 0 0 3px var(--cortex-accent-tint);
    animation: cx-pulse 1.6s var(--cortex-ease-out) infinite;
  }
  .cx-tone-done { color: var(--cortex-ok); }
  .cx-tone-done .cx-dot { background: var(--cortex-ok); }
  .cx-tone-failed { color: var(--cortex-bad); }
  .cx-tone-failed .cx-dot { background: var(--cortex-bad); }
  .cx-tone-attention { color: var(--cortex-warn); }
  .cx-tone-attention .cx-dot { background: var(--cortex-warn); }
  .cx-tone-stopped,
  .cx-tone-idle { color: var(--cortex-text-2); }
  @keyframes cx-pulse { 50% { box-shadow: 0 0 0 5px transparent; } }
  @media (prefers-reduced-motion: reduce) { .cx-tone-running .cx-dot { animation: none; } }
  :global(html[data-motion="reduce"]) .cx-tone-running .cx-dot { animation: none; }
  .cx-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
