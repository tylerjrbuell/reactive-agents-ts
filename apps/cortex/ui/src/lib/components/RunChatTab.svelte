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
  import ChatShellToolDisclaimer from "$lib/components/ChatShellToolDisclaimer.svelte";
  import type { ChatTurn, AgentStreamEvent, ReasoningStep } from "$lib/stores/chat-store.js";
  import MarkdownRich from "$lib/components/MarkdownRich.svelte";
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
  let expandedSteps = $state<Set<number>>(new Set());

  function mergeThoughtText(previous: string | undefined, incoming: string): string {
    const prev = (previous ?? "").trim();
    const next = incoming.trim();

    if (!prev) return next;
    if (!next) return prev;
    if (next.startsWith(prev) || prev === next) return next;
    if (prev.endsWith(next)) return prev;

    return `${prev}\n${next}`;
  }

  function appendThoughtDelta(previous: string | undefined, delta: string): string {
    return `${previous ?? ""}${delta}`;
  }

  function toggleSteps(turnId: number) {
    expandedSteps = new Set(
      expandedSteps.has(turnId)
        ? [...expandedSteps].filter((id) => id !== turnId)
        : [...expandedSteps, turnId],
    );
  }

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
      const res = await fetch(
        `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId!)}/chat/stream`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) },
      );

      if (!res.ok || !res.body) {
        let errMsg = `HTTP ${res.status}`;
        try { errMsg = ((await res.json()) as { error?: string }).error ?? errMsg; } catch { /* ignore */ }
        error = errMsg;
        turns = turns.filter((t) => t.id !== userTurnId && t.id !== assistantTurnId);
        sending = false;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let tokensUsed = 0;
      let toolsUsed: string[] = [];
      let steps = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) { buffer += decoder.decode(); break; }
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts[parts.length - 1];

        for (let i = 0; i < parts.length - 1; i++) {
          const msg = parts[i].trim();
          if (!msg) continue;
          for (const line of msg.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const event = JSON.parse(jsonStr) as AgentStreamEvent;
              if (event._tag === "TextDelta") {
                const delta = (event as any).text as string;
                turns = turns.map((t) => {
                  if (t.id !== assistantTurnId) return t;

                  const existing = t.reasoningSteps ?? [];
                  if (existing.length === 0) {
                    return { ...t, content: t.content + delta };
                  }

                  const currentIteration =
                    t.streamProgress?.iteration ??
                    existing[existing.length - 1]?.iteration ??
                    1;
                  const idx = existing.findIndex((r) => r.iteration === currentIteration);

                  if (idx >= 0) {
                    const prev = existing[idx]!;
                    const next: ReasoningStep = {
                      ...prev,
                      thought: appendThoughtDelta(prev.thought, delta),
                    };
                    return { ...t, reasoningSteps: existing.map((r, i) => (i === idx ? next : r)) };
                  }

                  return {
                    ...t,
                    reasoningSteps: [
                      ...existing,
                      {
                        iteration: currentIteration,
                        maxIterations: t.streamProgress?.maxIterations ?? 0,
                        thought: appendThoughtDelta(undefined, delta),
                      },
                    ],
                  };
                });
              } else if (event._tag === "IterationProgress") {
                const iter = (event as any).iteration as number;
                const max = (event as any).maxIterations as number;
                const tools = (event as any).toolsCalledThisStep as string[] | undefined;
                const step: ReasoningStep = { iteration: iter, maxIterations: max, ...(tools?.length ? { toolsCalledThisStep: tools } : {}) };
                turns = turns.map((t) => {
                  if (t.id !== assistantTurnId) return t;
                  const existing = t.reasoningSteps ?? [];
                  const idx = existing.findIndex((r) => r.iteration === iter);
                  const steps = idx >= 0
                    ? existing.map((r, i) =>
                        i === idx
                          ? {
                              ...step,
                              ...(r.thought && r.thought.trim().length > 0 ? { thought: r.thought } : {}),
                            }
                          : r,
                      )
                    : [...existing, step];
                  return { ...t, streamProgress: { iteration: iter, maxIterations: max }, reasoningSteps: steps };
                });
              } else if (event._tag === "ThoughtEmitted") {
                const thoughtEvent = event as { _tag: "ThoughtEmitted"; content: string; iteration: number };
                const iter = thoughtEvent.iteration;
                const thought = thoughtEvent.content;
                turns = turns.map((t) => {
                  if (t.id !== assistantTurnId) return t;
                  const existing = t.reasoningSteps ?? [];
                  const idx = existing.findIndex((r) => r.iteration === iter);
                  if (idx >= 0) {
                    const prev = existing[idx]!;
                    const next: ReasoningStep = {
                      ...prev,
                      thought: mergeThoughtText(prev.thought, thought),
                    };
                    return { ...t, reasoningSteps: existing.map((r, i) => (i === idx ? next : r)) };
                  }
                  return { ...t, reasoningSteps: [...existing, { iteration: iter, maxIterations: 0, thought }] };
                });
              } else if (event._tag === "StreamCompleted") {
                const done = event as {
                    metadata?: { tokensUsed?: number; iterations?: number; stepsCount?: number };
                  toolSummary?: Array<{ name: string }>;
                  output?: string;
                };
                tokensUsed = done.metadata?.tokensUsed ?? 0;
                  steps = done.metadata?.iterations ?? done.metadata?.stepsCount ?? 0;
                if (done.toolSummary && done.toolSummary.length > 0) {
                  toolsUsed = done.toolSummary.map((t: { name: string }) => t.name);
                }
                const output = done.output;
                if (output?.trim()) {
                  turns = turns.map((t) =>
                    t.id === assistantTurnId ? { ...t, content: output } : t,
                  );
                }
              } else if (event._tag === "StreamError") {
                error = (event as any).cause ?? "Stream error";
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }

      turns = turns.map((t) =>
        t.id === assistantTurnId
          ? { ...t, streaming: false, streamProgress: undefined, tokensUsed, ...(steps > 0 ? { steps } : {}), ...(toolsUsed.length > 0 ? { toolsUsed } : {}) }
          : t,
      );
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
              {#if turn.toolsUsed && turn.toolsUsed.length > 0}
                <div class="mb-1 flex flex-wrap gap-0.5 border-b border-[color:var(--cortex-border)] pb-1">
                  {#each turn.toolsUsed as tool (tool)}
                    <span class="rounded bg-[var(--cortex-surface-mid)] px-1 py-px text-[8px]">{tool}</span>
                  {/each}
                </div>
              {/if}
              {#if turn.role === "assistant"}
                {#if turn.reasoningSteps && turn.reasoningSteps.length > 0}
                  <div class="mb-1.5">
                    <button
                      type="button"
                      onclick={() => toggleSteps(turn.id)}
                      class="flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)] transition-colors cursor-pointer"
                    >
                      <span class="material-symbols-outlined text-[10px] leading-none transition-transform duration-150"
                        style="transform: rotate({expandedSteps.has(turn.id) ? '90deg' : '0deg'})">chevron_right</span>
                      {#if turn.streaming && turn.streamProgress}
                        Reasoning… step {turn.streamProgress.iteration}/{turn.streamProgress.maxIterations}
                      {:else}
                        {turn.reasoningSteps.length} reasoning {turn.reasoningSteps.length === 1 ? "step" : "steps"}
                      {/if}
                    </button>
                    {#if turn.streaming && turn.streamProgress}
                      <div class="mt-0.5 h-px rounded-full overflow-hidden bg-[var(--cortex-surface-mid)]">
                        <div
                          class="h-full bg-secondary/60 rounded-full transition-[width] duration-500 ease-out"
                          style="width: {Math.min(100, (turn.streamProgress.iteration / turn.streamProgress.maxIterations) * 100)}%"
                        ></div>
                      </div>
                    {/if}
                    {#if expandedSteps.has(turn.id)}
                      <div class="mt-1 ml-2.5 space-y-0.5 border-l border-[color:var(--cortex-border)] pl-2">
                        {#each turn.reasoningSteps as step (step.iteration)}
                          <div class="flex items-start gap-1.5 text-[8px] font-mono text-[var(--cortex-text-muted)]">
                            <span class="shrink-0 tabular-nums text-secondary/60">#{step.iteration}</span>
                            {#if step.thought && step.thought.trim().length > 0}
                              <div class="space-y-0.5">
                                <p class="whitespace-pre-wrap text-[9px] leading-snug text-[var(--cortex-text)]">{step.thought}</p>
                                {#if step.toolsCalledThisStep && step.toolsCalledThisStep.length > 0}
                                  <div class="flex flex-wrap gap-0.5">
                                    {#each step.toolsCalledThisStep as tool (tool)}
                                      <span class="rounded bg-[var(--cortex-surface-mid)] px-1 py-px text-[var(--cortex-text)]">{tool}</span>
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                            {:else if step.toolsCalledThisStep && step.toolsCalledThisStep.length > 0}
                              <div class="flex flex-wrap gap-0.5">
                                {#each step.toolsCalledThisStep as tool (tool)}
                                  <span class="rounded bg-[var(--cortex-surface-mid)] px-1 py-px text-[var(--cortex-text)]">{tool}</span>
                                {/each}
                              </div>
                            {:else}
                              <span class="italic">thinking…</span>
                            {/if}
                          </div>
                        {/each}
                        {#if turn.streaming}
                          <div class="flex items-center gap-1 text-[8px] font-mono text-[var(--cortex-text-muted)]">
                            <span class="inline-block w-1 h-1 rounded-full bg-secondary/60 animate-pulse"></span>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {:else if turn.streaming}
                  <p class="text-[8px] font-mono text-[var(--cortex-text-muted)] italic mb-1">
                    Thinking<span class="inline-block w-1.5 h-2.5 ml-0.5 bg-secondary/60 animate-pulse rounded-sm align-middle"></span>
                  </p>
                {/if}
                {#if turn.streaming && turn.reasoningSteps && turn.reasoningSteps.length > 0}
                  <p class="text-[9px] italic text-[var(--cortex-text-muted)]">Drafting final response…</p>
                {:else if turn.streaming && !turn.content}
                  <!-- awaiting first token -->
                {:else if turn.streaming}
                  <p class="whitespace-pre-wrap leading-snug text-[11px]">{turn.content}<span class="inline-block w-1 h-3 ml-0.5 bg-secondary/80 animate-pulse rounded-sm align-middle"></span></p>
                {:else}
                  <MarkdownRich markdown={turn.content} showCopy={true} class="text-[10px]" />
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
      <button
        type="button"
        disabled={sending || !message.trim()}
        class="flex-shrink-0 rounded-md border border-primary/35 bg-primary/12 px-3 py-2 font-mono text-[10px] uppercase text-primary disabled:opacity-40"
        onclick={submit}
      >Send</button>
    </div>
  {/if}
</div>
