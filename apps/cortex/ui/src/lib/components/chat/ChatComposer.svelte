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
  import { highlightPieces, insertAtCaret, parseInlineCommands } from "$lib/chat-inline-commands.js";
  import { draftSkills } from "$lib/chat-composer-input.js";
  import { tick } from "svelte";
  import ChatModeToggle from "$lib/components/chat/ChatModeToggle.svelte";
  import ChatPauseButton from "$lib/components/chat/ChatPauseButton.svelte";
  import { interruptPhase } from "$lib/stores/chat-interrupt.js";
  import { isModeShortcut, modeHint, nextMode, type ChatMode } from "$lib/chat-mode.js";

  interface Props {
    /** Composer text. */
    message?: string;
    /** Caret offset in `message`, kept in sync on input, click and key moves. */
    caret?: number;
    /** Skill names the session's agent can load: their `/name` tokens are highlighted. */
    skills?: readonly string[];
    /** The textarea, for focus management by the panel. */
    inputEl?: HTMLTextAreaElement | null;
    sending: boolean;
    /** The quick bar, rendered at the top of the panel. */
    quickBar?: Snippet;
    /** Attachment chips and the `@` file menu (ChatAttachmentBar, ChatMentionMenu), above the text. */
    attachBar?: Snippet;
    /** Extra controls in the footer, before the prompt library (the paperclip). */
    footerTools?: Snippet;
    /** Files dropped on the composer or pasted into it. */
    onFiles?: (files: File[]) => void | Promise<void>;
    /** The session's mode: plan = reasoning only, no tools, until Execute. */
    mode: ChatMode;
    onModeChange: (mode: ChatMode) => void;
    queued: QueuedMessage;
    sendAction: ReturnType<typeof composerAction>;
    hasText: boolean;
    onKeydown: (e: KeyboardEvent) => void;
    onSendButton: () => void;
    onSendQueuedNow: () => void;
    onClearQueued: () => void;
  }
  let {
    message = $bindable(""), caret = $bindable(0), skills = [], inputEl = $bindable(null), sending, quickBar, attachBar, footerTools, onFiles, mode, onModeChange, queued, sendAction, hasText,
    onKeydown, onSendButton, onSendQueuedNow, onClearQueued,
  }: Props = $props();

  // Shift+Tab flips the mode from the text box; everything else is the panel's key handling.
  function onComposerKeydown(e: KeyboardEvent) {
    if (isModeShortcut(e, message)) {
      e.preventDefault();
      onModeChange(nextMode(mode));
      return;
    }
    onKeydown(e);
  }

  // Drop and paste: files go to the attachment checks, text drops and pastes stay the browser's.
  let dropping = $state(false);
  const hasFiles = (dt: DataTransfer | null) => dt !== null && Array.from(dt.types).includes("Files");
  function onDragOver(e: DragEvent) {
    if (!onFiles || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dropping = true;
  }
  function onDrop(e: DragEvent) {
    dropping = false;
    if (!onFiles || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    void onFiles(Array.from(e.dataTransfer?.files ?? []));
  }
  function onPaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!onFiles || files.length === 0) return;
    // A copied file or screenshot has no text worth pasting; keep any text the clipboard also carries.
    if (!e.clipboardData?.getData("text/plain")) e.preventDefault();
    void onFiles(files);
  }

  /** A Stop / Pause the server has not confirmed yet: the send button reads "Stopping…" and is inert. */
  const interrupting = $derived(sendAction === "stop" && $interruptPhase !== "idle");
  const sendLabel = $derived(interrupting ? ($interruptPhase === "pausing" ? "Pausing reply" : "Stopping reply") : sendAction === "stop" ? "Stop reply" :sendAction === "queue" ? "Queue message" : "Send message");

  // Highlight layer: a mirror of the text behind the transparent textarea, same box and
  // wrapping, where recognized command tokens get a tinted background. The textarea
  // stays the only input (screen readers and selection are untouched).
  const pieces = $derived(highlightPieces(parseInlineCommands(message, skills)));
  const hasMarks = $derived(pieces.some((p) => p.mark));
  const usedSkills = $derived(hasMarks ? draftSkills(message, skills) : []);
  let mirrorEl = $state<HTMLDivElement | null>(null);
  const syncScroll = () => {
    if (mirrorEl && inputEl) mirrorEl.scrollTop = inputEl.scrollTop;
  };
  // A mirror that appears (first recognized token) starts at the textarea's scroll offset.
  $effect(() => {
    if (mirrorEl) syncScroll();
  });
  const syncCaret = () => {
    if (inputEl) caret = inputEl.selectionStart ?? message.length;
  };

  /** A prompt from the library goes in at the caret (or over the selection); the draft stays. */
  async function insertPrompt(body: string) {
    const start = inputEl?.selectionStart ?? message.length;
    const end = inputEl?.selectionEnd ?? start;
    const r = insertAtCaret(message, start, end, body, { sep: body.includes("\n") ? "\n" : " " });
    message = r.text;
    caret = r.caret;
    await tick();
    inputEl?.focus();
    inputEl?.setSelectionRange(r.caret, r.caret);
  }
</script>

<div class="composer-wrap">
  {#if queued !== null}
    <ChatQueuedRow text={queued} {sending} onSendNow={onSendQueuedNow} onClear={onClearQueued} />
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="composer" class:dropping class:plan={mode === "plan"} data-mode={mode} data-slash-menu-keep ondragover={onDragOver} ondragleave={() => (dropping = false)} ondrop={onDrop}>
    {#if quickBar}{@render quickBar()}{/if}
    {#if attachBar}{@render attachBar()}{/if}
    {#if mode === "plan"}
      <p data-testid="plan-mode-note" class="planning" role="status">
        <Icon name="checklist" size="sm" />{modeHint("plan")}
      </p>
    {/if}
    <div class="field">
      {#if hasMarks}
        <div class="mirror" bind:this={mirrorEl} aria-hidden="true" data-testid="composer-highlights">{#each pieces as p, i (i)}{#if p.mark}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}{" "}</div>
      {/if}
      <textarea
        bind:this={inputEl}
        aria-label="Message"
        aria-describedby={usedSkills.length > 0 ? "composer-skills-note" : undefined}
        placeholder={sending ? "Reply in progress. Type to queue your next message" : "Message the agent"}
        rows="3"
        bind:value={message}
        onkeydown={onComposerKeydown}
        oninput={() => { syncCaret(); syncScroll(); }}
        onkeyup={syncCaret}
        onclick={syncCaret}
        onselect={syncCaret}
        onfocus={syncCaret}
        onscroll={syncScroll}
        onpaste={onPaste}
        data-slash-menu-keep
      ></textarea>
    </div>
    {#if usedSkills.length > 0}
      <p id="composer-skills-note" class="sr-only" aria-live="polite">Skills used with this message: {usedSkills.join(", ")}</p>
    {/if}
    <div class="composer-f">
      <ChatModeToggle {mode} onChange={onModeChange} />
      <span class="hint">
        <kbd>/</kbd> commands
        {#if sending}<kbd>Enter</kbd> queue <kbd>Esc</kbd> clear{:else}<kbd>Enter</kbd> send <kbd>Shift Enter</kbd> new line{/if}
      </span>
      {#if footerTools}{@render footerTools()}{/if}
      <PromptPickerButton
        types={["task", "snippet"]}
        defaultSaveType="task"
        onSelect={(body) => void insertPrompt(body)}
      />
      {#if sendAction === "stop"}<ChatPauseButton />{/if}
      <button
        type="button"
        class="send"
        class:stop={sendAction === "stop"}
        class:queue={sendAction === "queue"}
        disabled={interrupting || (sendAction === "send" && !hasText)}
        aria-busy={interrupting}
        aria-label={sendLabel}
        use:tooltip={sendAction === "queue" ? "Queue: sent when this reply finishes" : sendLabel}
        onclick={onSendButton}
      >
        {#if interrupting && $interruptPhase === "stopping"}
          <Icon name="clock" size="sm" /><span>Stopping…</span>
        {:else if sendAction === "stop"}
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
    position: relative;
    border: 1px solid var(--cortex-line-strong);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    transition: border-color var(--cortex-d-fast), box-shadow var(--cortex-d-fast);
  }
  /* Plan mode: a calm accent edge and wash, no motion (the live glow is reserved for running). */
  .composer.plan { border-color: var(--cortex-accent); background: color-mix(in srgb, var(--cortex-accent-tint) 40%, var(--cortex-surface-1)); }
  .composer.dropping { border-color: var(--cortex-accent); box-shadow: 0 0 0 3px var(--cortex-accent-tint); }
  .composer:focus-within { border-color: var(--cortex-accent); box-shadow: 0 0 0 3px var(--cortex-accent-tint); }
  .planning { display: flex; align-items: center; gap: 6px; margin: 8px 14px 0; font-size: var(--cortex-t-xs); color: var(--cortex-accent); }
  .field { position: relative; }
  /* The mirror and the textarea share every metric that affects wrapping. */
  textarea, .mirror {
    display: block;
    width: 100%;
    min-height: 64px;
    max-height: 40vh;
    padding: 10px 14px;
    border: 0;
    font: 400 var(--cortex-t-md) / var(--cortex-lh-read) var(--cortex-font-ui);
    letter-spacing: normal;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    scrollbar-gutter: stable;
  }
  textarea {
    position: relative;
    background: transparent;
    color: var(--cortex-text);
    resize: none;
    outline: none;
  }
  .mirror {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: transparent;
    pointer-events: none;
  }
  /* Background only: no padding, border or weight change, so the mirror never shifts a glyph. */
  .mirror mark {
    color: transparent;
    background: var(--cortex-accent-tint);
    border-radius: 3px;
    box-shadow: inset 0 -1px 0 var(--cortex-accent);
  }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
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
