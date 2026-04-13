<script lang="ts">
  import { onMount } from "svelte";
  import { chatStore, type ChatSession } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { settings, type CortexSettings } from "$lib/stores/settings.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { fetchModelsForProvider, type UiModelOption } from "$lib/framework-models.js";
  import { CHAT_PROVIDERS, CHAT_TOOL_PRESETS, type ChatProviderId } from "$lib/inference-presets.js";
  import ChatShellToolDisclaimer from "$lib/components/ChatShellToolDisclaimer.svelte";

  interface Props {
    sessions: ChatSession[];
    activeSessionId: string | null;
    onSelectSession: (id: string) => void;
  }
  const { sessions, activeSessionId, onSelectSession } = $props();

  type RunOption = { runId: string; label: string };

  let showNewForm = $state(false);
  let newName = $state("");
  let newProvider = $state<string>("anthropic");
  let newModel = $state("");
  let newSystemPrompt = $state("");
  let creating = $state(false);
  let enableTools = $state(false);
  let streamReasoningSteps = $state(false);
  let selectedTools = $state<string[]>([]);
  let maxChatIterations = $state(12);
  let reasoningStrategy = $state("plan-execute-reflect");
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
  const activeSession = $derived(
    activeSessionId
      ? sessions.find((s: ChatSession) => s.sessionId === activeSessionId) ?? null
      : null,
  );

  let runs = $state<RunOption[]>([]);
  let selectedRunId = $state("");

  let providerModelOptions = $state<UiModelOption[]>([]);
  let modelsListLoading = $state(false);
  let modelsListError = $state<string | null>(null);

  let renamingSessionId = $state<string | null>(null);
  let renameInputValue = $state("");
  let renamingInProgress = $state(false);

  async function loadChatModelOptions(p: string) {
    modelsListLoading = true;
    modelsListError = null;
    settings.init();
    const { options, error } = await fetchModelsForProvider(
      p,
      p === "ollama" ? settings.get().ollamaEndpoint : undefined,
    );
    providerModelOptions = options;
    modelsListError = error ?? null;
    modelsListLoading = false;
  }

  async function setProvider(p: string) {
    newProvider = p;
    newModel = "";
    await loadChatModelOptions(p);
    if (providerModelOptions[0]) newModel = providerModelOptions[0].value;
  }

  function hydrateFormFromSessionConfig(config: Record<string, unknown>) {
    newProvider = typeof config.provider === "string" && config.provider.trim() ? config.provider : newProvider;
    newModel = typeof config.model === "string" ? config.model : "";
    newSystemPrompt = typeof config.systemPrompt === "string" ? config.systemPrompt : "";
    enableTools = config.enableTools === true;
    streamReasoningSteps = config.streamReasoningSteps === true;
    selectedTools = Array.isArray(config.tools)
      ? config.tools.filter((t): t is string => typeof t === "string" && t.length > 0)
      : [];
    maxChatIterations =
      typeof config.maxIterations === "number" && config.maxIterations > 0 ? config.maxIterations : 16;
    reasoningStrategy =
      typeof config.strategy === "string" && config.strategy.trim()
        ? config.strategy.trim()
        : "plan-execute-reflect";
    strategySwitching = config.strategySwitching !== false;
    runtimeVerification = config.runtimeVerification !== false;
    verificationStepReflect = config.verificationStep !== "none";
    contextSynthesis =
      config.contextSynthesis === "auto" ||
      config.contextSynthesis === "template" ||
      config.contextSynthesis === "llm" ||
      config.contextSynthesis === "none"
        ? config.contextSynthesis
        : "auto";
    const persona =
      config.persona && typeof config.persona === "object" && !Array.isArray(config.persona)
        ? (config.persona as Record<string, unknown>)
        : undefined;
    if (persona && typeof persona.traits === "string") {
      personaTraits = persona.traits;
    } else {
      personaTraits =
        "Think step-by-step, then call tools immediately when needed. Avoid repeating the same thought without acting.";
    }
    terminalShellAdditionalCommands =
      typeof config.terminalShellAdditionalCommands === "string"
        ? config.terminalShellAdditionalCommands
        : "";
    terminalShellAllowedCommands =
      typeof config.terminalShellAllowedCommands === "string" ? config.terminalShellAllowedCommands : "";
  }

  function currentConfigPayload() {
    const verificationStep: "reflect" | "none" = verificationStepReflect ? "reflect" : "none";

    return {
      provider: newProvider,
      ...(newModel.trim() ? { model: newModel.trim() } : {}),
      ...(newSystemPrompt.trim() ? { systemPrompt: newSystemPrompt.trim() } : {}),
      ...(selectedRunId ? { runId: selectedRunId } : {}),
      enableTools,
      streamReasoningSteps: enableTools ? streamReasoningSteps : false,
      ...(enableTools && selectedTools.length > 0 ? { tools: [...selectedTools] } : {}),
      ...(enableTools && maxChatIterations > 0 ? { maxIterations: maxChatIterations } : {}),
      ...(enableTools ? { strategy: reasoningStrategy } : {}),
      ...(enableTools ? { strategySwitching } : {}),
      ...(enableTools ? { runtimeVerification } : {}),
      ...(enableTools ? { verificationStep } : {}),
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
    };
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

  onMount(() => {
    settings.init();
    const s: CortexSettings = settings.get();
    newProvider = s.defaultProvider;
    newModel = s.defaultModel;
    void loadChatModelOptions(newProvider);
    void (async () => {
      try {
        const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`);
        const list = (await res.json()) as Array<{
          runId: string;
          agentId: string;
          status: string;
          startedAt: number;
        }>;
        runs = list.map((r) => ({
          runId: r.runId,
          label: `${r.runId.slice(0, 8)}… · ${r.status}`,
        }));
      } catch {
        runs = [];
      }
    })();
  });

  async function onRunChange(runId: string) {
    selectedRunId = runId;
    if (!runId) return;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}`);
      if (!res.ok) return;
      const r = (await res.json()) as { provider?: string; model?: string };
      if (typeof r.provider === "string" && r.provider && CHAT_PROVIDERS.includes(r.provider as ChatProviderId)) {
        await setProvider(r.provider);
      }
      if (typeof r.model === "string" && r.model.trim()) {
        newModel = r.model.trim();
      }
    } catch {
      /* ignore */
    }
  }

  async function create() {
    if (creating) return;
    creating = true;
    try {
      await chatStore.createSession({
        name: newName || undefined,
        ...currentConfigPayload(),
      });
      showNewForm = false;
      newName = "";
      newSystemPrompt = "";
      selectedRunId = "";
    } catch (e) {
      toast.error("Failed to create session: " + String(e));
    } finally {
      creating = false;
    }
  }

  async function saveActiveConfig() {
    if (!activeSessionId) return;
    try {
      await chatStore.updateSessionConfig(activeSessionId, currentConfigPayload());
      toast.success("Config updated", "New model and reasoning settings apply on next turn");
    } catch (e) {
      toast.error("Failed to update config: " + String(e));
    }
  }

  function editSessionConfig(e: MouseEvent, session: ChatSession) {
    e.stopPropagation();
    showNewForm = true;
    selectedRunId =
      typeof session.agentConfig.runId === "string" && session.agentConfig.runId.trim().length > 0
        ? session.agentConfig.runId.trim()
        : "";
    hydrateFormFromSessionConfig(session.agentConfig);
    onSelectSession(session.sessionId);
    void loadChatModelOptions(newProvider);
  }

  async function del(e: MouseEvent, sessionId: string) {
    e.stopPropagation();
    await chatStore.deleteSession(sessionId);
  }

  function startRename(e: MouseEvent, sessionId: string, currentName: string) {
    e.stopPropagation();
    renamingSessionId = sessionId;
    renameInputValue = currentName;
  }

  async function confirmRename(sessionId: string) {
    if (renamingInProgress) return;
    const trimmedName = renameInputValue.trim();
    if (!trimmedName) {
      toast.error("Session name cannot be empty");
      return;
    }
    renamingInProgress = true;
    try {
      await chatStore.renameSession(sessionId, trimmedName);
      renamingSessionId = null;
      renameInputValue = "";
    } catch (e) {
      toast.error("Failed to rename session: " + String(e));
    } finally {
      renamingInProgress = false;
    }
  }

  function cancelRename() {
    renamingSessionId = null;
    renameInputValue = "";
  }

  const field =
    "w-full rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface)] px-2 py-1.5 text-[11px] font-mono text-[var(--cortex-text)] placeholder:text-[var(--cortex-text-muted)]";
  const label = "font-mono text-[9px] uppercase tracking-widest text-[var(--cortex-text-muted)]";
  const btnPrimary =
    "w-full rounded-md border border-primary/35 bg-primary/12 px-3 py-1.5 font-mono text-[10px] uppercase text-primary hover:bg-primary/20 disabled:opacity-40";
</script>

<div
  class="flex h-full flex-col border-r border-primary/15 bg-surface-container-low/92 backdrop-blur-md dark:border-[color:var(--cortex-border)] dark:bg-surface-container-low/78"
>
  <div
    class="flex flex-shrink-0 items-center justify-between border-b border-[color:var(--cortex-border)] px-3 py-2"
  >
    <span class={label}>Sessions</span>
    <button
      type="button"
      class="material-symbols-outlined cursor-pointer border-0 bg-transparent text-sm text-[var(--cortex-text-muted)] hover:text-primary"
      onclick={() => (showNewForm = !showNewForm)}
      title="New chat session"
    >add</button>
  </div>

  {#if showNewForm}
    <div class="flex max-h-[min(70vh,520px)] flex-shrink-0 flex-col gap-2 overflow-y-auto border-b border-[color:var(--cortex-border)] p-3">
      {#if activeSession}
        <div class="rounded-md border border-secondary/25 bg-secondary/10 px-2 py-1.5 font-mono text-[10px] text-secondary">
          Editing session config: {activeSession.name}
        </div>
      {/if}
      <div>
        <label class={label} for="chat-new-name">Name</label>
        <input id="chat-new-name" class={field} placeholder="Session name" bind:value={newName} />
      </div>

      <div>
        <label class={label} for="chat-run">Prior run (optional)</label>
        <select
          id="chat-run"
          class={field}
          value={selectedRunId}
          onchange={(e) => onRunChange((e.target as HTMLSelectElement).value)}
        >
          <option value="">— Fresh chat (no run context) —</option>
          {#each runs as r (r.runId)}
            <option value={r.runId}>{r.label}</option>
          {/each}
        </select>
        <p class="mt-0.5 font-mono text-[9px] text-[var(--cortex-text-muted)]">
          Loads debrief + events into task context (same DB run).
        </p>
      </div>

      <div>
        <span class={label}>Provider</span>
        <select
          class={field}
          value={newProvider}
          onchange={(e) => void setProvider((e.target as HTMLSelectElement).value)}
        >
          {#each CHAT_PROVIDERS as p (p)}
            <option value={p}>{p}</option>
          {/each}
        </select>
      </div>

      <div>
        <span class={label}>Model</span>
        {#if modelsListError}
          <p class="font-mono text-[10px] text-error/80 mb-1">{modelsListError}</p>
        {/if}
        {#if modelsListLoading}
          <p class="font-mono text-[10px] text-[var(--cortex-text-muted)]">Loading models…</p>
        {:else if providerModelOptions.length > 0}
          <select class={field} bind:value={newModel}>
            {#each providerModelOptions as m (m.value)}
              <option value={m.value}>{m.label}</option>
            {/each}
            {#if newModel.trim() && !providerModelOptions.some((m) => m.value === newModel)}
              <option value={newModel}>{newModel} (custom)</option>
            {/if}
          </select>
        {:else}
          <input class={field} bind:value={newModel} placeholder="Model id…" />
        {/if}
      </div>

      <div>
        <label class={label} for="chat-sys">System prompt</label>
        <textarea
          id="chat-sys"
          class="{field} resize-none"
          placeholder="Optional"
          rows="2"
          bind:value={newSystemPrompt}
        ></textarea>
      </div>

      <label class="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-[var(--cortex-text)]">
        <input type="checkbox" bind:checked={enableTools} class="accent-primary" />
        Enable tools (ReAct path, like rax playground <code class="text-[9px]">--tools</code>)
      </label>

      {#if enableTools}
        <div>
          <span class={label}>Allowed tools</span>
          <p class="mb-1 font-mono text-[9px] text-[var(--cortex-text-muted)]">
            Leave none selected to allow the default Cortex tool stack (kernel + your picks merge on the server).
          </p>
          <div class="flex flex-wrap gap-1">
            {#each CHAT_TOOL_PRESETS as t (t.id)}
              <button
                type="button"
                class="rounded border px-2 py-0.5 font-mono text-[9px] transition-colors border-[color:var(--cortex-border)] bg-[var(--cortex-surface)] text-[var(--cortex-text-muted)] hover:border-primary/40 {selectedTools.includes(t.id)
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : ''}"
                onclick={() => toggleTool(t.id)}
              >
                <span class="material-symbols-outlined align-middle text-[11px]">{t.icon}</span>
                {t.label}
              </button>
            {/each}
          </div>
          {#if shellExecuteSelected}
            <div class="mt-2">
              <ChatShellToolDisclaimer
                idSuffix="desk-chat"
                bind:additionalCommands={terminalShellAdditionalCommands}
                bind:allowedCommands={terminalShellAllowedCommands}
              />
            </div>
          {/if}
        </div>
        <div>
          <label class={label} for="chat-max-it">Max ReAct iterations</label>
          <input
            id="chat-max-it"
            type="number"
            min="1"
            max="40"
            class={field}
            bind:value={maxChatIterations}
          />
        </div>
        <div>
          <label class={label} for="chat-reasoning-strategy">Reasoning strategy</label>
          <select id="chat-reasoning-strategy" class={field} bind:value={reasoningStrategy}>
            <option value="plan-execute-reflect">plan-execute-reflect</option>
            <option value="reactive">reactive</option>
            <option value="adaptive">adaptive</option>
            <option value="tree-of-thought">tree-of-thought</option>
            <option value="reflexion">reflexion</option>
          </select>
        </div>
        <label class="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-[var(--cortex-text)]">
          <input type="checkbox" bind:checked={streamReasoningSteps} class="accent-primary" />
          Stream reasoning steps live
        </label>
        <div>
          <label class={label} for="chat-context-synthesis">Context synthesis</label>
          <select id="chat-context-synthesis" class={field} bind:value={contextSynthesis}>
            <option value="auto">auto</option>
            <option value="template">template</option>
            <option value="llm">llm</option>
            <option value="none">none</option>
          </select>
        </div>
        <label class="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-[var(--cortex-text)]">
          <input type="checkbox" bind:checked={strategySwitching} class="accent-primary" />
          Enable strategy switching on loop risk
        </label>
        <label class="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-[var(--cortex-text)]">
          <input type="checkbox" bind:checked={runtimeVerification} class="accent-primary" />
          Enable runtime verification layer
        </label>
        <label class="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-[var(--cortex-text)]">
          <input type="checkbox" bind:checked={verificationStepReflect} class="accent-primary" />
          Final reflect verification step
        </label>
        <div>
          <label class={label} for="chat-persona-traits">Tool-use persona instructions</label>
          <textarea
            id="chat-persona-traits"
            class="{field} resize-none"
            rows="3"
            bind:value={personaTraits}
            placeholder="Think step-by-step then call tools immediately..."
          ></textarea>
        </div>
      {/if}

      <button type="button" disabled={creating} class={btnPrimary} onclick={create}>
        {creating ? "Creating…" : "Create"}
      </button>
      {#if activeSessionId}
        <button
          type="button"
          class="w-full rounded-md border border-secondary/35 bg-secondary/10 px-3 py-1.5 font-mono text-[10px] uppercase text-secondary hover:bg-secondary/20"
          onclick={() => void saveActiveConfig()}
        >
          Save To Active Session
        </button>
      {/if}

      {#if activeSession}
        <button
          type="button"
          class="w-full rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface)] px-3 py-1.5 font-mono text-[10px] uppercase text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)]"
          onclick={() => hydrateFormFromSessionConfig(activeSession.agentConfig)}
        >
          Load Active Config
        </button>
      {/if}
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto">
    {#if sessions.length === 0}
      <p class="p-3 font-mono text-[10px] italic text-[var(--cortex-text-muted)]">No sessions yet</p>
    {:else}
      {#each sessions as session (session.sessionId)}
        {#if renamingSessionId === session.sessionId}
          <div class="flex w-full flex-col gap-2 border-b border-[color:var(--cortex-border)] bg-[var(--cortex-surface-mid)] px-3 py-2">
            <input
              type="text"
              class={field}
              placeholder="Session name"
              bind:value={renameInputValue}
              disabled={renamingInProgress}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirmRename(session.sessionId);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
            />
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 rounded-md border border-primary/35 bg-primary/12 px-2 py-1 font-mono text-[10px] uppercase text-primary hover:bg-primary/20 disabled:opacity-40"
                onclick={() => confirmRename(session.sessionId)}
                disabled={renamingInProgress}
              >
                {renamingInProgress ? "Renaming…" : "Save"}
              </button>
              <button
                type="button"
                class="flex-1 rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface)] px-2 py-1 font-mono text-[10px] uppercase text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)] disabled:opacity-40"
                onclick={cancelRename}
                disabled={renamingInProgress}
              >
                Cancel
              </button>
            </div>
          </div>
        {:else}
          <div
            role="button"
            tabindex="0"
            class="flex w-full cursor-pointer items-center justify-between gap-2 border-b border-[color:var(--cortex-border)] px-3 py-2 text-left transition-colors hover:bg-[var(--cortex-surface-mid)] {activeSessionId === session.sessionId
              ? 'bg-primary/10 text-primary'
              : 'text-[var(--cortex-text)]'}"
            onclick={() => onSelectSession(session.sessionId)}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectSession(session.sessionId);
              }
            }}
          >
            <div class="min-w-0 flex-1">
              <div class="truncate font-mono text-[11px]">{session.name}</div>
              <div class="font-mono text-[9px] text-[var(--cortex-text-muted)]">
                {new Date(session.lastUsedAt).toLocaleString()}
              </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                class="material-symbols-outlined cursor-pointer border-0 bg-transparent text-[13px] text-[var(--cortex-text-muted)] hover:text-secondary"
                onclick={(e) => editSessionConfig(e, session)}
                title="Edit session config"
              >tune</button>
              <button
                type="button"
                class="material-symbols-outlined cursor-pointer border-0 bg-transparent text-[13px] text-[var(--cortex-text-muted)] hover:text-primary"
                onclick={(e) => startRename(e, session.sessionId, session.name)}
                title="Rename session"
              >edit</button>
              <button
                type="button"
                class="material-symbols-outlined cursor-pointer border-0 bg-transparent text-[13px] text-[var(--cortex-text-muted)] hover:text-error"
                onclick={(e) => del(e, session.sessionId)}
                title="Delete session"
              >delete</button>
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>
