<script lang="ts">
  /**
   * The composer: one panel with the quick bar on top (`quickBar` snippet), a 15px
   * Geist textarea, and a hint row with the prompt library and send / queue / stop.
   * A queued message shows as a strip above the panel (spec section 8).
   */
  import type { Snippet } from "svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import ChatQueuedRow from "$lib/components/ChatQueuedRow.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { composerAction, QueuedMessage } from "$lib/chat-queue.js";

  interface Props {
    /** Composer text. */
    message?: string;
    /** The textarea, for focus management by the panel. */
    inputEl?: HTMLTextAreaElement | null;
    sending: boolean;
    /** The quick bar, rendered at the top of the panel. */
    quickBar?: Snippet;
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
    message = $bindable(""), inputEl = $bindable(null), sending, quickBar, planning, queued, sendAction, hasText,
    onKeydown, onSendButton, onSendQueuedNow, onClearQueued,
  }: Props = $props();

  const sendLabel = $derived(sendAction === "stop" ? "Stop reply" : sendAction === "queue" ? "Queue message" : "Send message");
</script>

<div class="composer-wrap">
  {#if queued !== null}
    <ChatQueuedRow text={queued} {sending} onSendNow={onSendQueuedNow} onClear={onClearQueued} />
  {/if}
  <div class="composer" data-slash-menu-keep>
    {#if quickBar}{@render quickBar()}{/if}
    {#if planning}
      <p data-testid="planning-badge" class="planning" use:tooltip={"The harness restricts this turn to planning: the agent records steps but does not run other tools. /go carries the plan out."}>
        <Icon name="checklist" size="sm" />Planning mode. Send /go to carry the plan out.
      </p>
    {/if}
    <textarea
      bind:this={inputEl}
      aria-label="Message"
      placeholder={sending ? "Reply in progress. Type to queue your next message" : "Message the agent"}
      rows="3"
      bind:value={message}
      onkeydown={onKeydown}
      data-slash-menu-keep
    ></textarea>
    <div class="composer-f">
      <span class="hint">
        <kbd>/</kbd> commands
        {#if sending}<kbd>Enter</kbd> queue <kbd>Esc</kbd> clear{:else}<kbd>Enter</kbd> send <kbd>Shift Enter</kbd> new line{/if}
      </span>
      <PromptPickerButton
        types={["task", "snippet"]}
        defaultSaveType="task"
        onSelect={(body) => {
          message = message ? `${message}\n${body}` : body;
          inputEl?.focus();
        }}
      />
      <button
        type="button"
        class="send"
        class:stop={sendAction === "stop"}
        class:queue={sendAction === "queue"}
        disabled={sendAction === "send" && !hasText}
        aria-label={sendLabel}
        use:tooltip={sendAction === "queue" ? "Queue: sent when this reply finishes" : sendLabel}
        onclick={onSendButton}
      >
        {#if sendAction === "stop"}
          <Icon name="stop" />
        {:else if sendAction === "queue"}
          <Icon name="clock" size="sm" /><span>Queue</span>
        {:else}
          <Icon name="send" />
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  .composer-wrap { flex-shrink: 0; width: 100%; max-width: var(--cortex-chat-col); margin: 0 auto; }
  .composer {
    border: 1px solid var(--cortex-line-strong);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    transition: border-color var(--cortex-d-fast), box-shadow var(--cortex-d-fast);
  }
  .composer:focus-within { border-color: var(--cortex-accent); box-shadow: 0 0 0 3px var(--cortex-accent-tint); }
  .planning { display: flex; align-items: center; gap: 6px; margin: 8px 14px 0; font-size: var(--cortex-t-xs); color: var(--cortex-accent); }
  textarea {
    display: block;
    width: 100%;
    min-height: 64px;
    max-height: 40vh;
    padding: 10px 14px;
    border: 0;
    background: transparent;
    color: var(--cortex-text);
    font: 400 var(--cortex-t-md) / var(--cortex-lh-read) var(--cortex-font-ui);
    resize: none;
    outline: none;
  }
  .composer-f { display: flex; align-items: center; gap: 8px; padding: 0 8px 8px; }
  .hint { margin-right: auto; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  kbd {
    padding: 0 5px;
    border: 1px solid var(--cortex-line-strong);
    border-radius: 4px;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    line-height: 18px;
    color: var(--cortex-text-2);
  }
  .send {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-accent-fill);
    color: #fff;
    font: 500 var(--cortex-t-xs) var(--cortex-font-ui);
    cursor: pointer;
  }
  .send:hover:not(:disabled) { filter: brightness(1.08); }
  .send.stop { background: var(--cortex-surface-3); color: var(--cortex-text); }
  .send:disabled { opacity: 0.45; cursor: not-allowed; }
  .send:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
</style>
