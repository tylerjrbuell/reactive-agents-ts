<script lang="ts">
  /**
   * Run output: compact by default for long answers (preview + expand); short answers stay open.
   * Live stream is capped-height scroll. Failures stay a small panel.
   */
  import type { RunStatus } from "$lib/stores/run-store.js";
  import MarkdownRich from "$lib/components/MarkdownRich.svelte";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import {
    plainPreviewFromMarkdown,
    preferExpandedDeliverable,
  } from "$lib/markdown/plain-preview.js";

  interface Props {
    status: RunStatus;
    deliverableText: string;
    streamText: string;
    failureMessage: string;
    meta?: { model?: string; tokensUsed?: number; estimatedCost?: number; durationMs?: number };
  }
  let {
    status,
    deliverableText,
    streamText,
    failureMessage,
    meta,
  }: Props = $props();

  const showLiveStream = $derived(status === "live" && streamText.length > 0);
  const showDeliverable = $derived(
    deliverableText.trim().length > 0 &&
      (status === "completed" || status === "failed" || status === "paused"),
  );
  const showFailureOnly = $derived(
    status === "failed" && !deliverableText.trim() && failureMessage.length > 0,
  );
  const showSection = $derived(showLiveStream || showDeliverable || showFailureOnly);

  let deliverableExpanded = $state(true);
  let seededDeliverableUi = $state(false);

  $effect(() => {
    if (!showDeliverable) {
      seededDeliverableUi = false;
      return;
    }
    if (seededDeliverableUi) return;
    const t = deliverableText.trim();
    if (t.length === 0) return;
    deliverableExpanded = preferExpandedDeliverable(deliverableText);
    seededDeliverableUi = true;
  });

  const previewText = $derived(plainPreviewFromMarkdown(deliverableText, 200));

  async function copyDeliverable() {
    try {
      await navigator.clipboard.writeText(deliverableText);
      toast.success("Copied", "Final answer copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }
</script>

{#if showSection}
  <section
    class="flex-shrink-0 mx-3 mt-2 sm:mt-3 pt-2 sm:pt-2.5 mb-1 rounded-xl border overflow-hidden
           {showFailureOnly && !showDeliverable
      ? 'bg-error/6 border-error/25'
      : 'bg-gradient-to-b from-secondary/8 to-surface-container-low/40 border-secondary/25'}"
    aria-label="Run result"
  >
    <div
      class="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 border-b border-white/5 min-h-[2.25rem]"
    >
      <span
        class="material-symbols-outlined text-base flex-shrink-0
               {showFailureOnly && !showDeliverable ? 'text-error' : 'text-secondary'}"
        style="font-variation-settings: 'FILL' 1;"
      >
        {showFailureOnly && !showDeliverable ? "gavel" : "rocket_launch"}
      </span>
      <div class="min-w-0 flex-1">
        <h2
          class="font-mono text-[10px] uppercase tracking-[0.18em] font-bold m-0 leading-tight
                 {showFailureOnly && !showDeliverable ? 'text-error' : 'text-secondary'}"
        >
          {showLiveStream && !showDeliverable
            ? "Output (streaming)"
            : showFailureOnly && !showDeliverable
              ? "Run did not produce a final answer"
              : "Final result"}
        </h2>
        {#if meta?.model && (showDeliverable || showFailureOnly)}
          <p class="font-mono text-[9px] text-outline/45 m-0 mt-0.5 truncate">{meta.model}</p>
        {/if}
      </div>
      {#if showDeliverable && meta && (meta.tokensUsed ?? 0) > 0}
        <Tooltip text="Token usage attributed to final answer when reported">
          <span class="font-mono text-[9px] text-outline/40 tabular-nums flex-shrink-0 hidden sm:inline">
            {meta.tokensUsed!.toLocaleString()} tok
          </span>
        </Tooltip>
      {/if}
      {#if showDeliverable}
        <Tooltip text="Copy final answer (markdown / LaTeX source)">
          <button
            type="button"
            onclick={() => void copyDeliverable()}
            aria-label="Copy final answer"
            class="flex-shrink-0 p-1 rounded border border-outline-variant/20 text-outline hover:text-primary
                   hover:border-primary/30 bg-transparent cursor-pointer transition-colors"
          >
            <span class="material-symbols-outlined text-[18px] leading-none">content_copy</span>
          </button>
        </Tooltip>
        <Tooltip text={deliverableExpanded ? "Collapse" : "Expand full answer"}>
          <button
            type="button"
            onclick={() => (deliverableExpanded = !deliverableExpanded)}
            aria-expanded={deliverableExpanded}
            aria-label={deliverableExpanded ? "Collapse final answer" : "Expand final answer"}
            class="flex-shrink-0 p-1 rounded border border-outline-variant/20 text-outline hover:text-secondary
                   hover:border-secondary/35 bg-transparent cursor-pointer transition-colors"
          >
            <span
              class="material-symbols-outlined text-[20px] leading-none transition-transform duration-200
                     {deliverableExpanded ? 'rotate-180' : ''}"
            >expand_more</span>
          </button>
        </Tooltip>
      {/if}
    </div>

    {#if showDeliverable}
      {#if deliverableExpanded}
        <div
          class="px-3 py-2 sm:px-4 max-h-[min(32vh,17rem)] overflow-y-auto min-h-0 border-t border-white/5"
        >
          <MarkdownRich markdown={deliverableText} showCopy={false} />
          {#if meta && ((meta.estimatedCost ?? 0) > 0 || (meta.durationMs ?? 0) > 0)}
            <div
              class="flex flex-wrap gap-3 mt-2 pt-2 border-t border-white/5 font-mono text-[9px] text-outline/45"
            >
              {#if (meta.estimatedCost ?? 0) > 0}
                <span>${meta.estimatedCost!.toFixed(4)}</span>
              {/if}
              {#if (meta.durationMs ?? 0) > 0}
                <span
                  >{meta.durationMs! >= 1000
                    ? `${(meta.durationMs! / 1000).toFixed(1)}s`
                    : `${meta.durationMs}ms`}</span
                >
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <button
          type="button"
          class="w-full text-left px-3 py-2 sm:px-4 border-t border-white/5 cursor-pointer
                 bg-transparent hover:bg-white/[0.03] transition-colors group"
          onclick={() => (deliverableExpanded = true)}
          aria-label="Expand full final answer"
        >
          <p
            class="text-[11px] text-on-surface/65 leading-snug m-0 pr-6 line-clamp-2 group-hover:text-on-surface/80"
          >
            {previewText}
          </p>
          <span
            class="font-mono text-[9px] text-secondary/70 uppercase tracking-wider mt-1 inline-block"
          >
            Show full answer
          </span>
        </button>
      {/if}
    {:else if showLiveStream}
      <div class="px-3 py-2 sm:px-4 max-h-32 overflow-y-auto border-t border-white/5">
        <div class="flex items-center gap-2 mb-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0"></span>
          <span class="text-[9px] font-mono text-primary/70 uppercase tracking-widest">Live</span>
        </div>
        <p
          class="font-mono text-[10px] text-on-surface/75 leading-relaxed whitespace-pre-wrap break-words m-0"
        >
          {streamText}<span
            class="inline-block w-2 h-3 bg-primary/50 ml-0.5 animate-pulse align-text-bottom"
          ></span>
        </p>
      </div>
    {:else if showFailureOnly}
      <div class="px-3 py-2 sm:px-4 border-t border-white/5">
        <p class="font-mono text-[11px] text-error/80 leading-relaxed whitespace-pre-wrap break-words m-0">
          {failureMessage}
        </p>
      </div>
    {/if}
  </section>
{/if}
