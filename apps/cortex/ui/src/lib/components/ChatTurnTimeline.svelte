<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { buildSteps, previewArgs } from "$lib/stores/chat-timeline.js";
  import type { ChatToolCall } from "$lib/stores/chat-store.js";
  import { groupToolNames } from "$lib/tool-groups.js";
  import ChatSubAgentBlock from "$lib/components/ChatSubAgentBlock.svelte";

  interface Props {
    turn: ChatTurn;
    /** Tighter type + spacing for the run-view chat tab. */
    compact?: boolean;
  }
  const { turn, compact = false }: Props = $props();

  // One step per model turn: its thinking plus the tools it called.
  const steps = $derived(buildSteps(turn));
  // Open/closed overrides keyed by step key / call id. Absent ⇒ default: the step
  // still running stays open; finished steps collapse to their one-line summary;
  // tool cards start collapsed.
  let overrides = $state<Record<string, boolean>>({});
  const stepDefault = (i: number) => turn.streaming === true && i === steps.length - 1;
  const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

  const isOpen = (key: string, fallback: boolean) => overrides[key] ?? fallback;
  const toggle = (key: string, fallback: boolean) => {
    overrides = { ...overrides, [key]: !isOpen(key, fallback) };
  };

  const pretty = (value: unknown): string => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const text = $derived(compact ? "text-[9px]" : "text-[10px]");
</script>

{#snippet toolCard(call: ChatToolCall)}
        {@const open = isOpen(call.id, false)}
        <div class="overflow-hidden rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-mid)]/40">
          <button
            type="button"
            onclick={() => toggle(call.id, false)}
            class="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-left font-mono text-[9px] transition-colors hover:bg-[var(--cortex-surface-mid)]"
            aria-expanded={open}
          >
            <span
              class="material-symbols-outlined text-[11px] leading-none transition-transform duration-150"
              style="transform: rotate({open ? '90deg' : '0deg'})">chevron_right</span
            >
            <span
              class="material-symbols-outlined text-[12px] leading-none {call.status === 'running'
                ? 'animate-spin text-secondary'
                : call.status === 'failed'
                  ? 'text-error'
                  : 'text-[var(--cortex-text-muted)]'}"
              aria-label={call.status}
            >{call.status === "running" ? "progress_activity" : call.status === "failed" ? "error" : "build"}</span>
            <span class="font-semibold text-[var(--cortex-text)]">{call.name}</span>
            {#if !open && call.args !== undefined}
              <span class="min-w-0 flex-1 truncate text-[var(--cortex-text-muted)]">{previewArgs(call.args)}</span>
            {:else}
              <span class="flex-1"></span>
            {/if}
            {#if call.durationMs != null}
              <span class="shrink-0 tabular-nums text-[var(--cortex-text-muted)]">{call.durationMs}ms</span>
            {/if}
          </button>
          {#if open}
            <div class="space-y-1.5 border-t border-[color:var(--cortex-border)] px-2 py-1.5">
              <div>
                <div class="mb-0.5 font-mono text-[8px] uppercase tracking-widest text-[var(--cortex-text-muted)]">Parameters</div>
                {#if call.args !== undefined}
                  <pre class="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono leading-snug text-[var(--cortex-text)] {text}">{pretty(call.args)}</pre>
                {:else}
                  <span class="font-mono italic text-[var(--cortex-text-muted)] {text}">not reported</span>
                {/if}
              </div>
              <div>
                <div class="mb-0.5 font-mono text-[8px] uppercase tracking-widest {call.status === 'failed' ? 'text-error' : 'text-[var(--cortex-text-muted)]'}">
                  {call.status === "failed" ? "Error" : "Result"}
                </div>
                {#if call.status === "running"}
                  <span class="font-mono italic text-[var(--cortex-text-muted)] {text}">running…</span>
                {:else if (call.status === "failed" ? call.error : call.result) !== undefined}
                  <pre class="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono leading-snug {call.status === 'failed' ? 'text-error' : 'text-[var(--cortex-text)]'} {text}">{call.status === "failed" ? call.error : call.result}{call.resultTruncated ? "\n… (truncated)" : ""}</pre>
                {:else}
                  <span class="font-mono italic text-[var(--cortex-text-muted)] {text}">no output</span>
                {/if}
              </div>
            </div>
          {/if}
        </div>
{/snippet}

{#if steps.length > 0 || (turn.subAgents?.length ?? 0) > 0}
  <ol class="mb-2 m-0 list-none space-y-1 p-0" aria-label="Steps">
    {#each steps as step, i (step.key)}
      {@const open = isOpen(step.key, stepDefault(i))}
      {@const live = step.status === "running" || (turn.streaming === true && i === steps.length - 1)}
      <li class="step border-l-2 pl-2 {live ? 'border-secondary/70' : step.status === 'failed' ? 'border-error/60' : 'border-[color:var(--cortex-border)]'}">
        <button
          type="button"
          onclick={() => toggle(step.key, stepDefault(i))}
          class="flex w-full cursor-pointer items-center gap-1.5 py-0.5 text-left font-mono {text} text-[var(--cortex-text-muted)] transition-colors hover:text-[var(--cortex-text)]"
          aria-expanded={open}
        >
          <span
            class="material-symbols-outlined text-[11px] leading-none transition-transform duration-150"
            style="transform: rotate({open ? '90deg' : '0deg'})">chevron_right</span
          >
          <span class="w-4 shrink-0 tabular-nums text-right {live ? 'text-secondary' : ''}" aria-label="Step {step.n}">{step.n}</span>
          <span class="min-w-0 flex-1 truncate {open ? 'text-[var(--cortex-text)]' : ''}" title={step.summary}>{step.summary}</span>
          {#if !open}
            {#each step.tools as t (t.name)}
              <span class="shrink-0 rounded bg-[var(--cortex-surface-mid)] px-1 text-[var(--cortex-text)]">{t.name}{t.count > 1 ? ` ×${t.count}` : ""}</span>
            {/each}
          {/if}
          {#if step.failedCount > 0}
            <span class="shrink-0 text-error" aria-label="{step.failedCount} failed">{step.failedCount} failed</span>
          {/if}
          {#if live}
            <span class="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-secondary/70" aria-label="running"></span>
          {:else if step.durationMs !== undefined}
            <span class="shrink-0 tabular-nums">{fmtMs(step.durationMs)}</span>
          {/if}
        </button>
        {#if open}
          <div class="space-y-1.5 pb-1 pl-5 pt-0.5">
            {#if step.thought}
              <p class="m-0 whitespace-pre-wrap leading-relaxed italic text-[var(--cortex-text-muted)] {text}">{step.thought}</p>
            {/if}
            {#each step.calls as call (call.id)}
              {@render toolCard(call)}
            {/each}
          </div>
        {/if}
      </li>
    {/each}
  </ol>
  {#if (turn.subAgents?.length ?? 0) > 0}
    <div class="mb-2 space-y-1.5">
      <!-- Children stack in start order, below the parent's own steps; each nests its own children. -->
      {#each turn.subAgents ?? [] as agent (agent.key)}
        <ChatSubAgentBlock {agent} {compact} />
      {/each}
    </div>
  {/if}
{:else if turn.toolsUsed && turn.toolsUsed.length > 0}
  <!-- History loaded from the server keeps only tool names, not per-call detail. -->
  <div class="mb-2 flex flex-wrap gap-1 font-mono text-[9px]">
    {#each groupToolNames(turn.toolsUsed) as tool (tool.name)}
      <span class="rounded bg-[var(--cortex-surface-mid)] px-1.5 py-0.5 text-[var(--cortex-text)]">{tool.name}{tool.count > 1 ? ` ×${tool.count}` : ""}</span>
    {/each}
  </div>
{/if}
