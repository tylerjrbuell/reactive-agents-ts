<script lang="ts">
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
</script>

<svelte:head>
  <title>CORTEX — Run</title>
</svelte:head>

<CortexDeskShell>
  <div class="relative z-10 flex h-full flex-col items-center justify-center p-8 text-center">
    <div
      class="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/25 bg-violet-100/90 shadow-[0_0_24px_rgba(124,58,237,0.12)] dark:bg-violet-950/30 dark:shadow-[0_0_28px_rgba(139,92,246,0.2)]"
    >
      <span class="material-symbols-outlined text-3xl text-violet-700 dark:text-primary">alt_route</span>
    </div>
    <h1 class="font-display mb-2 text-2xl font-semibold tracking-tight text-on-surface">Run</h1>
    <p class="max-w-md font-mono text-xs uppercase tracking-widest text-outline">
      Open a run from Beacon or Trace, or use
      <code class="rounded bg-cyan-100/90 px-1.5 py-0.5 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200"
        >/run/[runId]</code
      >.
    </p>
    <a
      href="/runs"
      class="mt-8 font-mono text-[11px] text-cyan-700 no-underline transition-colors hover:text-primary dark:text-secondary"
    >
      → Execution Trace
    </a>
  </div>
</CortexDeskShell>
