<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import ChatTurnActions from "$lib/components/ChatTurnActions.svelte";
  import { endingBadge } from "$lib/turn-ending.js";
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

  const bubbleUser =
    "max-w-[80%] rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-[var(--cortex-text)]";
</script>

        <div
          class="chat-turn-in flex gap-2 justify-end"
          style:--chat-turn-delay="{entering ? Math.min(i, 8) * 40 : 0}ms"
          out:fade|local={{ duration: 140 }}
        >
          <div class="{bubbleUser} relative group">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span
                class="text-[9px] uppercase tracking-widest text-primary/80"
              >
                {turn.role}
              </span>
              {#if turn.cancelled && !turn.runFailed}
                <span class="font-mono text-[9px] text-[var(--cortex-text-muted)] italic">stopped</span>
              {/if}
              {#if turn.runFailed && !turn.streaming}
                {@const badge = endingBadge(turn.runFailed)}
                <span
                  data-testid="turn-ending-badge"
                  class="font-mono text-[9px] normal-case tracking-normal {badge.tone === 'error'
                    ? 'text-red-800 dark:text-red-300'
                    : badge.tone === 'warn'
                      ? 'text-amber-800 dark:text-amber-300'
                      : 'text-[var(--cortex-text-muted)] italic'}"
                  title={badge.title}
                >{badge.label}</span>
              {/if}
            </div>
            <p class="whitespace-pre-wrap text-[11px] leading-relaxed">{turn.content}</p>
            <!-- Status · time · copy and the turn's actions (ChatTurnActions). -->
            <ChatTurnActions
              {turn}
              showActions={!turn.streaming && idle}
              copyText={turn.content.trim() !== "" ? turn.content : undefined}
              {onCopy}
              {strategyLabel}
              actions={[
                { label: "Edit", icon: "edit", run: () => onEdit(turn.id) },
                { label: "Rewind to here (removes this and everything after)", icon: "undo", run: () => onRewind(turn.id) },
              ]}
            />
          </div>
        </div>
