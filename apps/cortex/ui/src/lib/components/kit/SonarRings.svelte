<script lang="ts">
  /**
   * Ambient sonar rings around the Beacon first-run hero mark: three staggered
   * rings pulse outward, calm and faint while idle. This is the one ambient use
   * of the sonar; everywhere else a sonar ring means "running now". `live`
   * (a run is launching) makes them faster and brighter so activity still reads
   * differently from idle. Pure CSS transform and opacity, no JS. Reduced motion
   * (OS setting or `html[data-motion="reduce"]`) draws them still at fixed radii.
   * Decorative: `aria-hidden`, never intercepts pointer events.
   */
  import type { Snippet } from "svelte";

  interface Props {
    /** Mark size in px; rings start at the mark's edge. */
    size: number;
    /** A run is launching: faster, brighter rings. */
    live?: boolean;
    children: Snippet;
  }

  let { size, live = false, children }: Props = $props();
</script>

<span class="cx-sonar" class:cx-sonar-live={live} style="--cx-sonar-d:{Math.round(size * 0.9)}px">
  <span class="cx-sonar-rings" aria-hidden="true">
    <span class="cx-sonar-ring"></span>
    <span class="cx-sonar-ring"></span>
    <span class="cx-sonar-ring"></span>
  </span>
  {@render children()}
</span>

<style>
  .cx-sonar {
    position: relative;
    display: inline-grid;
    place-items: center;
    --cx-sonar-peak: 0.4;
    --cx-sonar-dur: 4.5s;
  }
  .cx-sonar-live {
    --cx-sonar-peak: 0.5;
    --cx-sonar-dur: 1.9s;
  }
  .cx-sonar-rings {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .cx-sonar-ring {
    grid-area: 1 / 1;
    width: var(--cx-sonar-d);
    height: var(--cx-sonar-d);
    border: 1.5px solid var(--cortex-mk-violet);
    border-radius: 50%;
    opacity: 0;
    animation: cx-sonar-pulse var(--cx-sonar-dur) cubic-bezier(0, 0.2, 0.8, 1) infinite;
    will-change: transform, opacity;
  }
  .cx-sonar-ring:nth-child(2) {
    animation-delay: calc(var(--cx-sonar-dur) / -3);
  }
  .cx-sonar-ring:nth-child(3) {
    animation-delay: calc(var(--cx-sonar-dur) / -1.5);
  }
  @keyframes cx-sonar-pulse {
    0% {
      transform: scale(0.8);
      opacity: var(--cx-sonar-peak);
    }
    100% {
      transform: scale(2.6);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cx-sonar-ring {
      animation: none;
      will-change: auto;
    }
    .cx-sonar-ring:nth-child(1) { transform: scale(1.1); opacity: 0.36; }
    .cx-sonar-ring:nth-child(2) { transform: scale(1.7); opacity: 0.22; }
    .cx-sonar-ring:nth-child(3) { transform: scale(2.3); opacity: 0.11; }
  }
  :global(html[data-motion="reduce"]) .cx-sonar-ring {
    animation: none;
    will-change: auto;
  }
  :global(html[data-motion="reduce"]) .cx-sonar-ring:nth-child(1) { transform: scale(1.1); opacity: 0.36; }
  :global(html[data-motion="reduce"]) .cx-sonar-ring:nth-child(2) { transform: scale(1.7); opacity: 0.22; }
  :global(html[data-motion="reduce"]) .cx-sonar-ring:nth-child(3) { transform: scale(2.3); opacity: 0.11; }
</style>
