<script lang="ts">
  /**
   * The Cortex neural mark: the only logo and the only illustration (Bench
   * spec section 5). Flat, theme-aware node colours (`--cortex-mk-*`), no blur
   * filters. `hero` adds a soft halo and a slow staggered twinkle (7s) for
   * page-level empty and first-run states; reduced motion keeps it still.
   * Always `aria-hidden`: it sits next to a text label.
   */
  import { MARK_NODES, markRingPath, markSpokesPath, markStroke } from "../../neural-mark.js";

  interface Props {
    /** Rendered width and height in px (22 in the bar, 64-132 for heroes). */
    size?: number;
    hero?: boolean;
    class?: string;
  }

  let { size = 22, hero = false, class: className = "" }: Props = $props();

  const uid = $props.id();
  const stroke = $derived(markStroke(size));
  const ring = markRingPath();
  const spokes = markSpokesPath();
</script>

<svg
  class="cx-mark {className}"
  class:cx-mark-hero={hero}
  viewBox={hero ? "-8 -8 64 64" : "0 0 48 48"}
  width={size}
  height={size}
  aria-hidden="true"
  focusable="false"
>
  <defs>
    <linearGradient id="{uid}-ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:var(--cortex-mk-violet);stop-opacity:.75" />
      <stop offset="1" style="stop-color:var(--cortex-mk-cyan);stop-opacity:.35" />
    </linearGradient>
    <linearGradient id="{uid}-spoke" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--cortex-mk-cyan);stop-opacity:.6" />
      <stop offset="1" style="stop-color:var(--cortex-mk-violet);stop-opacity:.25" />
    </linearGradient>
    {#if hero}
      <radialGradient id="{uid}-halo">
        <stop offset="0" style="stop-color:var(--cortex-mk-violet);stop-opacity:.28" />
        <stop offset="1" style="stop-color:var(--cortex-mk-violet);stop-opacity:0" />
      </radialGradient>
    {/if}
  </defs>
  {#if hero}
    <circle cx="24" cy="24" r="30" fill="url(#{uid}-halo)" />
  {/if}
  <path d={ring} fill="none" stroke="url(#{uid}-ring)" stroke-width={stroke.ring} stroke-linecap="round" />
  <path d={spokes} fill="none" stroke="url(#{uid}-spoke)" stroke-width={stroke.spokes} stroke-linecap="round" />
  {#each MARK_NODES as node, i (i)}
    <circle
      class:cx-mark-tw={hero}
      cx={node.x}
      cy={node.y}
      r={node.r}
      style="fill:var(--cortex-mk-{node.tone});{hero ? `animation-delay:${-(i * 0.9).toFixed(1)}s` : ''}"
    />
  {/each}
  <circle cx="24" cy="24" r="8.5" style="fill:var(--cortex-mk-violet)" opacity=".18" />
  <circle cx="24" cy="24" r="5.2" style="fill:var(--cortex-mk-violet)" />
  <circle cx="24" cy="24" r="8" fill="none" style="stroke:var(--cortex-mk-cyan)" stroke-width=".6" opacity=".45" />
</svg>

<style>
  .cx-mark {
    display: inline-block;
    flex: none;
  }
  .cx-mark-tw {
    animation: cx-twinkle 7s ease-in-out infinite;
  }
  @keyframes cx-twinkle {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cx-mark-tw {
      animation: none;
    }
  }
  :global(html[data-motion="reduce"]) .cx-mark-tw {
    animation: none;
  }
</style>
