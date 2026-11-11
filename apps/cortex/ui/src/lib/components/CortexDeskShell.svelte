<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Full-height route shell. Wrap every full-height page in it.
   *
   * `ambient` turns on Cortex's ambient layer: two soft radial fields (violet,
   * cyan) that drift over 48s and 64s and hold still under reduced motion.
   * Bench spec section 5.2 fixes where it may appear: Beacon (`ambient`), and
   * page-level empty states (`ambient={isEmpty}` on Chat and Runs). Never
   * behind a transcript, table, form, trace or inspector, so it is off by default.
   */
  interface Props {
    children: Snippet;
    /** Show the ambient orbs (Beacon and page-level empty states only). */
    ambient?: boolean;
    /** Extra classes on the outer shell (e.g. flex direction tweaks). */
    class?: string;
  }

  let { children, ambient = false, class: className = "" }: Props = $props();
</script>

<div class="relative h-full min-h-0 flex flex-col overflow-hidden {className}">
  {#if ambient}
    <div class="cx-ambient" aria-hidden="true" data-testid="cortex-ambient"></div>
  {/if}
  {@render children()}
</div>

<style>
  /* Radial gradients, not blur filters (cheap to paint). Strength comes from
     the --cortex-orb-* tokens (violet 8% / cyan 6% dark, 6% / 4.5% light). */
  .cx-ambient {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .cx-ambient::before,
  .cx-ambient::after {
    content: "";
    position: absolute;
    border-radius: 50%;
  }
  .cx-ambient::before {
    width: min(820px, 70vw);
    aspect-ratio: 1;
    left: 8%;
    top: -14%;
    background: radial-gradient(closest-side, var(--cortex-orb-violet), transparent);
    animation: cx-orb-a 48s ease-in-out infinite alternate;
  }
  .cx-ambient::after {
    width: min(620px, 55vw);
    aspect-ratio: 1;
    right: -6%;
    bottom: -18%;
    background: radial-gradient(closest-side, var(--cortex-orb-cyan), transparent);
    animation: cx-orb-b 64s ease-in-out infinite alternate;
  }
  @keyframes cx-orb-a {
    to {
      transform: translate3d(6%, 4%, 0) scale(1.06);
    }
  }
  @keyframes cx-orb-b {
    to {
      transform: translate3d(-5%, -3%, 0) scale(1.04);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cx-ambient::before,
    .cx-ambient::after {
      animation: none;
    }
  }
  :global(html[data-motion="reduce"]) .cx-ambient::before,
  :global(html[data-motion="reduce"]) .cx-ambient::after {
    animation: none;
  }
</style>
