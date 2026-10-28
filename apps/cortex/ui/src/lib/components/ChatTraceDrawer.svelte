<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import ChatTurnTimeline from "$lib/components/ChatTurnTimeline.svelte";

  interface Props {
    /** The assistant turn to inspect; absent until one exists. */
    turn: ChatTurn | undefined;
    onClose: () => void;
  }
  const { turn, onClose }: Props = $props();

  const calls = $derived(turn?.toolCalls ?? []);
  const failed = $derived(calls.filter((c) => c.status === "failed").length);
  const toolMs = $derived(calls.reduce((sum, c) => sum + (c.durationMs ?? 0), 0));
  const ctx = $derived(turn?.context);
</script>

<aside
  class="chat-drawer-in flex h-full w-80 flex-shrink-0 flex-col border-l border-[color:var(--cortex-border)] bg-surface-container-lowest/90 dark:bg-surface/90"
  aria-label="Turn trace"
>
  <div class="flex flex-shrink-0 items-center justify-between border-b border-[color:var(--cortex-border)] px-3 py-2.5">
    <h3 class="m-0 text-[12px] font-medium text-[var(--cortex-text)]">Trace</h3>
    <button
      type="button"
      onclick={onClose}
      aria-label="Close trace"
      class="flex cursor-pointer items-center rounded p-1 text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)]"
    >
      <span class="material-symbols-outlined text-[16px] leading-none">close</span>
    </button>
  </div>

  {#if !turn}
    <p class="m-0 p-4 text-[12px] text-[var(--cortex-text-muted)]">Send a message to see what the agent did: its thinking, each tool call, and how much context it used.</p>
  {:else}
    <dl class="m-0 grid flex-shrink-0 grid-cols-3 gap-px border-b border-[color:var(--cortex-border)] bg-[color:var(--cortex-border)] text-[11px]">
      {#each [
        ["Steps", turn.steps ?? turn.streamProgress?.iteration ?? "–"],
        ["Tool calls", calls.length > 0 ? `${calls.length}${failed ? ` (${failed} failed)` : ""}` : "0"],
        ["Tool time", toolMs > 0 ? `${(toolMs / 1000).toFixed(1)}s` : "–"],
        ["Tokens", turn.streaming ? (turn.liveTokens ?? 0).toLocaleString() : turn.tokensUsed.toLocaleString()],
        ["Context", ctx ? `${Math.round(ctx.utilizationPct)}%` : "–"],
        ["Status", turn.streaming ? "Running" : turn.cancelled ? "Stopped" : "Done"],
      ] as [label, value] (label)}
        <div class="bg-surface-container-lowest/90 px-2.5 py-2 dark:bg-surface/90">
          <dt class="text-[10px] text-[var(--cortex-text-muted)]">{label}</dt>
          <dd class="m-0 mt-0.5 tabular-nums text-[var(--cortex-text)]">{value}</dd>
        </div>
      {/each}
    </dl>
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#key turn.id}
        <ChatTurnTimeline {turn} />
      {/key}
      {#if calls.length === 0 && !(turn.reasoningSteps?.length)}
        <p class="m-0 text-[12px] text-[var(--cortex-text-muted)]">This turn was answered directly: no thinking or tool calls were recorded.</p>
      {/if}
    </div>
  {/if}
</aside>
