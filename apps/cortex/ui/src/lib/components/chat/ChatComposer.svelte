<script lang="ts">
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import ChatQueuedRow from "$lib/components/ChatQueuedRow.svelte";
  import type { composerAction, QueuedMessage } from "$lib/chat-queue.js";

  interface Props {
    /** Composer text. */
    message?: string;
    /** The textarea, for focus management by the panel. */
    inputEl?: HTMLTextAreaElement | null;
    sending: boolean;
    /** The quick bar sits above: no top border. */
    hasQuickBar: boolean;
    /** The harness restricts this turn to planning. */
    planning: boolean;
    queued: QueuedMessage;
    sendAction: ReturnType<typeof composerAction>;
    hasText: boolean;
    onKeydown: (e: KeyboardEvent) => void;
    onSendButton: () => void;
    onSendQueuedNow: () => void;
    onClearQueued: () => void;
  }
  let {
    message = $bindable(""), inputEl = $bindable(null), sending, hasQuickBar, planning, queued, sendAction, hasText,
    onKeydown, onSendButton, onSendQueuedNow, onClearQueued,
  }: Props = $props();
</script>

  <div class="flex-shrink-0 px-3 pb-3 pt-2 {hasQuickBar ? '' : 'border-t border-[color:var(--cortex-border)]'}">
    <div class="relative rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] transition-colors focus-within:border-primary/40">
    {#if planning}
      <Tooltip text="The harness restricts this turn to planning: the agent records steps but does not run other tools. /go carries the plan out." class="px-3 pt-2"><div data-testid="planning-badge" class="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-primary">
        <span class="material-symbols-outlined text-[13px] leading-none">checklist</span>
        Planning mode · /go to proceed
      </div></Tooltip>
    {/if}
    {#if queued !== null}
      <ChatQueuedRow text={queued} {sending} onSendNow={onSendQueuedNow} onClear={onClearQueued} />
    {/if}
    <textarea
      bind:this={inputEl}
      class="min-h-[4.5rem] w-full resize-none border-0 bg-transparent px-3 pt-2 pb-1 font-mono text-[12px] text-[var(--cortex-text)] placeholder:text-[var(--cortex-text-muted)] focus:outline-none"
      placeholder={sending ? "Reply in progress. Type to queue your next message (Enter queues, Esc clears)" : "Message… (Enter to send, Shift+Enter for newline, / for commands)"}
      rows="3"
      bind:value={message}
      onkeydown={onKeydown}
      data-slash-menu-keep
    ></textarea>
      <div class="flex items-center justify-between gap-2 px-2 pb-2">
        <div class="flex items-center gap-1">
      <PromptPickerButton
      types={["task", "snippet"]}
      defaultSaveType="task"
      onSelect={(body) => {
        message = message ? `${message}\n${body}` : body;
        inputEl?.focus();
      }}
    />
        </div>
      <button
      type="button"
      disabled={sendAction === "send" && !hasText}
      aria-label={sendAction === "stop" ? "Stop reply" : sendAction === "queue" ? "Queue message" : "Send message"}
      title={sendAction === "stop" ? "Stop reply" : sendAction === "queue" ? "Queue: sent when this reply finishes" : "Send"}
      class="flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-md border border-primary/35 bg-primary/10 px-3 py-1 font-mono text-[11px] uppercase text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
      onclick={onSendButton}
    >
      {#if sendAction === "stop"}
        <span class="material-symbols-outlined text-sm">stop_circle</span>
      {:else if sendAction === "queue"}
        <span class="material-symbols-outlined text-sm">schedule_send</span>
        <span>Queue</span>
      {:else}
        <span class="material-symbols-outlined text-sm">send</span>
      {/if}
    </button>
      </div>
    </div>
  </div>
