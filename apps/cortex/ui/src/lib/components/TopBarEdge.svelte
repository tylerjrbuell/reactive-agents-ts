<script lang="ts">
  /**
   * The run indicator under the top bar. Indeterminate (never step counts): a dim
   * static track with a narrow bright highlight that travels left to right while an
   * agent or chat reply runs ("run"), slower and dimmer while a Stop / Pause waits on
   * the server ("calm"); nothing is rendered when "off". The highlight moves with
   * `transform` only. Reduced motion: no travel, a short static highlight.
   * Presentational; TopBar derives `state` with `busyBarState`.
   */
  import type { BusyBarState } from "../chat-busy-bar.js";

  interface Props {
    state: BusyBarState;
  }
  const { state }: Props = $props();
</script>

{#if state !== "off"}
  <div class="edge" data-testid="topbar-edge" data-state={state} role="progressbar" aria-label={state === "calm" ? "Winding down" : "Working"} aria-busy="true">
    <i class="hl" data-testid="topbar-edge-highlight" data-motion="travel"></i>
  </div>
{/if}

<style>
  .edge {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    overflow: hidden;
    pointer-events: none;
    background: linear-gradient(90deg, #8b5cf6, #22d3ee);
    --edge-dur: 2.7s;
    --edge-peak: 1;
  }
  /* Dim the track under a full-strength highlight: the track is a separate layer. */
  .edge::before {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--cortex-canvas);
    opacity: 0.84;
  }
  .hl {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 28%;
    background: linear-gradient(90deg, transparent, #8b5cf6 30%, #22d3ee 70%, transparent);
    opacity: var(--edge-peak);
    transform: translateX(-100%);
    will-change: transform;
    animation: edge-travel var(--edge-dur) cubic-bezier(0.37, 0, 0.63, 1) infinite;
  }
  .edge[data-state="calm"] { --edge-dur: 4.5s; --edge-peak: 0.55; }
  /* Starts fully off the left, ends fully off the right (28% wide: 100% of itself in, 357% = the bar plus itself), so the loop restarts without a pop. */
  @keyframes edge-travel {
    from { transform: translateX(-100%); }
    to { transform: translateX(357%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .hl { animation: none; transform: translateX(105%); }
  }
</style>
