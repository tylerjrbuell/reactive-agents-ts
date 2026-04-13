<script lang="ts">
  import { chatStore, type ChatTurn } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import MarkdownRich from "$lib/components/MarkdownRich.svelte";

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
  let expandedSteps = $state<Set<number>>(new Set());

  function toggleSteps(turnId: number) {
    expandedSteps = new Set(
      expandedSteps.has(turnId)
        ? [...expandedSteps].filter((id) => id !== turnId)
        : [...expandedSteps, turnId],
    );
  }

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
    await chatStore.sendMessageStream(text);
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

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
  class="flex h-full min-h-0 w-full flex-col bg-surface-container-lowest/88 text-on-surface backdrop-blur-md dark:bg-surface/92"
>
  <div
    class="flex-shrink-0 border-b border-[color:var(--cortex-border)] px-4 py-3 flex items-center justify-between"
  >
    <h2 class="text-[11px] uppercase tracking-widest font-mono text-[var(--cortex-text-muted)]">
      Conversation
    </h2>
    {#if turns.length > 0}
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
          <div class="{turn.role === 'user' ? bubbleUser : bubbleAsst} relative group">
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
            {#if turn.role === "assistant"}
              <div class="flex gap-2 items-start">
                <div class="flex-1 min-w-0">
                  {#if turn.reasoningSteps && turn.reasoningSteps.length > 0}
                    <div class="mb-2">
                      <button
                        type="button"
                        onclick={() => toggleSteps(turn.id)}
                        class="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)] transition-colors cursor-pointer"
                      >
                        <span class="material-symbols-outlined text-[11px] leading-none transition-transform duration-150"
                          style="transform: rotate({expandedSteps.has(turn.id) ? '90deg' : '0deg'})"
                        >chevron_right</span>
                        {#if turn.streaming && turn.streamProgress}
                          Reasoning… step {turn.streamProgress.iteration}/{turn.streamProgress.maxIterations}
                        {:else}
                          {turn.reasoningSteps.length} reasoning {turn.reasoningSteps.length === 1 ? "step" : "steps"}
                        {/if}
                      </button>
                      {#if turn.streaming && turn.streamProgress}
                        <div class="mt-1 h-px rounded-full overflow-hidden bg-[var(--cortex-surface-mid)]">
                          <div
                            class="h-full bg-secondary/60 rounded-full transition-[width] duration-500 ease-out"
                            style="width: {Math.min(100, (turn.streamProgress.iteration / turn.streamProgress.maxIterations) * 100)}%"
                          ></div>
                        </div>
                      {/if}
                      {#if expandedSteps.has(turn.id)}
                        <div class="mt-1.5 ml-3 space-y-1 border-l border-[color:var(--cortex-border)] pl-3">
                          {#each turn.reasoningSteps as step (step.iteration)}
                            <div class="flex items-start gap-2 text-[9px] font-mono text-[var(--cortex-text-muted)]">
                              <span class="shrink-0 tabular-nums text-secondary/60">#{step.iteration}</span>
                              {#if step.thought && step.thought.trim().length > 0}
                                <div class="space-y-1">
                                  <p class="whitespace-pre-wrap text-[10px] leading-relaxed text-[var(--cortex-text)]">{step.thought}</p>
                                  {#if step.toolsCalledThisStep && step.toolsCalledThisStep.length > 0}
                                    <div class="flex flex-wrap gap-1">
                                      {#each step.toolsCalledThisStep as tool (tool)}
                                        <span class="rounded bg-[var(--cortex-surface-mid)] px-1 py-0.5 text-[var(--cortex-text)]">{tool}</span>
                                      {/each}
                                    </div>
                                  {/if}
                                </div>
                              {:else if step.toolsCalledThisStep && step.toolsCalledThisStep.length > 0}
                                <div class="flex flex-wrap gap-1">
                                  {#each step.toolsCalledThisStep as tool (tool)}
                                    <span class="rounded bg-[var(--cortex-surface-mid)] px-1 py-0.5 text-[var(--cortex-text)]">{tool}</span>
                                  {/each}
                                </div>
                              {:else}
                                <span class="italic">thinking…</span>
                              {/if}
                            </div>
                          {/each}
                          {#if turn.streaming}
                            <div class="flex items-center gap-1 text-[9px] font-mono text-[var(--cortex-text-muted)]">
                              <span class="inline-block w-1 h-1 rounded-full bg-secondary/60 animate-pulse"></span>
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {:else if turn.streaming}
                    <p class="text-[9px] font-mono text-[var(--cortex-text-muted)] italic mb-2">
                      Thinking<span class="inline-block w-1.5 h-2.5 ml-0.5 bg-secondary/60 animate-pulse rounded-sm align-middle"></span>
                    </p>
                  {/if}
                  {#if turn.streaming && turn.reasoningSteps && turn.reasoningSteps.length > 0}
                    <p class="text-[10px] italic text-[var(--cortex-text-muted)]">Drafting final response…</p>
                  {:else if turn.streaming && !turn.content}
                    <!-- content not yet started -->
                  {:else if turn.streaming}
                    <p class="whitespace-pre-wrap text-[11px] leading-relaxed m-0">{turn.content}<span class="inline-block w-1.5 h-3.5 ml-0.5 bg-secondary/80 animate-pulse rounded-sm align-middle"></span></p>
                  {:else}
                    <MarkdownRich markdown={turn.content} showCopy={true} class="text-[11px]" />
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
          </div>
        </div>
      {/each}
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
