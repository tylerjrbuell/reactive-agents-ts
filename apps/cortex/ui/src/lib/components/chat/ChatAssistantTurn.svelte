<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import ChatTranscript from "$lib/components/ChatTranscript.svelte";
  import ChatTurnActions from "$lib/components/ChatTurnActions.svelte";
  import ChatTokenUsage from "$lib/components/ChatTokenUsage.svelte";
  import ModelLink from "$lib/components/ModelLink.svelte";
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
    /** Session provider / model: shown on a streaming turn that has not pinned its own yet. */
    provider: string;
    model: string;
    planHidden: boolean;
    /** This is the latest assistant turn (it gets Retry / Rerun). */
    isLast: boolean;
    onCopy: (content: string) => void | Promise<void>;
    strategyLabel: (id: string) => string;
    onRerun: () => void | Promise<void>;
    onTrace: (turnId: number) => void;
    onFork: (turnId: number) => void | Promise<void>;
  }
  const { turn, index: i, entering, idle, provider, model, planHidden, isLast, onCopy, strategyLabel, onRerun, onTrace, onFork }: Props = $props();

  const bubbleAsst =
    "max-w-[80%] rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 text-[var(--cortex-text)]";
</script>

        <div
          class="chat-turn-in flex gap-2 justify-start"
          style:--chat-turn-delay="{entering ? Math.min(i, 8) * 40 : 0}ms"
          out:fade|local={{ duration: 140 }}
        >
          <div class="{bubbleAsst} relative group">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span
                class="text-[9px] uppercase tracking-widest text-secondary/80"
              >
                {turn.role}
              </span>
              {#if turn.model ?? (turn.streaming ? model : "")}
                <span class="text-[10px] normal-case tracking-normal text-[var(--cortex-text-muted)]">
                  <ModelLink provider={turn.provider ?? (turn.streaming ? provider : "")} /> · <ModelLink provider={turn.provider ?? (turn.streaming ? provider : "")} model={turn.model ?? model} />
                </span>
              {/if}
              <ChatTokenUsage turn={turn} />
              {#if turn.streaming && (turn.liveCost ?? 0) > 0}
                <span class="font-mono text-[9px] text-[var(--cortex-text-muted)] tabular-nums animate-pulse">
                  · ${((turn.liveCost ?? 0) * 100).toFixed(3)}¢
                </span>
              {/if}
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
            <div class="flex gap-2 items-start">
              <div class="flex-1 min-w-0">
                <ChatTranscript {turn} {planHidden} answerCopy={false} />
              </div>
            </div>
            <!-- Status · time (duration + finish) · strategy · copy and the turn's actions (ChatTurnActions). -->
            <ChatTurnActions
              {turn}
              showActions={!turn.streaming && idle}
              copyText={turn.content.trim() !== "" ? turn.content : undefined}
              {onCopy}
              {strategyLabel}
              actions={[
                ...(isLast
                  ? [{ label: turn.runFailed || turn.incomplete ? "Retry" : "Rerun", icon: "refresh", run: () => onRerun() }]
                  : []),
                { label: "Trace", icon: "account_tree", run: () => onTrace(turn.id) },
                { label: "Fork from here", icon: "call_split", run: () => onFork(turn.id) },
              ]}
            />
          </div>
        </div>
