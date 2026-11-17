<script lang="ts">
  /**
   * "Checking…" while a background status check of a server runs: a small neutral ring and the word.
   * Never the running tone (that means a run is live here): a plain text-3 ring that turns, and holds
   * still under reduced motion (the word carries the state).
   */
</script>

<span class="ck" role="status" data-testid="server-checking"><span class="ck-ring" aria-hidden="true"></span>Checking…</span>

<style>
  .ck { display: inline-flex; align-items: center; gap: 6px; font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); white-space: nowrap; }
  .ck-ring { width: 10px; height: 10px; flex: none; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--cortex-line-strong); border-top-color: var(--cortex-text-2); animation: ck-turn 900ms linear infinite; }
  @keyframes ck-turn { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .ck-ring { animation: none; } }
  :global(html[data-motion="reduce"]) .ck-ring { animation: none; }
</style>
