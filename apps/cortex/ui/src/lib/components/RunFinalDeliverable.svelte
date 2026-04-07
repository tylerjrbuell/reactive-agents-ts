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

  /** Toggle expand/collapse from the shell; ignore links/buttons and the scrollable answer body when expanded. */
  function onDeliverableShellClick(e: MouseEvent) {
    if (!showDeliverable) return;
    const el = e.target as HTMLElement | null;
    if (!el) return;
    if (el.closest("a, button, input, textarea, select, [data-no-deliverable-toggle]")) return;
    if (deliverableExpanded && el.closest("[data-deliverable-scroll]")) return;
    deliverableExpanded = !deliverableExpanded;
  }

  function onDeliverableSectionKeydown(e: KeyboardEvent) {
    if (!showDeliverable) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    if ((e.target as HTMLElement).closest("a, button, input, textarea, select")) return;
    e.preventDefault();
    deliverableExpanded = !deliverableExpanded;
  }
</script>

{#if showSection}
  <!-- Composite control: whole card toggles deliverable; copy is a separate button; markdown body ignores toggles when expanded. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    class="flex-shrink-0 mx-3 sm:mx-4 mt-2 sm:mt-3 mb-1 rounded-xl border overflow-hidden
           {showDeliverable ? 'cursor-pointer' : ''}
           {showFailureOnly && !showDeliverable
      ? 'border-error/30 bg-error/8 backdrop-blur-[4px]'
      : 'border-outline-variant/15 bg-surface-container-low/30 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(0,0,0,0.05)] dark:bg-surface-container-low/22 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'}"
    aria-label={showDeliverable ? "Final result — click to expand or collapse" : "Run result"}
    tabindex={showDeliverable ? 0 : undefined}
    onclick={onDeliverableShellClick}
    onkeydown={onDeliverableSectionKeydown}
  >
    <div
      class="flex min-h-[2.25rem] items-center gap-2 border-b border-[var(--cortex-border)] px-3 py-1.5 sm:px-4 sm:py-2"
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
          class="font-display text-[11px] uppercase tracking-[0.12em] font-semibold m-0 leading-tight
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
            data-no-deliverable-toggle
            onclick={(e) => {
              e.stopPropagation();
              void copyDeliverable();
            }}
            aria-label="Copy final answer"
            class="flex-shrink-0 p-1 rounded border border-outline-variant/20 text-outline hover:text-primary
                   hover:border-primary/30 bg-transparent cursor-pointer transition-colors"
          >
            <span class="material-symbols-outlined text-[18px] leading-none">content_copy</span>
          </button>
        </Tooltip>
        <span
          class="material-symbols-outlined text-[20px] leading-none flex-shrink-0 text-outline/50 pointer-events-none transition-transform duration-200
                 {deliverableExpanded ? 'rotate-180' : ''}"
          aria-hidden="true"
        >expand_more</span>
      {/if}
    </div>

    {#if showDeliverable}
      {#if deliverableExpanded}
        <div
          data-deliverable-scroll
          class="deliverable-scroll max-h-[min(32vh,17rem)] min-h-0 cursor-auto overflow-y-auto border-t border-[var(--cortex-border)] px-3 py-2 sm:px-4"
        >
          <MarkdownRich markdown={deliverableText} showCopy={false} />
          {#if meta && ((meta.estimatedCost ?? 0) > 0 || (meta.durationMs ?? 0) > 0)}
            <div
              class="mt-2 flex flex-wrap gap-3 border-t border-[var(--cortex-border)] pt-2 font-mono text-[9px] text-outline/45"
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
        <div
          class="group w-full border-t border-[var(--cortex-border)] px-3 py-2 text-left transition-colors hover:bg-primary/[0.05] dark:hover:bg-white/[0.04] sm:px-4"
        >
          <p
            class="text-[11px] text-on-surface/65 leading-snug m-0 pr-6 line-clamp-2 group-hover:text-on-surface/80"
          >
            {previewText}
          </p>
          <span
            class="font-mono text-[9px] text-secondary/70 uppercase tracking-wider mt-1 inline-block"
          >
            Click to expand full answer
          </span>
        </div>
      {/if}
    {:else if showLiveStream}
      <div class="max-h-32 overflow-y-auto border-t border-[var(--cortex-border)] px-3 py-2 sm:px-4">
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
      <div class="border-t border-[var(--cortex-border)] px-3 py-2 sm:px-4">
        <p class="font-mono text-[11px] text-error/80 leading-relaxed whitespace-pre-wrap break-words m-0">
          {failureMessage}
        </p>
      </div>
    {/if}
  </section>
{/if}
