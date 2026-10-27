<script lang="ts">
  import ChatTurnTimeline from "$lib/components/ChatTurnTimeline.svelte";
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
  import ChatShellToolDisclaimer from "$lib/components/ChatShellToolDisclaimer.svelte";
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { streamAssistantTurn } from "$lib/stores/chat-stream.js";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";
import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
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
  let streamReasoningSteps = $state(false);
  let selectedTools = $state<string[]>([]);
  let maxIterations = $state(12);
  let strategy = $state("plan-execute-reflect");
  let strategySwitching = $state(true);
  let runtimeVerification = $state(true);
  let verificationStepReflect = $state(true);
  let contextSynthesis = $state<"auto" | "template" | "llm" | "none">("auto");
  let personaTraits = $state(
    "Think step-by-step, then call tools immediately when needed. Avoid repeating the same thought without acting.",
  );
  let terminalShellAdditionalCommands = $state("");
  let terminalShellAllowedCommands = $state("");

  const shellExecuteSelected = $derived(enableTools && selectedTools.includes("shell-execute"));

  let message = $state("");
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);


  function toggleTool(id: string) {
    if (selectedTools.includes(id)) {
      selectedTools = selectedTools.filter((t) => t !== id);
      if (id === "shell-execute") {
        terminalShellAdditionalCommands = "";
        terminalShellAllowedCommands = "";
      }
    } else {
      selectedTools = [...selectedTools, id];
    }
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
        ...(enableTools && streamReasoningSteps ? { streamReasoningSteps: true } : {}),
        ...(enableTools && selectedTools.length > 0 ? { tools: [...selectedTools] } : {}),
        ...(enableTools
          ? { maxIterations: Math.min(40, Math.max(1, Number(maxIterations) || 12)) }
          : {}),
        ...(enableTools ? { strategy } : {}),
        ...(enableTools ? { strategySwitching } : {}),
        ...(enableTools ? { runtimeVerification } : {}),
        ...(enableTools ? { verificationStep: verificationStepReflect ? "reflect" : "none" } : {}),
        ...(enableTools ? { contextSynthesis } : {}),
        ...(enableTools && personaTraits.trim().length > 0
          ? {
              persona: {
                enabled: true,
                role: "Tool-first problem solver",
                tone: "technical",
                traits: personaTraits.trim(),
                responseStyle: "structured",
              },
            }
          : {}),
        ...(shellExecuteSelected && terminalShellAdditionalCommands.trim() !== ""
          ? { terminalShellAdditionalCommands: terminalShellAdditionalCommands.trim() }
          : {}),
        ...(shellExecuteSelected && terminalShellAllowedCommands.trim() !== ""
          ? { terminalShellAllowedCommands: terminalShellAllowedCommands.trim() }
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
    const userTurnId = Date.now();
    const assistantTurnId = Date.now() + 1;
    const optimisticTurn: ChatTurn = { id: userTurnId, role: "user", content: text, tokensUsed: 0, ts: Date.now() };
    const assistantTurn: ChatTurn = { id: assistantTurnId, role: "assistant", content: "", tokensUsed: 0, ts: Date.now(), streaming: true };
    turns = [...turns, optimisticTurn, assistantTurn];
    sending = true;
    error = null;

    try {
      const outcome = await streamAssistantTurn({
        endpoint: `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId!)}/chat/stream`,
        body: { message: text },
        signal: new AbortController().signal,
        assistantTurnId,
        apply: (f) => {
          turns = f(turns);
        },
      });
      if (outcome.preStreamFailure !== undefined) {
        error = outcome.preStreamFailure;
        turns = turns.filter((t) => t.id !== userTurnId && t.id !== assistantTurnId);
      } else if (outcome.streamError !== undefined) {
        error = outcome.streamError;
      }
    } catch (e) {
      error = String(e);
      turns = turns.filter((t) => t.id !== userTurnId && t.id !== assistantTurnId);
    }

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
            {#if shellExecuteSelected}
              <div class="mt-2">
                <ChatShellToolDisclaimer
                  idSuffix="run-chat"
                  bind:additionalCommands={terminalShellAdditionalCommands}
                  bind:allowedCommands={terminalShellAllowedCommands}
                  compact={true}
                />
              </div>
            {/if}
            <div class="mt-1 flex items-center gap-2">
              <span class={label}>Max iterations</span>
              <input type="number" min="1" max="40" class="{field} w-16" bind:value={maxIterations} />
            </div>
            <div class="mt-1 grid gap-1 sm:grid-cols-2">
              <div>
                <span class={label}>Strategy</span>
                <select class={field} bind:value={strategy}>
                  <option value="plan-execute-reflect">plan-execute-reflect</option>
                  <option value="reactive">reactive</option>
                  <option value="adaptive">adaptive</option>
                  <option value="tree-of-thought">tree-of-thought</option>
                  <option value="reflexion">reflexion</option>
                </select>
              </div>
              <div>
                <span class={label}>Context synthesis</span>
                <select class={field} bind:value={contextSynthesis}>
                  <option value="auto">auto</option>
                  <option value="template">template</option>
                  <option value="llm">llm</option>
                  <option value="none">none</option>
                </select>
              </div>
            </div>
            <label class="mt-1 flex items-center gap-2 font-mono text-[9px]">
              <input type="checkbox" bind:checked={strategySwitching} class="accent-primary" />
              Strategy switching
            </label>
            <label class="mt-1 flex items-center gap-2 font-mono text-[9px]">
              <input type="checkbox" bind:checked={streamReasoningSteps} class="accent-primary" />
              Stream reasoning steps live
            </label>
            <label class="mt-1 flex items-center gap-2 font-mono text-[9px]">
              <input type="checkbox" bind:checked={runtimeVerification} class="accent-primary" />
              Runtime verification
            </label>
            <label class="mt-1 flex items-center gap-2 font-mono text-[9px]">
              <input type="checkbox" bind:checked={verificationStepReflect} class="accent-primary" />
              Reflect verification
            </label>
            <div class="mt-1">
              <span class={label}>Persona instructions</span>
              <textarea
                class="{field} w-full resize-y"
                rows="2"
                bind:value={personaTraits}
                placeholder="Think step-by-step then call tools immediately..."
              ></textarea>
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
              {#if turn.role === "assistant"}
                <ChatTurnTimeline {turn} compact />
                {#if turn.streaming && !turn.liveText && !turn.content}
                  <p class="mb-1 text-[8px] font-mono italic text-[var(--cortex-text-muted)]">
                    {turn.streamProgress && turn.streamProgress.maxIterations > 0
                      ? `Working… step ${turn.streamProgress.iteration}/${turn.streamProgress.maxIterations}`
                      : "Thinking"}<span class="ml-0.5 inline-block h-2.5 w-1.5 animate-pulse rounded-sm bg-secondary/60 align-middle"></span>
                  </p>
                {/if}
                {#if turn.streaming && turn.liveText}
                  <!-- Muted + unrendered until the run finishes (see ChatPanel). -->
                  <p class="m-0 whitespace-pre-wrap text-[10px] italic leading-snug text-[var(--cortex-text-muted)]">{turn.liveText}<span class="ml-0.5 inline-block h-3 w-1 animate-pulse rounded-sm bg-secondary/60 align-middle"></span></p>
                {:else if turn.streaming && turn.content}
                  <p class="whitespace-pre-wrap leading-snug text-[11px]">{turn.content}<span class="inline-block w-1 h-3 ml-0.5 bg-secondary/80 animate-pulse rounded-sm align-middle"></span></p>
                {:else if turn.streaming}
                  <!-- awaiting first token: thinking indicator above covers this state -->
                {:else}
                  <GuardedMarkdown markdown={turn.content} showCopy={true} class="text-[10px]" />
                {/if}
              {:else}
                <p class="whitespace-pre-wrap leading-snug">{turn.content}</p>
              {/if}
            </div>
          </div>
        {/each}
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
        disabled={sending || !message.trim()}
        class="flex-shrink-0 rounded-md border border-primary/35 bg-primary/10 px-3 py-2 font-mono text-[10px] uppercase text-primary disabled:opacity-40"
        onclick={submit}
      >Send</button>
    </div>
  {/if}
</div>
