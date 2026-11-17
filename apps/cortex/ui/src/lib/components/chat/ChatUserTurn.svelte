<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import ChatTurnActions from "$lib/components/ChatTurnActions.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import ChatSentAttachments from "$lib/components/chat/ChatSentAttachments.svelte";
  import { endingBadge } from "$lib/turn-ending.js";
  import { userTurnView } from "$lib/chat-edit-restore.js";
  import { fade } from "svelte/transition";

  interface Props {
    turn: ChatTurn;
    /** Position in the thread (drives the entrance stagger). */
    index: number;
    /** The session is still loading: stagger the entrance. */
    entering: boolean;
    /** No run and no history action in flight: the action row may show. */
    idle: boolean;
    onCopy: (content: string) => void | Promise<void>;
    strategyLabel: (id: string) => string;
    onEdit: (turnId: number) => void | Promise<void>;
    onRewind: (turnId: number) => void | Promise<void>;
  }
  const { turn, index: i, entering, idle, onCopy, strategyLabel, onEdit, onRewind }: Props = $props();
  const TONE = { error: "bad", warn: "warn", quiet: "neutral" } as const;
  // Tags show as chips; an attached-file block in the text never renders (chat-edit-restore.ts).
  const view = $derived(userTurnView(turn));
</script>

<!-- A quiet right-aligned bubble; time and actions under it (spec section 8). -->
<div
  class="chat-turn chat-turn-in msg-user"
  style:--chat-turn-delay="{entering ? Math.min(i, 8) * 40 : 0}ms"
  out:fade|local={{ duration: 140 }}
  data-testid="user-turn"
>
  {#if (turn.cancelled && !turn.runFailed) || (turn.runFailed && !turn.streaming)}
    <div class="badges">
      {#if turn.cancelled && !turn.runFailed}<Badge>stopped</Badge>{/if}
      {#if turn.runFailed && !turn.streaming}
        {@const badge = endingBadge(turn.runFailed)}
        <span data-testid="turn-ending-badge" use:tooltip={badge.title}><Badge tone={TONE[badge.tone]}>{badge.label}</Badge></span>
      {/if}
    </div>
  {/if}
  {#if view.attachments.length > 0}<ChatSentAttachments attachments={view.attachments} />{/if}
  <div class="bubble">{view.text}</div>
  <ChatTurnActions
    {turn}
    showActions={!turn.streaming && idle}
    copyText={turn.content.trim() !== "" ? turn.content : undefined}
    {onCopy}
    {strategyLabel}
    actions={[
      { label: "Edit message", icon: "edit", run: () => onEdit(turn.id) },
      { label: "Rewind to here (removes this and everything after)", icon: "undo", run: () => onRewind(turn.id) },
    ]}
  />
</div>

<style>
  .msg-user { justify-self: end; max-width: 78%; display: grid; gap: 6px; justify-items: end; }
  .badges { display: flex; gap: 6px; }
  .bubble {
    padding: 10px 14px;
    border-radius: var(--cortex-r-panel) var(--cortex-r-panel) 4px var(--cortex-r-panel);
    background: var(--cortex-surface-2);
    color: var(--cortex-text);
    font-size: var(--cortex-t-md);
    line-height: var(--cortex-lh-read);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
