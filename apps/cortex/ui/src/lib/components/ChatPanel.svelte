<script lang="ts">
  import { chatStore, type ChatTurn } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import ChatTurnTimeline from "$lib/components/ChatTurnTimeline.svelte";

  interface Props {
    sessionId: string;
    turns: ChatTurn[];
    sending: boolean;
    error: string | null;
  }
  const { sessionId, turns, sending, error }: Props = $props();

  let message = $state("");
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let lastSent = $state("");

  const sessionTokenTotal = $derived(
    turns.reduce((sum, t) => sum + (t.streaming ? (t.liveTokens ?? 0) : (t.tokensUsed ?? 0)), 0),
  );
  const sessionCostTotal = $derived(
    turns.reduce((sum, t) => sum + (t.streaming ? (t.liveCost ?? 0) : (t.costUsd ?? 0)), 0),
  );

  $effect(() => {
    void sessionId;
    message = "";
  });

  // Smart autoscroll: follow the stream only while the user is pinned at the bottom.
  let atBottom = $state(true);
  function onScroll() {
    if (!scrollEl) return;
    atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
  }
  $effect(() => {
    void turns; // track every store update (deltas re-create the array)
    if (turns.length > 0 && scrollEl && atBottom) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  async function submit() {
    const text = message.trim();
    if (!text || sending) return;
    lastSent = text;
    message = "";
    await chatStore.sendMessageStream(text);
    inputEl?.focus();
  }

  async function retry() {
    if (!lastSent || sending) return;
    await chatStore.sendMessageStream(lastSent);
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  // ── History utilities (rewind / rerun / fork / clear / compact) ───────────
  let busyAction = $state<string | null>(null);
  const lastAssistantId = $derived([...turns].reverse().find((t) => t.role === "assistant")?.id);

  async function runAction(label: string, fn: () => Promise<void>, done?: string) {
    if (sending || busyAction) return;
    busyAction = label;
    try {
      await fn();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(`${label} failed`, e instanceof Error ? e.message : String(e));
    } finally {
      busyAction = null;
    }
  }

  const rewindTo = (turnId: number) =>
    runAction("Rewind", async () => {
      if (!confirm("Rewind here? This message and everything after it is removed from the chat.")) return;
      await chatStore.rewind(turnId);
    });

  /** Edit & resend: rewind to the message, drop its text back into the input. */
  const editFrom = (turnId: number) =>
    runAction("Edit", async () => {
      const text = await chatStore.rewind(turnId);
      message = text;
      inputEl?.focus();
    });

  const rerunLast = () => runAction("Rerun", () => chatStore.rerun());
  const forkFrom = (turnId?: number) => runAction("Fork", async () => void (await chatStore.fork(turnId)), "Forked into a new chat");
  const clearChat = () =>
    runAction("Clear", async () => {
      if (!confirm("Clear this conversation's context? Messages are deleted; the session and its config stay.")) return;
      await chatStore.clearContext();
    });
  const compactChat = () =>
    runAction("Compact", async () => {
      const collapsed = await chatStore.compact();
      toast.success(collapsed > 0 ? "Context compacted" : "Nothing to compact yet");
    });

  async function copyUserMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copied", "Message copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  async function copyAllConversation() {
    try {
      const formatted = turns
        .map((turn: ChatTurn) => {
          const speaker = turn.role === "user" ? "You" : "Assistant";
          return `**${speaker}**: ${turn.content}`;
        })
        .join("\n\n");
      await navigator.clipboard.writeText(formatted);
      toast.success("Copied", "Conversation copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  const bubbleUser =
    "max-w-[80%] rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-[var(--cortex-text)]";
  const bubbleAsst =
    "max-w-[80%] rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 text-[var(--cortex-text)]";
</script>

<div
  class="flex h-full min-h-0 w-full flex-col bg-surface-container-lowest/90 text-on-surface backdrop-blur-md dark:bg-surface/90"
>
  <div
    class="flex-shrink-0 border-b border-[color:var(--cortex-border)] px-4 py-3 flex items-center justify-between"
  >
    <h2 class="text-[11px] uppercase tracking-widest font-mono text-[var(--cortex-text-muted)]">
      Conversation
    </h2>
    <div class="flex items-center gap-3">
      {#if sessionTokenTotal > 0}
        <span class="font-mono text-[9px] text-[var(--cortex-text-muted)] tabular-nums">
          {sessionTokenTotal.toLocaleString()} tok
          {#if sessionCostTotal > 0}
            · ${(sessionCostTotal * 100).toFixed(3)}¢
          {/if}
        </span>
      {/if}
      {#if turns.length > 0}
        {#each [
          { label: "Fork", icon: "call_split", title: "Fork this chat into a new session", run: () => forkFrom() },
          { label: "Compact", icon: "compress", title: "Summarise older messages to shrink context", run: compactChat },
          { label: "Clear", icon: "delete_sweep", title: "Clear conversation context", run: clearChat },
        ] as action (action.label)}
          <button
            type="button"
            title={action.title}
            disabled={sending || busyAction !== null}
            onclick={() => void action.run()}
            class="flex items-center gap-1 px-2 py-1 rounded-md border border-[color:var(--cortex-border)]
                   text-[var(--cortex-text-muted)] font-mono text-[9px] uppercase tracking-wider
                   hover:text-[var(--cortex-text)] hover:bg-[var(--cortex-surface-mid)] transition-colors cursor-pointer
                   disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span class="material-symbols-outlined text-[14px] leading-none">{action.icon}</span>
            {busyAction === action.label ? "…" : action.label}
          </button>
        {/each}
        <button
          type="button"
          onclick={() => void copyAllConversation()}
          class="flex items-center gap-1 px-2 py-1 rounded-md border border-secondary/25
                 text-secondary/90 font-mono text-[9px] uppercase tracking-wider
                 bg-surface-container-low/90 hover:bg-secondary/10 hover:border-secondary/40
                 transition-colors cursor-pointer shadow-sm"
          aria-label="Copy all conversation"
        >
          <span class="material-symbols-outlined text-[14px] leading-none">content_copy</span>
          Copy all
        </button>
      {/if}
    </div>
  </div>

  <div
    bind:this={scrollEl}
    onscroll={onScroll}
    class="flex-1 space-y-4 overflow-y-auto p-4 font-mono text-[12px]"
  >
    {#if turns.length === 0}
      <div class="flex h-full items-center justify-center">
        <p class="text-[11px] italic text-[var(--cortex-text-muted)]">Start a conversation…</p>
      </div>
    {:else}
      {#each turns as turn (turn.id)}
        <div class="flex gap-2 {turn.role === 'user' ? 'justify-end' : 'justify-start'}">
          <div class="{turn.role === 'user' ? bubbleUser : bubbleAsst} relative group">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span
                class="text-[9px] uppercase tracking-widest {turn.role === 'user'
                  ? 'text-primary/80'
                  : 'text-secondary/80'}"
              >
                {turn.role}
              </span>
              {#if turn.streaming && (turn.liveTokens ?? 0) > 0}
                <span class="font-mono text-[9px] text-[var(--cortex-text-muted)] tabular-nums animate-pulse">
                  {(turn.liveTokens ?? 0).toLocaleString()} tok
                  {#if (turn.liveCost ?? 0) > 0}
                    · ${((turn.liveCost ?? 0) * 100).toFixed(3)}¢
                  {/if}
                </span>
              {:else if turn.tokensUsed > 0}
                <span class="text-[9px] text-[var(--cortex-text-muted)]">{turn.tokensUsed} tok</span>
              {/if}
              {#if turn.steps != null && turn.steps > 0}
                <span class="text-[9px] text-[var(--cortex-text-muted)]">{turn.steps} steps</span>
              {/if}
              {#if turn.cancelled}
                <span class="font-mono text-[9px] text-[var(--cortex-text-muted)] italic">stopped</span>
              {/if}
            </div>
            {#if turn.role === "assistant"}
              <div class="flex gap-2 items-start">
                <div class="flex-1 min-w-0">
                  <ChatTurnTimeline {turn} />
                  {#if turn.streaming && !turn.liveText && !turn.content}
                    <p class="mb-2 text-[9px] font-mono italic text-[var(--cortex-text-muted)]">
                      {turn.streamProgress && turn.streamProgress.maxIterations > 0
                        ? `Working… step ${turn.streamProgress.iteration}/${turn.streamProgress.maxIterations}`
                        : "Thinking"}<span class="ml-0.5 inline-block h-2.5 w-1.5 animate-pulse rounded-sm bg-secondary/60 align-middle"></span>
                    </p>
                  {/if}
                  {#if turn.streaming && turn.liveText}
                    <!-- Streaming text is NOT yet known to be the answer (it may turn out to be thinking
                         before a tool call): keep it muted + unrendered; markdown renders only once the
                         run finishes and the final answer is known. -->
                    <p class="m-0 whitespace-pre-wrap text-[11px] italic leading-relaxed text-[var(--cortex-text-muted)]">{turn.liveText}<span class="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-secondary/60 align-middle"></span></p>
                  {:else if turn.streaming && turn.content}
                    <p class="whitespace-pre-wrap text-[11px] leading-relaxed m-0">{turn.content}<span class="inline-block w-1.5 h-3.5 ml-0.5 bg-secondary/80 animate-pulse rounded-sm align-middle"></span></p>
                  {:else if turn.streaming}
                    <!-- no text yet: thinking indicator above covers this state -->
                  {:else}
                    <GuardedMarkdown markdown={turn.content} showCopy={true} class="text-[11px]" />
                  {/if}
                  {#if turn.liveObject && Object.keys(turn.liveObject).length > 0}
                    <!-- Op E: partial/final structured-output preview, updates live as it streams. -->
                    <div class="mt-2 rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-mid)]/40 p-2">
                      <div class="mb-1 flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[13px] text-secondary/80">data_object</span>
                        <span class="font-mono text-[9px] uppercase tracking-wide text-[var(--cortex-text-muted)]">
                          Structured output
                        </span>
                      </div>
                      <pre class="m-0 overflow-x-auto font-mono text-[10px] leading-snug text-[var(--cortex-text)] whitespace-pre">{JSON.stringify(turn.liveObject, null, 2)}</pre>
                    </div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="flex gap-2 items-start">
                <p class="flex-1 whitespace-pre-wrap text-[11px] leading-relaxed">{turn.content}</p>
                <button
                  type="button"
                  onclick={() => void copyUserMessage(turn.content)}
                  class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity
                         flex items-center justify-center px-2 py-1 rounded-md
                         border border-primary/25 text-primary/90 font-mono text-[9px]
                         uppercase tracking-wider bg-primary/5 hover:bg-primary/15
                         hover:border-primary/40 cursor-pointer shadow-sm"
                  aria-label="Copy message"
                  title="Copy message"
                >
                  <span class="material-symbols-outlined text-[14px] leading-none">content_copy</span>
                </button>
              </div>
            {/if}
            {#if !turn.streaming && !sending && busyAction === null}
              <div class="mt-1.5 flex flex-wrap gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {#each (turn.role === "user"
                  ? [
                      { label: "Edit", icon: "edit", title: "Rewind to here and edit this message", run: () => editFrom(turn.id) },
                      { label: "Rewind", icon: "undo", title: "Remove this message and everything after", run: () => rewindTo(turn.id) },
                    ]
                  : [
                      ...(turn.id === lastAssistantId
                        ? [{ label: "Rerun", icon: "refresh", title: "Regenerate this answer", run: () => rerunLast() }]
                        : []),
                      { label: "Fork", icon: "call_split", title: "Fork a new chat from here", run: () => forkFrom(turn.id) },
                    ]) as action (action.label)}
                  <button
                    type="button"
                    title={action.title}
                    onclick={() => void action.run()}
                    class="flex cursor-pointer items-center gap-1 rounded border border-[color:var(--cortex-border)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)]"
                  >
                    <span class="material-symbols-outlined text-[12px] leading-none">{action.icon}</span>
                    {action.label}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if error}
    <div
      class="flex-shrink-0 border-t border-error/30 bg-error/10 px-4 py-2 font-mono text-[10px] text-error flex items-center justify-between gap-2"
    >
      <span>{error}</span>
      {#if lastSent}
        <button
          type="button"
          onclick={() => void retry()}
          class="flex-shrink-0 rounded border border-error/40 px-2 py-0.5 text-[9px] uppercase tracking-wider hover:bg-error/20"
        >retry</button>
      {/if}
    </div>
  {/if}

  <div
    class="flex flex-shrink-0 items-end gap-2 border-t border-[color:var(--cortex-border)] p-3"
  >
    <textarea
      bind:this={inputEl}
      class="min-h-[4.5rem] flex-1 resize-none rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 font-mono text-[12px] text-[var(--cortex-text)] placeholder:text-[var(--cortex-text-muted)] focus:border-primary/40 focus:outline-none"
      placeholder="Message… (Enter to send, Shift+Enter for newline)"
      rows="3"
      bind:value={message}
      onkeydown={onKeydown}
      disabled={sending}
    ></textarea>
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
      disabled={!sending && !message.trim()}
      class="flex-shrink-0 cursor-pointer rounded-lg border border-primary/35 bg-primary/10 px-4 py-2 font-mono text-[11px] uppercase text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
      onclick={() => (sending ? chatStore.stop() : void submit())}
    >
      {#if sending}
        <span class="material-symbols-outlined text-sm">stop_circle</span>
      {:else}
        <span class="material-symbols-outlined text-sm">send</span>
      {/if}
    </button>
  </div>
</div>
