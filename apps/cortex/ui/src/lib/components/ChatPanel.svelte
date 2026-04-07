<script lang="ts">
  import { chatStore, type ChatTurn } from "$lib/stores/chat-store.js";

  interface Props {
    sessionId: string;
    turns: ChatTurn[];
    sending: boolean;
    error: string | null;
  }
  const { sessionId, turns, sending, error } = $props();

  let message = $state("");
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    void sessionId;
    message = "";
  });

  $effect(() => {
    if (turns.length > 0 && scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  async function submit() {
    const text = message.trim();
    if (!text || sending) return;
    message = "";
    await chatStore.sendMessage(text);
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  const bubbleUser =
    "max-w-[80%] rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-[var(--cortex-text)]";
  const bubbleAsst =
    "max-w-[80%] rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 text-[var(--cortex-text)]";
</script>

<div
  class="flex h-full min-h-0 w-full flex-col bg-surface-container-lowest/88 text-on-surface backdrop-blur-md dark:bg-surface/92"
>
  <div
    bind:this={scrollEl}
    class="flex-1 space-y-4 overflow-y-auto p-4 font-mono text-[12px]"
  >
    {#if turns.length === 0}
      <div class="flex h-full items-center justify-center">
        <p class="text-[11px] italic text-[var(--cortex-text-muted)]">Start a conversation…</p>
      </div>
    {:else}
      {#each turns as turn (turn.id)}
        <div class="flex gap-2 {turn.role === 'user' ? 'justify-end' : 'justify-start'}">
          <div class={turn.role === "user" ? bubbleUser : bubbleAsst}>
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span
                class="text-[9px] uppercase tracking-widest {turn.role === 'user'
                  ? 'text-primary/80'
                  : 'text-secondary/80'}"
              >
                {turn.role}
              </span>
              {#if turn.tokensUsed > 0}
                <span class="text-[9px] text-[var(--cortex-text-muted)]">{turn.tokensUsed} tok</span>
              {/if}
              {#if turn.steps != null && turn.steps > 0}
                <span class="text-[9px] text-[var(--cortex-text-muted)]">{turn.steps} steps</span>
              {/if}
            </div>
            {#if turn.toolsUsed && turn.toolsUsed.length > 0}
              <div
                class="mb-2 flex flex-wrap gap-1 border-b border-[color:var(--cortex-border)] pb-2 font-mono text-[9px] text-[var(--cortex-text-muted)]"
              >
                {#each turn.toolsUsed as tool (tool)}
                  <span class="rounded bg-[var(--cortex-surface-mid)] px-1.5 py-0.5 text-[var(--cortex-text)]"
                    >{tool}</span
                  >
                {/each}
              </div>
            {/if}
            <p class="whitespace-pre-wrap text-[11px] leading-relaxed">{turn.content}</p>
          </div>
        </div>
      {/each}
      {#if sending}
        <div class="flex justify-start">
          <div
            class="rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2"
          >
            <span class="text-[11px] italic text-[var(--cortex-text-muted)]">Thinking…</span>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  {#if error}
    <div
      class="flex-shrink-0 border-t border-error/30 bg-error/10 px-4 py-2 font-mono text-[10px] text-error"
    >
      {error}
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
    <button
      type="button"
      disabled={sending || !message.trim()}
      class="flex-shrink-0 cursor-pointer rounded-lg border border-primary/35 bg-primary/12 px-4 py-2 font-mono text-[11px] uppercase text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
      onclick={submit}
    >
      {#if sending}
        <span class="material-symbols-outlined text-sm">hourglass_empty</span>
      {:else}
        <span class="material-symbols-outlined text-sm">send</span>
      {/if}
    </button>
  </div>
</div>
