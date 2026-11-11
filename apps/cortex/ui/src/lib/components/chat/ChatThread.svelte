<script lang="ts">
  import { chatStore, type ChatTurn } from "$lib/stores/chat-store.js";
  import ChatApprovalCards from "$lib/components/ChatApprovalCards.svelte";
  import ChatInteractionCards from "$lib/components/ChatInteractionCards.svelte";
  import ChatProposals from "$lib/components/ChatProposals.svelte";
  import CompactionSummary from "$lib/components/CompactionSummary.svelte";
  import ChatEmptyState from "./ChatEmptyState.svelte";
  import ChatUserTurn from "./ChatUserTurn.svelte";
  import ChatAssistantTurn from "./ChatAssistantTurn.svelte";
  import type { compactionRows } from "$lib/chat-compaction.js";
  import { isNearBottom, shouldFollow } from "$lib/chat-scroll.js";
  import { fade } from "svelte/transition";

  interface Props {
    sessionId: string;
    turns: ChatTurn[];
    sending: boolean;
    /** Compaction marker / summary rows by turn index. */
    compaction: ReturnType<typeof compactionRows>;
    /** A history action (rewind, fork, …) is running. */
    busy: boolean;
    entering: boolean;
    provider: string;
    model: string;
    planHidden: boolean;
    lastAssistantId: number | undefined;
    starters: readonly string[];
    /** Reader is pinned near the bottom (the thread follows the stream). */
    atBottom?: boolean;
    /** Summary row being edited, and its draft. */
    editingSummaryId?: number | null;
    summaryDraft?: string;
    onStarter: (starter: string) => void;
    onSaveSummary: (turnId: number) => void | Promise<void>;
    onCopy: (content: string) => void | Promise<void>;
    strategyLabel: (id: string) => string;
    onEdit: (turnId: number) => void | Promise<void>;
    onRewind: (turnId: number) => void | Promise<void>;
    onRerun: () => void | Promise<void>;
    onTrace: (turnId: number) => void;
    onFork: (turnId: number) => void | Promise<void>;
  }
  let {
    sessionId, turns, sending, compaction, busy, entering, provider, model, planHidden, lastAssistantId, starters,
    atBottom = $bindable(true), editingSummaryId = $bindable(null), summaryDraft = $bindable(""),
    onStarter, onSaveSummary, onCopy, strategyLabel, onEdit, onRewind, onRerun, onTrace, onFork,
  }: Props = $props();

  let scrollEl = $state<HTMLDivElement | null>(null);

  // Smart autoscroll: follow the stream only while the user is pinned at the bottom.
  function onScroll() {
    if (!scrollEl) return;
    atBottom = isNearBottom(scrollEl);
  }
  $effect(() => {
    void turns; // track every store update (deltas re-create the array)
    if (scrollEl && shouldFollow(turns.length, atBottom)) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  /** Smooth-scroll to the newest turn and resume following. */
  export function jumpToLatest() {
    scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
    atBottom = true;
  }

  const idle = $derived(!sending && !busy);
</script>

  <div
    bind:this={scrollEl}
    onscroll={onScroll}
    class="flex-1 space-y-4 overflow-y-auto p-4 font-mono text-[12px]"
  >
    {#if turns.length === 0 && $chatStore.activePendingApprovals.length + $chatStore.activePendingInteractions.length === 0}
      <ChatEmptyState {starters} onPick={onStarter} />
    {:else}
      {#each turns as turn, i (turn.id)}
        {#if compaction.markers.has(i)}
          <div class="chat-turn-in flex items-center gap-3 text-[11px] text-[var(--cortex-text-muted)]" out:fade|local={{ duration: 140 }}>
            <span class="h-px flex-1 bg-[color:var(--cortex-border)]"></span>
            <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px] leading-none">compress</span>Earlier messages summarised</span>
            <span class="h-px flex-1 bg-[color:var(--cortex-border)]"></span>
          </div>
        {:else if compaction.summaries.has(i)}
          <details class="chat-turn-in rounded-lg border border-dashed border-[color:var(--cortex-border)] px-3 py-2 text-[12px] text-[var(--cortex-text-muted)]" out:fade|local={{ duration: 140 }}>
            <summary class="cursor-pointer select-none">View summary the agent carries forward</summary>
            {#if editingSummaryId === turn.id}
              <textarea
                bind:value={summaryDraft}
                rows="10"
                aria-label="Edit summary"
                class="mt-2 w-full resize-y rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 font-mono text-[12px] text-[var(--cortex-text)] focus:border-primary/40 focus:outline-none"
              ></textarea>
              <div class="mt-2 flex items-center gap-2">
                <button type="button" onclick={() => void onSaveSummary(turn.id)} disabled={busy || sending || summaryDraft.trim() === ""} class="cursor-pointer rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40">Save summary</button>
                <button type="button" onclick={() => (editingSummaryId = null)} class="cursor-pointer rounded-md px-2.5 py-1 text-[11px] transition-colors hover:text-[var(--cortex-text)]">Cancel</button>
                <span class="text-[11px]">The agent uses this text for everything before this point.</span>
              </div>
            {:else}
              <div class="mt-2"><CompactionSummary markdown={turn.content} /></div>
              {#if !sending}
                <button type="button" onclick={() => { editingSummaryId = turn.id; summaryDraft = turn.content; }} class="mt-2 flex cursor-pointer items-center gap-1 text-[11px] transition-colors hover:text-[var(--cortex-text)]">
                  <span class="material-symbols-outlined text-[14px] leading-none">edit</span>Edit summary
                </button>
              {/if}
            {/if}
          </details>
        {:else if turn.role === "user"}
          <ChatUserTurn {turn} index={i} {entering} {idle} {onCopy} {strategyLabel} {onEdit} {onRewind} />
        {:else}
          <ChatAssistantTurn {turn} index={i} {entering} {idle} {provider} {model} {planHidden} isLast={turn.id === lastAssistantId} {onCopy} {strategyLabel} {onRerun} {onTrace} {onFork} />
        {/if}
      {/each}
    {/if}
    <ChatApprovalCards {sessionId} />
    <ChatInteractionCards {sessionId} />
    <ChatProposals {sessionId} streaming={sending} />
  </div>
