<script lang="ts">
  /**
   * Run-scoped desk chat: one persistent session per run (cached), linked via `runId`
   * for `buildRunTaskContext` on the server. Session options are fixed at creation;
   * "New thread" clears the cache and lets the user reconfigure before the next send.
   */
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { settings } from "$lib/stores/settings.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { CHAT_TOOL_PRESETS } from "$lib/inference-presets.js";
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import {
    forgetRunChatSession,
    peekRunChatSession,
    rememberRunChatSession,
  } from "$lib/run-chat-session-cache.js";

  interface Props {
    runId: string;
    provider?: string;
    model?: string;
  }
  let { runId, provider: runProvider, model: runModel }: Props = $props();

  let sessionId = $state<string | null>(null);
  let turns = $state<ChatTurn[]>([]);
  let sending = $state(false);
  let error = $state<string | null>(null);
  let hydrating = $state(true);
  let enableTools = $state(false);
  let selectedTools = $state<string[]>([]);
  let maxIterations = $state(12);

  let message = $state("");
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);

  function toggleTool(id: string) {
    if (selectedTools.includes(id)) selectedTools = selectedTools.filter((t) => t !== id);
    else selectedTools = [...selectedTools, id];
  }

  async function loadTurns(sid: string) {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sid)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { turns?: ChatTurn[] };
    turns = data.turns ?? [];
  }

  async function tryHydrateCache() {
    const cached = peekRunChatSession(runId);
    if (!cached) return false;
    const check = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(cached)}`);
    if (!check.ok) {
      forgetRunChatSession(runId);
      return false;
    }
    sessionId = cached;
    await loadTurns(cached);
    return true;
  }

  onMount(() => {
    settings.init();
    void (async () => {
      try {
        await tryHydrateCache();
      } finally {
        hydrating = false;
      }
    })();
  });

  async function createSessionForRun(): Promise<boolean> {
    settings.init();
    const p = runProvider?.trim() || settings.get().defaultProvider;
    const m = runModel?.trim() || settings.get().defaultModel;
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Run ${runId.slice(0, 8)}…`,
        runId,
        provider: p,
        ...(m ? { model: m } : {}),
        enableTools,
        ...(enableTools && selectedTools.length > 0 ? { tools: [...selectedTools] } : {}),
        ...(enableTools
          ? { maxIterations: Math.min(40, Math.max(1, Number(maxIterations) || 12)) }
          : {}),
      }),
    });
    const body = (await res.json()) as { sessionId?: string; error?: string };
    if (!res.ok || !body.sessionId) {
      toast.error(body.error ?? "Could not start chat session");
      return false;
    }
    sessionId = body.sessionId;
    rememberRunChatSession(runId, body.sessionId);
    return true;
  }

  function newThread() {
    if (sessionId) forgetRunChatSession(runId);
    sessionId = null;
    turns = [];
    error = null;
    message = "";
    toast.success("New thread — next message starts a fresh session");
  }

  async function submit() {
    const text = message.trim();
    if (!text || sending) return;
    if (!sessionId) {
      const ok = await createSessionForRun();
      if (!ok || !sessionId) return;
    }

    message = "";
    const optimisticTurn: ChatTurn = {
      id: Date.now(),
      role: "user",
      content: text,
      tokensUsed: 0,
      ts: Date.now(),
    };
    turns = [...turns, optimisticTurn];
    sending = true;
    error = null;

    const res = await fetch(
      `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId!)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      },
    );

    if (!res.ok) {
      const errBody = (await res.json()) as { error?: string };
      error = errBody.error ?? "Request failed";
      turns = turns.filter((t) => t.id !== optimisticTurn.id);
      sending = false;
      return;
    }

    const payload = (await res.json()) as {
      reply: string;
      tokensUsed: number;
      toolsUsed?: string[];
      steps?: number;
    };
    const assistantTurn: ChatTurn = {
      id: Date.now() + 1,
      role: "assistant",
      content: payload.reply,
      tokensUsed: payload.tokensUsed,
      ts: Date.now(),
      ...(payload.toolsUsed && payload.toolsUsed.length > 0 ? { toolsUsed: payload.toolsUsed } : {}),
      ...(payload.steps != null ? { steps: payload.steps } : {}),
    };
    turns = [...turns, assistantTurn];
    sending = false;
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  $effect(() => {
    if (turns.length > 0 && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  const field =
    "rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface)] px-2 py-1 text-[10px] font-mono text-[var(--cortex-text)]";
  const label = "font-mono text-[8px] uppercase tracking-widest text-[var(--cortex-text-muted)]";
  const bubbleUser =
    "max-w-[85%] rounded-md border border-primary/25 bg-primary/10 px-2 py-1.5 text-[var(--cortex-text)]";
  const bubbleAsst =
    "max-w-[85%] rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-2 py-1.5 text-[var(--cortex-text)]";
</script>

<div class="flex h-full min-h-0 flex-col bg-[var(--cortex-surface)] text-[var(--cortex-text)]">
  {#if hydrating}
    <div class="flex flex-1 items-center justify-center p-4">
      <p class="font-mono text-[10px] text-[var(--cortex-text-muted)]">Loading chat…</p>
    </div>
  {:else}
    <!-- Options: only before first in-memory session id (new thread clears). -->
    {#if !sessionId}
      <div
        class="flex-shrink-0 space-y-2 border-b border-[color:var(--cortex-border)] p-2"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="font-mono text-[9px] text-[var(--cortex-text-muted)]">
            Continues this run with the same debrief + event context as desk Chat. Provider/model default from run
            vitals or Settings.
          </p>
          <a
            href="/chat"
            class="shrink-0 font-mono text-[9px] text-primary underline decoration-primary/40"
          >Open full Chat</a>
        </div>
        <label class="flex cursor-pointer items-center gap-2 font-mono text-[10px]">
          <input type="checkbox" bind:checked={enableTools} class="accent-primary" />
          Enable tools (ReAct)
        </label>
        {#if enableTools}
          <div>
            <span class={label}>Tool allowlist</span>
            <div class="mt-1 flex flex-wrap gap-1">
              {#each CHAT_TOOL_PRESETS as t (t.id)}
                <button
                  type="button"
                  class="rounded border px-1.5 py-0.5 font-mono text-[8px] transition-colors border-[color:var(--cortex-border)] {selectedTools.includes(
                    t.id,
                  )
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'text-[var(--cortex-text-muted)]'}"
                  onclick={() => toggleTool(t.id)}
                >{t.label}</button>
              {/each}
            </div>
            <div class="mt-1 flex items-center gap-2">
              <span class={label}>Max iterations</span>
              <input type="number" min="1" max="40" class="{field} w-16" bind:value={maxIterations} />
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <div
        class="flex flex-shrink-0 items-center justify-between gap-2 border-b border-[color:var(--cortex-border)] px-2 py-1"
      >
        <span class="font-mono text-[9px] text-[var(--cortex-text-muted)]">Session locked — tools as started.</span>
        <button
          type="button"
          class="font-mono text-[9px] uppercase text-primary underline decoration-primary/40"
          onclick={newThread}
        >New thread</button>
      </div>
    {/if}

    <div bind:this={scrollEl} class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 font-mono text-[11px]">
      {#if turns.length === 0 && !sending}
        <p class="py-6 text-center text-[10px] italic text-[var(--cortex-text-muted)]">
          Ask about this run — context is injected automatically.
        </p>
      {:else}
        {#each turns as turn (turn.id)}
          <div class="flex {turn.role === 'user' ? 'justify-end' : 'justify-start'}">
            <div class={turn.role === "user" ? bubbleUser : bubbleAsst}>
              <div class="mb-0.5 flex flex-wrap gap-1.5 text-[8px] uppercase tracking-wide text-[var(--cortex-text-muted)]">
                <span>{turn.role}</span>
                {#if turn.tokensUsed > 0}<span>{turn.tokensUsed} tok</span>{/if}
                {#if turn.steps != null && turn.steps > 0}<span>{turn.steps} steps</span>{/if}
              </div>
              {#if turn.toolsUsed && turn.toolsUsed.length > 0}
                <div class="mb-1 flex flex-wrap gap-0.5 border-b border-[color:var(--cortex-border)] pb-1">
                  {#each turn.toolsUsed as tool (tool)}
                    <span class="rounded bg-[var(--cortex-surface-mid)] px-1 py-px text-[8px]">{tool}</span>
                  {/each}
                </div>
              {/if}
              <p class="whitespace-pre-wrap leading-snug">{turn.content}</p>
            </div>
          </div>
        {/each}
        {#if sending}
          <div class="flex justify-start">
            <div class={bubbleAsst}>
              <span class="text-[10px] italic text-[var(--cortex-text-muted)]">Thinking…</span>
            </div>
          </div>
        {/if}
      {/if}
    </div>

    {#if error}
      <div class="flex-shrink-0 border-t border-error/30 bg-error/10 px-2 py-1 font-mono text-[9px] text-error">
        {error}
      </div>
    {/if}

    <div class="flex flex-shrink-0 items-end gap-2 border-t border-[color:var(--cortex-border)] p-2">
      <textarea
        bind:this={inputEl}
        class="min-h-[3rem] flex-1 resize-none rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-2 py-1.5 font-mono text-[11px] text-[var(--cortex-text)] placeholder:text-[var(--cortex-text-muted)] focus:border-primary/40 focus:outline-none"
        placeholder="Message… (Enter to send)"
        rows="2"
        bind:value={message}
        onkeydown={onKeydown}
        disabled={sending}
      ></textarea>
      <button
        type="button"
        disabled={sending || !message.trim()}
        class="flex-shrink-0 rounded-md border border-primary/35 bg-primary/12 px-3 py-2 font-mono text-[10px] uppercase text-primary disabled:opacity-40"
        onclick={submit}
      >Send</button>
    </div>
  {/if}
</div>
