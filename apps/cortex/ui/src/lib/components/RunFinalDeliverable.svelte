<script lang="ts">
  /**
   * The run's Answer panel (Bench `run.html`): the final answer as 15px prose
   * at the reading measure, with its size and Copy; a long answer opens as a
   * preview with Show all. While the run streams it shows the live tail on the
   * live rail. A failure with no answer shows the cause (when the caller has no
   * ending banner for it). Structured output renders as JSON below.
   */
  import type { RunStatus } from "$lib/stores/run-store.js";
  import RichAnswer from "$lib/components/answer/RichAnswer.svelte";
  import type { DeliverableCallLike } from "@reactive-agents/ui-core";
  import BoundedText from "$lib/components/BoundedText.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import StructuredResult from "$lib/components/StructuredResult.svelte";
  import { formatCost, formatTurnDuration, type StructuredOutputReportWire } from "@reactive-agents/ui-core";
  import { formatSize } from "$lib/text-budget.js";
  import { plainPreviewFromMarkdown, preferExpandedDeliverable } from "$lib/markdown/plain-preview.js";

  interface Props {
    status: RunStatus;
    deliverableText: string;
    streamText: string;
    failureMessage: string;
    /** The run abstained: its reason is a quiet decline, not a red failure. */
    abstained?: boolean;
    meta?: { model?: string; tokensUsed?: number; estimatedCost?: number; durationMs?: number };
    /** Typed structured output (`.withOutputSchema`), rendered as a JSON block when present. */
    structuredObject?: unknown;
    structuredError?: string | null;
    /** How the typed object was obtained (framework `StructuredOutputReport`). */
    structuredReport?: StructuredOutputReportWire | null;
    /** The output JSON Schema, for field descriptions. */
    structuredSchema?: unknown;
    /** The run's tool calls: files it wrote or edited are listed as deliverables. */
    calls?: readonly DeliverableCallLike[];
  }
  let { status, deliverableText, streamText, failureMessage, abstained = false, meta, structuredObject, structuredError, structuredReport = null, structuredSchema, calls = [] }: Props = $props();

  const showStructured = $derived(
    (structuredObject !== undefined && structuredObject !== null) || !!structuredError || structuredReport !== null,
  );
  const answer = $derived(deliverableText.trim());
  const showLiveStream = $derived(status === "live" && streamText.length > 0);
  const showDeliverable = $derived(answer.length > 0 && status !== "live" && status !== "loading");
  const showFailureOnly = $derived(status === "failed" && !answer && failureMessage.length > 0);
  const showSection = $derived(showLiveStream || showDeliverable || showFailureOnly || showStructured);

  /** A long answer opens as a preview with Show all (`preferExpandedDeliverable`). */
  const long = $derived(showDeliverable && !preferExpandedDeliverable(deliverableText));
  let expanded = $state(true);
  let seeded = $state(false);
  $effect(() => {
    if (!showDeliverable) {
      seeded = false;
      return;
    }
    if (seeded) return;
    expanded = !long;
    seeded = true;
  });

  // Preview only needs the head; never scan a multi-MB answer for it.
  const previewText = $derived(plainPreviewFromMarkdown(deliverableText.slice(0, 6_000), 280));
  /** The live preview shows the tail of the stream; re-laying-out the whole text per delta froze the tab. */
  const LIVE_TAIL = 4_000;
  const liveTail = $derived(streamText.length > LIVE_TAIL ? `…${streamText.slice(-LIVE_TAIL)}` : streamText);

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
  <section class="answer" class:rail={showLiveStream && !showDeliverable} class:rail-live={showLiveStream && !showDeliverable} aria-label={showLiveStream && !showDeliverable ? "Output so far" : "Final answer"}>
    <header class="ah">
      <h2>{showLiveStream && !showDeliverable ? "Output so far" : showFailureOnly && !showDeliverable ? "No answer" : "Answer"}</h2>
      {#if showDeliverable}
        <span class="meta">{formatSize(deliverableText.length)}</span>
        {#if meta?.model}<span class="meta">{meta.model}</span>{/if}
        {#if (meta?.tokensUsed ?? 0) > 0}<span class="meta">{meta?.tokensUsed?.toLocaleString()} tok</span>{/if}
        {#if (meta?.estimatedCost ?? 0) > 0}<span class="meta">{formatCost(meta?.estimatedCost)}</span>{/if}
        {#if (meta?.durationMs ?? 0) > 0}<span class="meta">{formatTurnDuration(meta?.durationMs ?? 0)}</span>{/if}
        <Button size="sm" variant="ghost" icon="copy" class="copy" onclick={copyDeliverable}>Copy</Button>
      {/if}
    </header>

    {#if showDeliverable}
      {#if expanded}
        <div class="prose"><RichAnswer markdown={deliverableText} {calls} toolbar="always" hostCopies /></div>
      {:else}
        <p class="prose preview">{previewText}</p>
      {/if}
      {#if long}
        <div class="more"><Button size="sm" variant="ghost" icon={expanded ? "back" : "down"} aria-expanded={expanded} onclick={() => (expanded = !expanded)}>{expanded ? "Show less" : "Show all"}</Button></div>
      {/if}
    {:else if showLiveStream}
      <p class="live">{liveTail}</p>
    {:else if showFailureOnly}
      <div class="fail" class:quiet={abstained}><BoundedText text={failureMessage} preview={3000} maxHeight="12rem" /></div>
    {/if}

    {#if showStructured}
      <div class="structured">
        <StructuredResult object={structuredObject} error={structuredError} report={structuredReport} schema={structuredSchema} />
      </div>
    {/if}
  </section>
{/if}

<style>
  .answer { border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); color: var(--cortex-text); }
  .answer.rail { padding-left: 4px; }
  .ah { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 10px 16px; border-bottom: 1px solid var(--cortex-line); }
  h2 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; }
  .meta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .ah :global(.copy) { margin-left: auto; }
  /* Text lines stop at the prose measure; code blocks and tables use the panel width. */
  .prose { margin: 0; padding: 14px 16px; font-size: var(--cortex-t-md); line-height: var(--cortex-lh-read); }
  p.prose,
  .prose :global(:is(p, ul, ol, blockquote, h1, h2, h3, h4, h5, h6, dl)) { max-width: var(--cortex-prose-measure); }
  .preview { color: var(--cortex-text-2); }
  .more { padding: 0 12px 10px; }
  .live { margin: 0; max-height: 12rem; overflow-y: auto; padding: 12px 16px; font-size: var(--cortex-t-md); line-height: var(--cortex-lh-read); color: var(--cortex-text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  .fail { padding: 12px 16px; color: var(--cortex-bad); font-size: var(--cortex-t-sm); }
  .fail.quiet { color: var(--cortex-text-2); }
  .structured { margin: 0 16px 14px; }
</style>
