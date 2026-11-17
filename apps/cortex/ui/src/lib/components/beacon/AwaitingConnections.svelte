<script lang="ts">
  /**
   * The Beacon first-run status line (the original landing's "Awaiting
   * connections" with its two breathing dots). Idle and ambient: the dots fade
   * in and out, they do not glow or radiate, because that look is reserved
   * for "running now". `starting` swaps the words once a run is launching.
   * Reduced motion: still dots.
   */
  interface Props {
    /** A run is launching from the prompt bar. */
    starting?: boolean;
  }
  let { starting = false }: Props = $props();
</script>

<p class="awaiting" role="status">
  <span class="dot a" aria-hidden="true"></span>
  {starting ? "Starting your agent" : "Waiting for your first agent"}
  <span class="dot b" aria-hidden="true"></span>
</p>

<style>
  .awaiting {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-2);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    animation: awaiting-breathe 3.2s ease-in-out infinite;
  }
  .a { background: var(--cortex-mk-violet); }
  .b { background: var(--cortex-mk-cyan); animation-delay: -1.6s; }
  @keyframes awaiting-breathe {
    0%,
    100% { opacity: 0.35; }
    50% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; }
  }
  :global(html[data-motion="reduce"]) .dot { animation: none; }
</style>
