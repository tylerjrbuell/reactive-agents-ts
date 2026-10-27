<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { buildTimeline, previewArgs } from "$lib/stores/chat-timeline.js";

  interface Props {
    turn: ChatTurn;
    /** Tighter type + spacing for the run-view chat tab. */
    compact?: boolean;
  }
  const { turn, compact = false }: Props = $props();

  const items = $derived(buildTimeline(turn));
  // Open/closed overrides keyed by `t<iteration>` / call id. Absent ⇒ default:
  // thinking is open while its turn streams and collapses once it finishes;
  // tool cards start collapsed.
  let overrides = $state<Record<string, boolean>>({});

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

{#if items.length > 0}
  <div class="mb-2 space-y-1.5">
    {#each items as item, i (item.kind === "thought" ? `t${item.iteration}` : item.call.id)}
      {#if item.kind === "thought"}
        {@const key = `t${item.iteration}`}
        {@const live = turn.streaming === true && i === items.length - 1}
        {@const open = isOpen(key, turn.streaming === true)}
        <div class="border-l border-[color:var(--cortex-border)] pl-2.5">
          <button
            type="button"
            onclick={() => toggle(key, turn.streaming === true)}
            class="flex cursor-pointer items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-[var(--cortex-text-muted)] opacity-80 transition-colors hover:text-[var(--cortex-text)]"
            aria-expanded={open}
          >
            <span
              class="material-symbols-outlined text-[11px] leading-none transition-transform duration-150"
              style="transform: rotate({open ? '90deg' : '0deg'})">chevron_right</span
            >
            Thinking
            {#if live}<span class="inline-block h-1 w-1 animate-pulse rounded-full bg-secondary/60"></span>{/if}
          </button>
          {#if open}
            <p
              class="mt-1 m-0 whitespace-pre-wrap leading-relaxed italic text-[var(--cortex-text-muted)] {text}"
            >{item.text}</p>
          {/if}
        </div>
      {:else}
        {@const call = item.call}
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
      {/if}
    {/each}
  </div>
{:else if turn.toolsUsed && turn.toolsUsed.length > 0}
  <!-- History loaded from the server keeps only tool names, not per-call detail. -->
  <div class="mb-2 flex flex-wrap gap-1 font-mono text-[9px]">
    {#each turn.toolsUsed as tool (tool)}
      <span class="rounded bg-[var(--cortex-surface-mid)] px-1.5 py-0.5 text-[var(--cortex-text)]">{tool}</span>
    {/each}
  </div>
{/if}
