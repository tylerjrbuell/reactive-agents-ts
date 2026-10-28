<script lang="ts">
  /**
   * One row of the execution trace ("frame"): a kernel loop, or the FINAL answer.
   * Every payload that can be large goes through BoundedText / GuardedMarkdown, so a
   * runaway tool result or answer can never freeze the page.
   */
  import type { CortexTraceFrame } from "$lib/stores/trace-store.js";
  import BoundedText from "$lib/components/BoundedText.svelte";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";
  import { formatSize } from "$lib/text-budget.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { groupToolNames } from "$lib/tool-groups.js";

  interface Props {
    frame: CortexTraceFrame;
    expanded: boolean;
    selected?: boolean;
    onToggle: () => void;
  }
  let { frame: f, expanded, selected = false, onToggle }: Props = $props();

  const isFinal = $derived(f.kind === "final");
  const toolGroups = $derived(groupToolNames(f.toolsThisStep ?? []));
  const summary = $derived((f.llmThought || f.thought || "").replace(/\s+/g, " ").trim());
  const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

  /** Messages-sent-to-LLM thread is secondary: collapsed until asked for. */
  let showThread = $state(false);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied", label);
    } catch {
      toast.error("Copy failed");
    }
  }

  const roleTone = (role: string) =>
    role === "assistant" ? "text-primary" : role === "system" ? "text-tertiary/80" : "text-secondary";
</script>

{#snippet section(title: string, tone: string, text: string, copyLabel: string, max: string = "16rem")}
  <section class="space-y-1">
    <div class="flex items-center justify-between">
      <h4 class="m-0 font-mono text-[9px] font-semibold uppercase tracking-widest {tone}">{title}</h4>
      <button type="button" class="cursor-pointer border-0 bg-transparent p-0.5 text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)]" aria-label="Copy {title}" onclick={() => copy(text, copyLabel)}>
        <span class="material-symbols-outlined text-[14px] leading-none">content_copy</span>
      </button>
    </div>
    <BoundedText {text} copy={false} maxHeight={max} />
  </section>
{/snippet}

<article
  class="mx-2 mb-1.5 overflow-hidden rounded-lg border transition-colors
         {isFinal
           ? 'border-secondary/35 bg-secondary/5'
           : selected
             ? 'border-primary/40 bg-primary/5'
             : 'border-[var(--cortex-border)] bg-[var(--cortex-surface-low)]/40 hover:bg-[var(--cortex-surface-low)]/70'}"
>
  <button type="button" class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left" aria-expanded={expanded} onclick={onToggle}>
    <span
      class="flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold tabular-nums
             {isFinal ? 'bg-secondary/20 text-secondary' : 'bg-primary/10 text-primary'}"
    >
      {#if isFinal}<span class="material-symbols-outlined align-middle text-[11px]" style="font-variation-settings:'FILL' 1">check_circle</span> FINAL{:else}L{f.iteration}{/if}
    </span>
    <span class="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--cortex-text)]/80">
      {#if isFinal}
        {summary.slice(0, 140)}{summary.length > 140 ? "…" : ""}
      {:else}
        {summary.slice(0, 140)}{summary.length > 140 ? "…" : ""}
      {/if}
    </span>
    {#if !isFinal && f.toolsThisStep?.length}
      <span class="flex flex-shrink-0 gap-1">
        {#each toolGroups.slice(0, 2) as tool (tool.name)}
          <span class="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] text-amber-700 dark:text-amber-400">{tool.name.length > 16 ? `${tool.name.slice(0, 14)}…` : tool.name}{tool.count > 1 ? ` ×${tool.count}` : ""}</span>
        {/each}
        {#if toolGroups.length > 2}<span class="font-mono text-[9px] text-[var(--cortex-text-muted)]">+{toolGroups.length - 2}</span>{/if}
      </span>
    {/if}
    <span class="flex flex-shrink-0 items-center gap-2 font-mono text-[9px] text-[var(--cortex-text-muted)]">
      {#if f.tokensUsed > 0}<span>{f.tokensUsed.toLocaleString()}t</span>{/if}
      {#if f.durationMs > 0}<span>{fmtMs(f.durationMs)}</span>{/if}
      {#if f.entropy !== undefined}<span class="text-primary/60">η{f.entropy.toFixed(2)}</span>{/if}
    </span>
    <span class="material-symbols-outlined flex-shrink-0 text-[16px] text-[var(--cortex-text-muted)] transition-transform duration-200 {expanded ? 'rotate-180' : ''}">expand_more</span>
  </button>

  {#if expanded}
    <div class="space-y-3 border-t border-[var(--cortex-border)] px-3 py-3" role="region" aria-label={isFinal ? "Final answer" : `Kernel loop ${f.iteration} details`}>
      {#if isFinal}
        <div class="rounded-lg border border-[var(--cortex-border)] bg-[var(--cortex-surface)]/70 p-3">
          <div class="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-secondary">
            <span class="material-symbols-outlined text-[14px]" style="font-variation-settings:'FILL' 1">flag</span>
            Final answer
            <span class="normal-case tracking-normal text-[var(--cortex-text-muted)]">· {formatSize(f.thought.length)}</span>
            <button type="button" class="ml-auto cursor-pointer rounded border border-[var(--cortex-border)] bg-transparent px-1.5 py-0.5 normal-case tracking-normal text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)]" onclick={() => copy(f.thought, "Final answer copied")}>Copy</button>
          </div>
          <GuardedMarkdown markdown={f.thought} showCopy={false} class="text-[12px]" />
        </div>
      {:else}
        {#if f.llmThought}{@render section("Reasoning", "text-primary", f.llmThought, "Reasoning copied")}{/if}
        {#if f.action}{@render section("Action", "text-amber-700 dark:text-amber-400", f.action, "Action copied", "10rem")}{/if}
        {#if f.observation}{@render section("Tool result", "text-secondary", f.observation, "Tool result copied")}{/if}
      {/if}

      {#if f.rawResponse}{@render section("Raw LLM response", "text-[var(--cortex-text-muted)]", f.rawResponse, "Raw response copied")}{/if}

      {#if f.messages?.length}
        <section class="space-y-1">
          <button type="button" class="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-[9px] font-semibold uppercase tracking-widest text-[var(--cortex-text-muted)]" aria-expanded={showThread} onclick={() => (showThread = !showThread)}>
            <span class="material-symbols-outlined text-[13px] leading-none transition-transform {showThread ? 'rotate-90' : ''}">chevron_right</span>
            Conversation thread · {f.messages.length} messages
          </button>
          {#if showThread}
            <div class="space-y-1.5">
              {#each f.messages as msg, mi (mi)}
                <div>
                  <div class="mb-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider {roleTone(msg.role)}">{msg.role}</div>
                  <BoundedText text={msg.content} preview={1500} maxHeight="12rem" />
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <footer class="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-[var(--cortex-border)] pt-2 font-mono text-[9px] text-[var(--cortex-text-muted)]">
        {#if f.model}<span>{f.model}</span>{/if}
        {#if f.provider}<span>{f.provider}</span>{/if}
        {#if f.tokensUsed > 0}<span>{f.tokensUsed.toLocaleString()} tokens</span>{/if}
        {#if f.estimatedCost}<span>${f.estimatedCost.toFixed(5)}</span>{/if}
        {#if f.entropy !== undefined}<span>η {f.entropy.toFixed(3)}</span>{/if}
        <span>{new Date(f.ts).toLocaleTimeString()}</span>
      </footer>
    </div>
  {/if}
</article>
