<script lang="ts">
  import { onMount } from "svelte";
  import { chatStore, type ChatSession } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { settings, type CortexSettings } from "$lib/stores/settings.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { CHAT_PROVIDERS, type ChatProviderId } from "$lib/inference-presets.js";
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import { defaultConfig, type AgentConfig } from "$lib/types/agent-config.js";

  interface Props {
    sessions: ChatSession[];
    activeSessionId: string | null;
    onSelectSession: (id: string) => void;
  }
  const { sessions, activeSessionId, onSelectSession } = $props();

  type RunOption = { runId: string; label: string };

  let showNewForm = $state(false);
  let newName = $state("");
  let creating = $state(false);
  let enableTools = $state(false);
  let streamReasoningSteps = $state(false);
  /** Full builder tool config (provider/model/strategy/tools/MCP/sub-agents/…). */
  let sessionAgentConfig = $state(defaultConfig());

  const activeSession = $derived(
    activeSessionId
      ? sessions.find((s: ChatSession) => s.sessionId === activeSessionId) ?? null
      : null,
  );

  let runs = $state<RunOption[]>([]);
  let selectedRunId = $state("");

  let renamingSessionId = $state<string | null>(null);
  let renameInputValue = $state("");
  let renamingInProgress = $state(false);

  /** Seed the full panel config + the chat-specific toggles from a saved session. */
  function hydrateFormFromSessionConfig(config: Record<string, unknown>) {
    sessionAgentConfig = { ...defaultConfig(), ...(config as Partial<AgentConfig>) };
    enableTools = config.enableTools === true;
    streamReasoningSteps = config.streamReasoningSteps === true;
  }

  function currentConfigPayload() {
    return {
      ...sessionAgentConfig,
      enableTools,
      streamReasoningSteps: enableTools ? streamReasoningSteps : false,
      ...(selectedRunId ? { runId: selectedRunId } : {}),
    };
  }

  onMount(() => {
    settings.init();
    const s: CortexSettings = settings.get();
    sessionAgentConfig = { ...sessionAgentConfig, provider: s.defaultProvider, model: s.defaultModel };
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
      const provider =
        typeof r.provider === "string" && r.provider && CHAT_PROVIDERS.includes(r.provider as ChatProviderId)
          ? r.provider
          : sessionAgentConfig.provider;
      const model = typeof r.model === "string" && r.model.trim() ? r.model.trim() : sessionAgentConfig.model;
      // Panel owns provider/model; its own $effect reloads the model list on provider change.
      sessionAgentConfig = { ...sessionAgentConfig, provider, model };
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

      <label class="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-[var(--cortex-text)]">
        <input type="checkbox" bind:checked={enableTools} class="accent-primary" />
        Enable tools (ReAct path, like rax playground <code class="text-[9px]">--tools</code>)
      </label>

      {#if enableTools}
        <label class="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-[var(--cortex-text)]">
          <input type="checkbox" bind:checked={streamReasoningSteps} class="accent-primary" />
          Stream reasoning steps live
        </label>
      {/if}

      <!-- Full builder config: provider/model, reasoning, tools, MCP, sub-agents, variables. -->
      <AgentConfigPanel bind:config={sessionAgentConfig} />

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
