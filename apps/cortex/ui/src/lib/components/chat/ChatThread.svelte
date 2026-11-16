<script lang="ts">
  import { chatStore, type ChatTurn } from "$lib/stores/chat-store.js";
  import ChatApprovalCards from "$lib/components/ChatApprovalCards.svelte";
  import ChatInteractionCards from "$lib/components/ChatInteractionCards.svelte";
  import ChatLiveApproval from "$lib/components/ChatLiveApproval.svelte";
  import ChatLiveInteraction from "$lib/components/ChatLiveInteraction.svelte";
  import { orphanChatInteractions, type LiveInteraction } from "$lib/chat-live-interaction.js";
  import { pendingInteractions } from "$lib/stores/interaction-watcher.js";
  import { approvalCardKey, hiddenApprovalCards, orphanChatApprovals } from "$lib/chat-live-approval.js";
  import { pendingApprovals } from "$lib/stores/approval-watcher.js";
  import ChatProposals from "$lib/components/ChatProposals.svelte";
  import ChatBtwAsides from "./ChatBtwAsides.svelte";
  import CompactionSummary from "$lib/components/CompactionSummary.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import ChatEmptyState from "./ChatEmptyState.svelte";
  import ChatUserTurn from "./ChatUserTurn.svelte";
  import ChatAssistantTurn from "./ChatAssistantTurn.svelte";
  import type { compactionRows } from "$lib/chat-compaction.js";
  import { followAfterScroll, shouldFollow, type FollowState } from "$lib/chat-scroll.js";
  import { planCardTurnId } from "$lib/chat-mode.js";
  import { chatMode, executePlan } from "$lib/stores/chat-mode-store.js";
  import { fade } from "svelte/transition";
  import { onMount } from "svelte";

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
    /** Tools the session has picked, for the empty state's line. */
    toolCount?: number;
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
    sessionId, turns, sending, compaction, busy, entering, provider, model, planHidden, lastAssistantId, starters, toolCount = 0,
    atBottom = $bindable(true), editingSummaryId = $bindable(null), summaryDraft = $bindable(""),
    onStarter, onSaveSummary, onCopy, strategyLabel, onEdit, onRewind, onRerun, onTrace, onFork,
  }: Props = $props();

  // Plan mode: the latest finished reply is the plan card (Execute switches the session and sends the follow-up).
  const planTurnId = $derived(planCardTurnId(turns, $chatMode));

  // Live approvals of this chat that no streaming turn shows (e.g. after a reload): the
  // open chat is their surface, so the app-wide toast skips them (approval-surface.ts).
  const liveOrphans = $derived(
    orphanChatApprovals(
      sessionId,
      $pendingApprovals,
      new Set($chatStore.activePendingApprovals.map((p) => p.runId)),
      new Set(turns.flatMap((t) => (t.streaming && t.liveApproval ? [approvalCardKey(t.liveApproval)] : []))),
      $hiddenApprovalCards,
    ),
  );

  // Live questions of this chat that no streaming turn shows (e.g. after a reload).
  const interactionOrphans = $derived(
    orphanChatInteractions(
      sessionId,
      $pendingInteractions as readonly (LiveInteraction & { chatSessionId?: string })[],
      new Set(turns.flatMap((t) => (t.streaming && t.liveInteraction ? [t.liveInteraction.runId] : []))),
    ),
  );

  let scrollEl = $state<HTMLDivElement | null>(null);
  let contentEl = $state<HTMLDivElement | null>(null);
  let follow: FollowState = { atBottom: true, lastTop: 0 };

  const toBottom = () => {
    if (!scrollEl) return;
    // An empty chat has no latest turn: show its hero from the top on short windows.
    scrollEl.scrollTop = empty ? 0 : scrollEl.scrollHeight;
    follow = { atBottom: true, lastTop: scrollEl.scrollTop };
  };

  // Follow the stream only while the reader is pinned at the bottom; only the reader
  // scrolling up unpins (chat-scroll.ts followAfterScroll), so content that grows after
  // the first paint (markdown, entrance animation) never strands a chat mid-thread.
  function onScroll() {
    if (!scrollEl) return;
    follow = followAfterScroll(follow, scrollEl);
    atBottom = follow.atBottom;
  }
  $effect(() => {
    void turns; // track every store update (deltas re-create the array)
    if (scrollEl && shouldFollow(turns.length, atBottom)) toBottom();
  });

  // The thread mounts per session (the page shows a skeleton while one loads), so a mount
  // is an open: land at the latest turn, and keep landing there while the content settles.
  onMount(() => {
    toBottom();
    atBottom = true;
    if (!contentEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (follow.atBottom) toBottom();
    });
    ro.observe(contentEl);
    return () => ro.disconnect();
  });

  /** Smooth-scroll to the newest turn and resume following. */
  export function jumpToLatest() {
    scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
    follow = { atBottom: true, lastTop: scrollEl?.scrollTop ?? 0 };
    atBottom = true;
  }

  const idle = $derived(!sending && !busy);
  const empty = $derived(turns.length === 0 && $chatStore.activePendingApprovals.length + $chatStore.activePendingInteractions.length === 0);
</script>

<div bind:this={scrollEl} onscroll={onScroll} class="thread-scroll" class:is-empty={empty} data-testid="chat-thread">
  <div bind:this={contentEl} class="thread">
    {#if empty}
      <ChatEmptyState {starters} {toolCount} onPick={onStarter} />
    {:else}
      {#each turns as turn, i (turn.id)}
        {#if compaction.markers.has(i)}
          <div class="chat-turn-in marker" out:fade|local={{ duration: 140 }}>
            <span class="rule"></span>
            <span class="marker-label"><Icon name="compress" size="sm" />Earlier messages summarised</span>
            <span class="rule"></span>
          </div>
        {:else if compaction.summaries.has(i)}
          <details class="chat-turn-in summary" out:fade|local={{ duration: 140 }}>
            <summary>View the summary the agent carries forward</summary>
            {#if editingSummaryId === turn.id}
              <textarea bind:value={summaryDraft} rows="10" aria-label="Edit summary" class="cx-control cx-mono mt-2"></textarea>
              <div class="summary-acts">
                <Button size="sm" variant="primary" onclick={() => void onSaveSummary(turn.id)} disabled={busy || sending || summaryDraft.trim() === ""}>Save summary</Button>
                <Button size="sm" variant="ghost" onclick={() => (editingSummaryId = null)}>Cancel</Button>
                <span>The agent uses this text for everything before this point.</span>
              </div>
            {:else}
              <div class="mt-2"><CompactionSummary markdown={turn.content} /></div>
              {#if !sending}
                <div class="summary-acts">
                  <Button size="sm" variant="ghost" icon="edit" onclick={() => { editingSummaryId = turn.id; summaryDraft = turn.content; }}>Edit summary</Button>
                </div>
              {/if}
            {/if}
          </details>
        {:else if turn.role === "user"}
          <ChatUserTurn {turn} index={i} {entering} {idle} {onCopy} {strategyLabel} {onEdit} {onRewind} />
        {:else}
          <ChatAssistantTurn {turn} index={i} {entering} {idle} {provider} {model} {planHidden} isLast={turn.id === lastAssistantId} planCard={turn.id === planTurnId} onExecutePlan={executePlan} {onCopy} {strategyLabel} {onRerun} {onTrace} {onFork} />
        {/if}
      {/each}
    {/if}
    <ChatApprovalCards {sessionId} />
    {#each liveOrphans as approval (approval.runId)}
      <ChatLiveApproval {approval} />
    {/each}
    {#each interactionOrphans as question (question.runId + question.interactionId)}
      <ChatLiveInteraction {question} />
    {/each}
    <ChatInteractionCards {sessionId} />
    <ChatProposals {sessionId} streaming={sending} />
    <ChatBtwAsides {sessionId} />
  </div>
</div>

<style>
  .thread-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px var(--cortex-chat-gutter) 40px;
    /* Sticky children offset by this scroller's top padding; RichAnswer's bar cancels it to sit flush. */
    --cortex-stick-inset: 24px;
    /* Keeps the column centred like the composer below it whether or not a scrollbar shows. */
    scrollbar-gutter: stable both-edges;
    font-family: var(--cortex-font-ui);
  }
  /* `safe`: when the empty state is taller than the pane it starts at the top instead of overflowing upward (clipped hero mark). */
  .thread-scroll.is-empty { display: grid; align-content: safe center; }
  /* One reading column, centred, shared with the to-do dock and composer (`--cortex-chat-col`). */
  .thread { max-width: var(--cortex-chat-col); margin: 0 auto; display: grid; gap: 32px; min-width: 0; }
  .thread > :global(*) { min-width: 0; }
  .marker { display: flex; align-items: center; gap: 12px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .rule { height: 1px; flex: 1; background: var(--cortex-line); }
  .marker-label { display: inline-flex; align-items: center; gap: 6px; }
  .summary {
    padding: 10px 14px;
    border: 1px dashed var(--cortex-line-strong);
    border-radius: var(--cortex-r-ctl);
    font-size: var(--cortex-t-sm);
    color: var(--cortex-text-2);
  }
  .summary > summary { cursor: pointer; user-select: none; }
  .summary-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
