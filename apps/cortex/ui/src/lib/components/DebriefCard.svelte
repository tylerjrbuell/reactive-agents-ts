<script lang="ts">
  interface Props {
    debrief: unknown;
  }
  let { debrief }: Props = $props();

  type DebriefView = {
    outcome?: string;
    summary?: string;
    keyFindings?: string[];
    lessonsLearned?: string[];
    markdown?: string;
    metrics?: { iterations?: number; tokens?: number; duration?: number; cost?: number };
    toolsUsed?: ReadonlyArray<{ calls?: number }>;
  };

  const d = $derived((debrief && typeof debrief === "object" ? debrief : null) as DebriefView | null);

  let copied = $state(false);

  async function copyMarkdown() {
    const md = d?.markdown;
    if (typeof md !== "string" || !md) return;
    await navigator.clipboard.writeText(md);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  const successOutcome = $derived(d?.outcome === "success" || d?.outcome === "partial");
  const toolCallSum = $derived(
    (d?.toolsUsed ?? []).reduce((s, t) => s + (typeof t.calls === "number" ? t.calls : 0), 0),
  );
</script>

{#if d}
  <div class="gradient-border rounded-lg p-6 animate-fade-up">
    <div class="flex items-center justify-between mb-5 flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined text-primary">summarize</span>
        <h3 class="font-headline text-sm font-bold uppercase tracking-wide">Run Debrief</h3>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <span
          class="px-2 py-0.5 rounded text-[10px] font-mono border {successOutcome
            ? 'text-secondary border-secondary/30 bg-secondary/10'
            : 'text-error border-error/30 bg-error/10'}"
        >
          {successOutcome ? "✓ SUCCESS" : "✗ FAILED"}
        </span>
        {#if typeof d.markdown === "string" && d.markdown}
          <button
            type="button"
            class="text-[10px] font-mono text-primary/60 hover:text-primary transition-colors flex items-center gap-1 bg-transparent border-0 cursor-pointer"
            onclick={copyMarkdown}
          >
            <span class="material-symbols-outlined text-sm">{copied ? "check" : "content_copy"}</span>
            {copied ? "Copied!" : "Copy Markdown"}
          </button>
        {/if}
      </div>
    </div>

    {#if d.summary}
      <p class="font-mono text-xs text-on-surface/70 leading-relaxed mb-5 pl-4 border-l-2 border-primary/30">
        {d.summary}
      </p>
    {/if}

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
      {#if (d.keyFindings?.length ?? 0) > 0}
        <div>
          <span class="text-[9px] font-mono text-primary uppercase tracking-widest block mb-2">Key Findings</span>
          <ul class="space-y-1">
            {#each (d.keyFindings ?? []).slice(0, 4) as finding}
              <li class="text-[11px] font-mono text-on-surface/60 flex gap-2">
                <span class="text-primary/50 flex-shrink-0">•</span>
                {finding}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if (d.lessonsLearned?.length ?? 0) > 0}
        <div>
          <span class="text-[9px] font-mono text-secondary uppercase tracking-widest block mb-2"
            >Lessons Learned</span
          >
          <ul class="space-y-1">
            {#each (d.lessonsLearned ?? []).slice(0, 4) as lesson}
              <li class="text-[11px] font-mono text-on-surface/60 flex gap-2">
                <span class="text-secondary/50 flex-shrink-0">•</span>
                {lesson}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    {#if d.metrics}
      <div class="flex flex-wrap gap-4 font-mono text-[10px] pt-4 border-t border-white/5">
        <span class="text-outline">METRICS:</span>
        <span>{d.metrics.iterations ?? 0} iter</span>
        <span>·</span>
        <span>{(d.metrics.tokens ?? 0).toLocaleString()} tok</span>
        <span>·</span>
        <span>${(d.metrics.cost ?? 0).toFixed(4)}</span>
        <span>·</span>
        <span>{((d.metrics.duration ?? 0) / 1000).toFixed(1)}s</span>
        {#if toolCallSum > 0}
          <span>·</span>
          <span>{toolCallSum} tool calls</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}
