<script lang="ts">
  interface Props {
    debrief: unknown;
    status?: string;
  }
  let { debrief, status = "" }: Props = $props();

  type DebriefView = {
    outcome?: string;
    summary?: string;
    keyFindings?: string[];
    lessonsLearned?: string[];
    errors?: string[];
    markdown?: string;
    metrics?: { iterations?: number; tokens?: number; duration?: number; cost?: number };
    toolsUsed?: ReadonlyArray<{ name?: string; calls?: number; errors?: number; avgDurationMs?: number }>;
  };

  const d = $derived(
    (debrief && typeof debrief === "object" ? debrief : null) as DebriefView | null,
  );
  const isFailed = $derived(status === "failed" || d?.outcome === "failure" || d?.outcome === "failed");

  let copied = $state(false);
  let view = $state<"rendered" | "raw">("rendered");

  async function copyMarkdown() {
    const md = d?.markdown;
    if (typeof md !== "string" || !md) return;
    await navigator.clipboard.writeText(md);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="h-full flex flex-col overflow-hidden">
  {#if !d}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <span class="material-symbols-outlined text-2xl text-outline/20 block mb-2">summarize</span>
        <p class="font-mono text-[10px] text-outline/30">
          {status === "live" ? "Debrief generated on completion…" : "No debrief available for this run."}
        </p>
      </div>
    </div>
  {:else}
    <!-- Toolbar -->
    <div class="flex flex-shrink-0 items-center gap-3 border-b border-[var(--cortex-border)] px-4 py-2">
      <!-- Outcome badge -->
      <span
        class="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wide
               {isFailed ? 'text-error' : 'text-emerald-800 dark:text-emerald-400'}"
      >
        <span
          class="material-symbols-outlined text-sm"
          style="font-variation-settings: 'FILL' 1;"
        >
          {isFailed ? "error" : "task_alt"}
        </span>
        {isFailed ? "Failed" : "Success"}
      </span>

      <div class="h-3 w-px bg-outline-variant/40 dark:bg-outline-variant/30"></div>

      <!-- View toggle -->
      <div class="flex gap-1">
        {#each [["rendered", "View"], ["raw", "Markdown"]] as [v, label]}
          <button
            type="button"
            class="px-2.5 py-0.5 text-[9px] font-mono rounded border transition-colors cursor-pointer
                   {view === v
                     ? 'bg-primary/10 border-primary/30 text-primary'
                     : 'bg-transparent border-outline-variant/15 text-outline/50 hover:text-outline'}"
            onclick={() => (view = v as "rendered" | "raw")}
          >
            {label}
          </button>
        {/each}
      </div>

      <div class="flex-1"></div>

      <!-- Metrics inline -->
      {#if d.metrics}
        <div class="hidden sm:flex items-center gap-3 font-mono text-[9px] text-outline/40">
          {#if d.metrics.iterations}<span>{d.metrics.iterations} iter</span>{/if}
          {#if d.metrics.tokens}<span>·</span><span>{(d.metrics.tokens).toLocaleString()} tok</span>{/if}
          {#if d.metrics.cost}<span>·</span><span>${d.metrics.cost.toFixed(4)}</span>{/if}
          {#if d.metrics.duration}<span>·</span><span>{(d.metrics.duration / 1000).toFixed(1)}s</span>{/if}
        </div>
      {/if}

      <!-- Copy button -->
      {#if typeof d.markdown === "string" && d.markdown}
        <button
          type="button"
          onclick={copyMarkdown}
          class="flex items-center gap-1.5 px-3 py-1 border border-primary/20 text-primary/70
                 font-mono text-[9px] uppercase rounded hover:bg-primary/10 hover:text-primary
                 transition-colors bg-transparent cursor-pointer"
        >
          <span class="material-symbols-outlined text-[12px]">{copied ? "check" : "content_copy"}</span>
          {copied ? "Copied!" : "Copy MD"}
        </button>
      {/if}
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto min-h-0">
      {#if view === "raw"}
        <!-- Raw markdown -->
        <div class="p-4">
          <pre class="font-mono text-[10px] text-on-surface/70 leading-relaxed whitespace-pre-wrap break-words">{d.markdown ?? "(no markdown)"}</pre>
        </div>
      {:else}
        <!-- Rendered view -->
        <div class="p-4 space-y-4">
          <!-- Summary -->
          {#if d.summary}
            <div>
              <div class="text-[9px] font-mono text-outline/60 uppercase tracking-widest mb-1.5">Summary</div>
              <p class="font-mono text-[11px] text-on-surface/80 leading-relaxed pl-3 border-l-2 border-primary/30">
                {d.summary}
              </p>
            </div>
          {/if}

          <!-- 2-column: findings + lessons -->
          {#if (d.keyFindings?.length ?? 0) > 0 || (d.lessonsLearned?.length ?? 0) > 0}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {#if (d.keyFindings?.length ?? 0) > 0}
                <div>
                  <div class="text-[9px] font-mono text-primary/70 uppercase tracking-widest mb-2">Key Findings</div>
                  <ul class="space-y-1.5">
                    {#each d.keyFindings ?? [] as finding}
                      <li class="flex gap-2 text-[10px] font-mono text-on-surface/65">
                        <span class="text-primary/40 flex-shrink-0 mt-px">•</span>
                        <span>{finding}</span>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if (d.lessonsLearned?.length ?? 0) > 0}
                <div>
                  <div class="text-[9px] font-mono text-secondary/70 uppercase tracking-widest mb-2">Lessons Learned</div>
                  <ul class="space-y-1.5">
                    {#each d.lessonsLearned ?? [] as lesson}
                      <li class="flex gap-2 text-[10px] font-mono text-on-surface/65">
                        <span class="text-secondary/40 flex-shrink-0 mt-px">•</span>
                        <span>{lesson}</span>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Errors -->
          {#if (d.errors?.length ?? 0) > 0}
            <div>
              <div class="text-[9px] font-mono text-error/70 uppercase tracking-widest mb-2">Errors</div>
              <ul class="space-y-1">
                {#each d.errors ?? [] as err}
                  <li class="font-mono text-[10px] text-error/70 bg-error/5 rounded px-2 py-1 border border-error/15">
                    {err}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          <!-- Tools used -->
          {#if (d.toolsUsed?.length ?? 0) > 0}
            <div>
              <div class="text-[9px] font-mono text-outline/60 uppercase tracking-widest mb-2">Tools Used</div>
              <div class="flex flex-wrap gap-2">
                {#each d.toolsUsed ?? [] as tool}
                  <div class="flex items-center gap-1.5 px-2 py-1 bg-surface-container-low border border-outline-variant/10 rounded text-[9px] font-mono">
                    <span class="text-secondary/70">{tool.name ?? "?"}</span>
                    <span class="text-outline/40">×{tool.calls ?? 1}</span>
                    {#if tool.errors && tool.errors > 0}
                      <span class="text-error/60">{tool.errors} err</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Metrics footer -->
          {#if d.metrics}
            <div class="flex flex-wrap gap-4 border-t border-[var(--cortex-border)] pt-3 font-mono text-[9px] text-outline/40">
              <span class="text-outline/50 uppercase tracking-widest">Metrics</span>
              {#if d.metrics.iterations}<span>{d.metrics.iterations} iterations</span>{/if}
              {#if d.metrics.tokens}<span>·</span><span>{(d.metrics.tokens).toLocaleString()} tokens</span>{/if}
              {#if d.metrics.cost}<span>·</span><span>${d.metrics.cost.toFixed(5)}</span>{/if}
              {#if d.metrics.duration}<span>·</span><span>{(d.metrics.duration / 1000).toFixed(2)}s</span>{/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
