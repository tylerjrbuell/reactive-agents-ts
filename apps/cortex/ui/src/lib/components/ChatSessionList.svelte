<script lang="ts">
  import { onMount, untrack } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import ChatSessionRow from "$lib/components/chat/ChatSessionRow.svelte";
  import { sessionRailGroups } from "$lib/chat-session-rail.js";
  import { clock } from "$lib/stores/clock.js";
  import { chatStore, type ChatSession } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { settings, type CortexSettings } from "$lib/stores/settings.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { loadProviders } from "$lib/providers.js";
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import { portal } from "$lib/actions/portal.js";
  import { hydrateAgentConfig } from "$lib/types/agent-config.js";
  import { cortexRunsPostBody } from "$lib/cortex-runs-post-body.js";
  import { effectiveToolsEnabled } from "$lib/tool-selection.js";
  import { chatDefaultConfig } from "$lib/chat-defaults.js";

  interface Props {
    sessions: ChatSession[];
    activeSessionId: string | null;
    /** The chat whose reply is streaming now (its row shows the running dot). */
    runningSessionId?: string | null;
    onSelectSession: (id: string) => void;
  }
  const { sessions, activeSessionId, runningSessionId = null, onSelectSession }: Props = $props();

  let query = $state("");
  const groups = $derived(sessionRailGroups(sessions, $clock, query));

  type RunOption = { runId: string; label: string };

  let showConfigModal = $state(false);
  let configMode = $state<"create" | "edit">("create");
  let editingSessionId = $state<string | null>(null);
  let newName = $state("");
  let creating = $state(false);
  /** Explicit tools choice; `undefined` = auto (on exactly when something is selected). */
  let toolsOverride = $state<boolean | undefined>(undefined);
  /** Name the chat from its first exchange (on by default). */
  let autoName = $state(true);
  /** Full builder tool config (provider/model/strategy/tools/MCP/sub-agents/…). */
  let sessionAgentConfig = $state(chatDefaultConfig());
  const enableTools = $derived(effectiveToolsEnabled(sessionAgentConfig, toolsOverride));

  // Selecting tools after switching them off means "I want tools": drop the explicit off,
  // so a visible selection is never silently ignored.
  let lastToolSelection = "";
  $effect(() => {
    const key = JSON.stringify([
      sessionAgentConfig.tools,
      sessionAgentConfig.mcpServerIds,
      sessionAgentConfig.agentTools,
      sessionAgentConfig.dynamicSubAgents?.enabled,
      sessionAgentConfig.terminalTools,
      sessionAgentConfig.additionalToolNames,
    ]);
    if (key !== lastToolSelection && lastToolSelection !== "" && untrack(() => toolsOverride) === false) {
      toolsOverride = undefined;
    }
    lastToolSelection = key;
  });

  let runs = $state<RunOption[]>([]);
  let selectedRunId = $state("");
  /** The saved agent the new chat started from ("" = blank). */
  let fromAgentId = $state("");

  type SavedAgent = { agentId: string; name: string; config: Record<string, unknown> };
  let savedAgents = $state<SavedAgent[]>([]);
  async function loadSavedAgents() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/agents`);
      if (res.ok) savedAgents = (await res.json()) as SavedAgent[];
    } catch {
      /* best-effort; picker just stays empty */
    }
  }

  /** Snapshot a saved Lab agent's config into the session's own copy (session owns it thereafter). */
  function snapshotFromAgent(agentId: string) {
    if (!agentId) return;
    const a = savedAgents.find((x) => x.agentId === agentId);
    if (!a) return;
    // Snapshot: session owns its own copy; later edits don't touch the saved agent.
    sessionAgentConfig = hydrateAgentConfig(a.config as Record<string, unknown>);
    toolsOverride = undefined; // a saved agent's tool selection decides
  }

  let renamingSessionId = $state<string | null>(null);
  let renameInputValue = $state("");
  let renamingInProgress = $state(false);

  /** Seed the full panel config + the chat-specific toggles from a saved session. */
  function hydrateFormFromSessionConfig(config: Record<string, unknown>) {
    sessionAgentConfig = hydrateAgentConfig(config);
    toolsOverride = config.enableTools === false ? false : undefined;
    autoName = config.autoName !== false;
  }

  function currentConfigPayload() {
    // The panel keeps outputSchema/harness/documents as editable JSON text; the
    // chat API takes them typed. Reuse the run-launch converter (single source of
    // truth) and drop its run-only `prompt`.
    const { prompt: _prompt, ...typed } = cortexRunsPostBody("", sessionAgentConfig);
    return {
      ...typed,
      enableTools,
      autoName,
      // Thinking + tool calls always stream (the transcript shows them); clears the legacy flag on edit.
      streamReasoningSteps: false,
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
        typeof r.provider === "string" && r.provider && (await loadProviders()).some((p) => p.id === r.provider)
          ? r.provider
          : sessionAgentConfig.provider;
      const model = typeof r.model === "string" && r.model.trim() ? r.model.trim() : sessionAgentConfig.model;
      // Panel owns provider/model; its own $effect reloads the model list on provider change.
      sessionAgentConfig = { ...sessionAgentConfig, provider, model };
    } catch {
      /* ignore */
    }
  }

  /** Open the modal in create mode with a fresh default config + reset toggles/name. */
  function openCreateModal() {
    const s: CortexSettings = settings.get();
    sessionAgentConfig = { ...chatDefaultConfig(), provider: s.defaultProvider, model: s.defaultModel };
    newName = "";
    toolsOverride = undefined;
    autoName = true;
    selectedRunId = "";
    fromAgentId = "";
    editingSessionId = null;
    configMode = "create";
    showConfigModal = true;
    void loadSavedAgents();
  }

  function closeConfigModal() {
    showConfigModal = false;
  }

  async function create() {
    if (creating) return;
    creating = true;
    try {
      await chatStore.createSession({
        name: newName || undefined,
        ...currentConfigPayload(),
      });
      showConfigModal = false;
      newName = "";
      selectedRunId = "";
    } catch (e) {
      toast.error("Failed to create session: " + String(e));
    } finally {
      creating = false;
    }
  }

  async function saveActiveConfig() {
    const targetId = editingSessionId ?? activeSessionId;
    if (!targetId) return;
    try {
      await chatStore.updateSessionConfig(targetId, currentConfigPayload());
      toast.success("Config updated", "New model and reasoning settings apply on next turn");
      showConfigModal = false;
    } catch (e) {
      toast.error("Failed to update config: " + String(e));
    }
  }

  function editSessionConfig(e: MouseEvent, session: ChatSession) {
    e.stopPropagation();
    selectedRunId =
      typeof session.agentConfig.runId === "string" && session.agentConfig.runId.trim().length > 0
        ? session.agentConfig.runId.trim()
        : "";
    hydrateFormFromSessionConfig(session.agentConfig);
    onSelectSession(session.sessionId);
    editingSessionId = session.sessionId;
    configMode = "edit";
    showConfigModal = true;
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

  const field = "cx-control mt-1";
  const label = "text-[12px] font-medium text-[var(--cortex-text-2)]";
  const hint = "mt-1 text-[12px] text-[var(--cortex-text-3)]";
</script>

<!-- Sessions rail (spec section 8): search, Today / Earlier, a status dot while a chat runs,
     and per-row actions in a "More actions" menu (no nested buttons). -->
<aside class="relative z-10 flex h-full flex-col border-r border-[color:var(--cortex-line)] bg-[var(--cortex-canvas)]" aria-label="Chats">
  <div class="flex flex-shrink-0 items-center gap-2 py-3 pl-4 pr-3">
    <h2 class="m-0 text-[13px] font-semibold text-[var(--cortex-text)]">Chats</h2>
    <Button size="sm" variant="primary" icon="plus" class="ml-auto" onclick={openCreateModal}>New chat</Button>
  </div>

  <div class="relative mx-3 mb-2 flex-shrink-0">
    <span class="pointer-events-none absolute left-2.5 top-[9px] text-[var(--cortex-text-3)]"><Icon name="search" size="sm" /></span>
    <input type="search" class="cx-control h-8 bg-[var(--cortex-surface-1)]" style="padding-left: 30px" placeholder="Search chats" aria-label="Search chats" bind:value={query} />
  </div>

  <div class="flex-1 overflow-y-auto pb-3">
    {#if sessions.length === 0}
      <p class="px-4 py-3 text-[12px] text-[var(--cortex-text-3)]">No chats yet. New chat starts one.</p>
    {:else if groups.length === 0}
      <p class="px-4 py-3 text-[12px] text-[var(--cortex-text-3)]">No chat matches “{query.trim()}”.</p>
    {:else}
      {#each groups as group (group.label)}
        <h3 class="m-0 px-4 pb-1 pt-3 text-[12px] font-normal text-[var(--cortex-text-3)]">{group.label}</h3>
        {#each group.rows as row (row.sessionId)}
          {@const session = sessions.find((s: ChatSession) => s.sessionId === row.sessionId)}
          {#if renamingSessionId === row.sessionId}
            <div class="mx-2 flex flex-col gap-2 rounded-lg bg-[var(--cortex-surface-2)] p-2">
              <input
                type="text"
                class="cx-control h-8"
                aria-label="Chat name"
                placeholder="Chat name"
                bind:value={renameInputValue}
                disabled={renamingInProgress}
                onkeydown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void confirmRename(row.sessionId);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
              />
              <div class="flex gap-2">
                <Button size="sm" variant="primary" onclick={() => confirmRename(row.sessionId)} disabled={renamingInProgress}>{renamingInProgress ? "Renaming…" : "Save"}</Button>
                <Button size="sm" variant="ghost" onclick={cancelRename} disabled={renamingInProgress}>Cancel</Button>
              </div>
            </div>
          {:else if session}
            <ChatSessionRow
              {row}
              active={activeSessionId === row.sessionId}
              running={runningSessionId === row.sessionId}
              onSelect={() => onSelectSession(row.sessionId)}
              onEdit={(e) => editSessionConfig(e, session)}
              onRename={(e) => startRename(e, row.sessionId, row.name)}
              onDelete={(e) => del(e, row.sessionId)}
            />
          {/if}
        {/each}
      {/each}
    {/if}
  </div>
</aside>

{#if showConfigModal}
  <!-- Portaled to <body>: an ancestor's backdrop-filter would otherwise confine this fixed overlay to the narrow session list. -->
  <div
    use:portal={typeof document !== "undefined" ? document.body : undefined}
    class="fixed inset-0 z-modal flex items-center justify-center bg-[rgb(var(--cortex-canvas-rgb)/0.7)] backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label={configMode === "create" ? "New chat session config" : "Edit chat session config"}
  >
    <!-- Click outside → cancel via invisible full-size button behind modal -->
    <button
      type="button"
      class="absolute inset-0 w-full h-full bg-transparent border-0 cursor-default"
      onclick={closeConfigModal}
      aria-label="Close dialog"
    ></button>

    <!-- Modal panel -->
    <div
      class="relative z-10 mx-4 max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[var(--cortex-surface-1)] shadow-[var(--cortex-shadow-pop)] animate-fade-up"
    >
      <div class="px-6 pt-5 pb-4 flex flex-col gap-3">
        <h3 class="m-0 text-[17px] font-semibold text-[var(--cortex-text)]">
          {configMode === "create" ? "New chat" : "Chat settings"}
        </h3>

        {#if configMode === "create"}
          <div>
            <label class={label} for="chat-from-agent">Start from saved agent</label>
            <Select
              id="chat-from-agent"
              class={field}
              value={fromAgentId}
              options={[{ value: "", label: "Blank (defaults)" }, ...savedAgents.map((a) => ({ value: a.agentId, label: a.name }))]}
              onchange={(v) => {
                fromAgentId = v;
                snapshotFromAgent(v);
              }}
            />
            <p class={hint}>
              Copies the agent's settings into this chat. Later edits here do not change the saved agent.
            </p>
          </div>
        {/if}

        {#if configMode === "create"}
          <div>
            <label class={label} for="chat-new-name">Name</label>
            <input id="chat-new-name" class={field} placeholder="Named from the first message if left empty" bind:value={newName} />
          </div>
        {/if}

        <div>
          <label class={label} for="chat-run">Prior run (optional)</label>
          <Select
            id="chat-run"
            class={field}
            value={selectedRunId}
            options={[{ value: "", label: "None (a fresh chat)" }, ...runs.map((r) => ({ value: r.runId, label: r.label }))]}
            onchange={onRunChange}
          />
          <p class={hint}>
            Gives the agent that run's debrief and events as context.
          </p>
        </div>

        <label class="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--cortex-text)]">
          <input type="checkbox" bind:checked={autoName} class="accent-accent-fill" />
          Auto-name chat from the first message
        </label>

        <!-- Full builder config: provider/model, reasoning, tools, MCP, sub-agents, variables. -->
        <AgentConfigPanel
          bind:config={sessionAgentConfig}
          toolsToggle={{
            enabled: enableTools,
            auto: toolsOverride === undefined,
            onChange: (on) => (toolsOverride = on),
          }}
        />
      </div>

      <div class="px-6 pb-5 flex items-center justify-end gap-3">
        <Button variant="ghost" onclick={closeConfigModal}>Cancel</Button>
        {#if configMode === "create"}
          <Button variant="primary" disabled={creating} onclick={create}>{creating ? "Creating…" : "Create chat"}</Button>
        {:else}
          <Button variant="primary" onclick={() => void saveActiveConfig()}>Save</Button>
        {/if}
      </div>
    </div>
  </div>
{/if}
