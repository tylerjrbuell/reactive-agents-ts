<script lang="ts">
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import { type AgentConfig, defaultConfig } from "$lib/types/agent-config.js";
  import { settings } from "$lib/stores/settings.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { goto } from "$app/navigation";

  type SkillRow  = { id?: string; name?: string; description?: string; content?: string };
  type ToolRow   = { name?: string; description?: string; schema?: unknown };
  type GatewayRow = {
    agentId: string; name: string; config: AgentConfig;
    status: string; runCount: number; lastRunAt?: number; schedule?: string;
    agentType: "gateway" | "ad-hoc";
    processRunning?: boolean;
  };
  type BuilderAgentConfig = AgentConfig & {
    maxTokens: number;
    timeout: number;
    retryPolicy: { enabled: boolean; maxRetries: number; backoffMs: number };
    cacheTimeout: number;
    progressCheckpoint: number;
    fallbacks: { enabled: boolean; providers: string[]; errorThreshold: number };
    metaTools: { enabled: boolean; brief: boolean; find: boolean; pulse: boolean; recall: boolean; harnessSkill: boolean };
    observabilityVerbosity: "off" | "minimal" | "normal" | "verbose";
  };

  /** Base config for Builder / forms: static defaults + Cortex Settings default provider/model. */
  function builderDefaultsFromSettings(): BuilderAgentConfig {
    const s = settings.get();
    const base = defaultConfig() as BuilderAgentConfig;
    return {
      ...base,
      provider: s.defaultProvider,
      model: s.defaultModel,
    };
  }

  let activeTab = $state<"builder" | "gateway" | "skills" | "tools">("builder");

  // ── Quick Run builder ─────────────────────────────────────────────────
  let builderConfig = $state<BuilderAgentConfig>(builderDefaultsFromSettings());
  let builderPrompt = $state("");
  let builderAgentType = $state<"ad-hoc" | "persistent">("ad-hoc");
  let builderPersistentName = $state("");
  let builderPersistentSchedule = $state("");
  let builderRunNow = $state(true);
  let builderRunning = $state(false);
  let builderSaving = $state(false);

  async function runFromBuilder() {
    if (!builderPrompt.trim()) return;
    builderRunning = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:              builderPrompt.trim(),
          provider:            builderConfig.provider,
          model:               builderConfig.model || undefined,
          tools:               builderConfig.tools,
          strategy:            builderConfig.strategy,
          temperature:         builderConfig.temperature,
          maxIterations:       builderConfig.maxIterations || undefined,
          minIterations:       builderConfig.minIterations || undefined,
          systemPrompt:        builderConfig.systemPrompt || undefined,
          agentName:           builderConfig.agentName || undefined,
          maxTokens:           builderConfig.maxTokens || undefined,
          timeout:             builderConfig.timeout || undefined,
          retryPolicy:         builderConfig.retryPolicy.enabled ? builderConfig.retryPolicy : undefined,
          cacheTimeout:        builderConfig.cacheTimeout || undefined,
          progressCheckpoint:  builderConfig.progressCheckpoint || undefined,
          fallbacks:           builderConfig.fallbacks.enabled ? builderConfig.fallbacks : undefined,
          metaTools:           builderConfig.metaTools.enabled ? builderConfig.metaTools : undefined,
          verificationStep:    builderConfig.verificationStep !== "none" ? builderConfig.verificationStep : undefined,
          observabilityVerbosity: builderConfig.observabilityVerbosity,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { runId?: string };
      if (data.runId) void goto(`/run/${data.runId}`);
      else toast.info("Agent started — check Beacon");
    } catch (e) {
      toast.error("Run failed", String(e));
    } finally { builderRunning = false; }
  }

  async function createAgentFromBuilder() {
    if (!builderPersistentName.trim()) {
      toast.warning("Name is required");
      return;
    }
    builderSaving = true;
    try {
      const type = builderAgentType === "persistent" ? "gateway" : "ad-hoc";
      const res = await fetch(`${CORTEX_SERVER_URL}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: builderPersistentName.trim(),
          type,
          runNow: builderAgentType === "ad-hoc" ? builderRunNow : false,
          config: { ...builderConfig, prompt: builderPrompt.trim() },
          schedule: builderAgentType === "persistent" ? (builderPersistentSchedule.trim() || null) : null,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { runId?: string };
      toast.success(`${builderAgentType === "persistent" ? "Gateway" : "Ad-hoc"} agent created`, builderPersistentName.trim());
      await loadGatewayAgents();
      if (data.runId) {
        void goto(`/run/${data.runId}`);
      } else {
        activeTab = "gateway";
      }
    } catch (e) {
      toast.error("Create failed", String(e));
    } finally {
      builderSaving = false;
    }
  }

  // ── Gateway agents ────────────────────────────────────────────────────
  let gatewayAgents = $state<GatewayRow[]>([]);
  let gatewayLoading = $state(false);
  let showForm = $state(false);
  let editingAgent = $state<GatewayRow | null>(null);
  let deleteConfirmAgent = $state<GatewayRow | null>(null);

  let formConfig   = $state<BuilderAgentConfig>(builderDefaultsFromSettings());
  let formName     = $state("");
  let formSchedule = $state("");
  let formAgentType = $state<"gateway" | "ad-hoc">("gateway");
  let formSaving   = $state(false);
  let triggeringAgent = $state<string | null>(null);

  // Friendly schedule presets → cron expressions
  const SCHEDULE_PRESETS = [
    { label: "Every minute",    cron: "* * * * *"    },
    { label: "Every 5 minutes", cron: "*/5 * * * *"  },
    { label: "Every 15 minutes",cron: "*/15 * * * *" },
    { label: "Every hour",      cron: "0 * * * *"    },
    { label: "Every day 9am",   cron: "0 9 * * *"    },
    { label: "Every Mon 9am",   cron: "0 9 * * MON"  },
    { label: "Every weekday 9am",cron:"0 9 * * 1-5"  },
    { label: "First of month",  cron: "0 9 1 * *"    },
  ];

  async function triggerAgent(agent: GatewayRow) {
    triggeringAgent = agent.agentId;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/agents/${agent.agentId}/trigger`, { method: "POST" });
      const data = await res.json() as { runId?: string; error?: string };
      if (res.ok) {
        toast.success(`${agent.name} triggered`, "Run started");
        if (data.runId) void goto(`/run/${data.runId}`);
        await loadGatewayAgents();
      } else {
        toast.error("Trigger failed", data.error ?? `Server returned ${res.status}`);
      }
    } catch (e) {
      toast.error("Trigger failed", String(e));
    } finally {
      triggeringAgent = null;
    }
  }

  async function loadGatewayAgents() {
    gatewayLoading = true;
    try {
      const agentsRes = await fetch(`${CORTEX_SERVER_URL}/api/agents`);
      const defaults = builderDefaultsFromSettings();

      const agentsRaw = agentsRes.ok ? (await agentsRes.json() as Array<Omit<GatewayRow, "agentType"> & { type?: "gateway" | "ad-hoc" }>) : [];
      gatewayAgents = agentsRaw.map((agent) => ({
        ...agent,
        config: { ...defaults, ...(agent.config ?? {}) },
        agentType: (agent.type === "ad-hoc" || agent.agentId.startsWith("agent-")) ? "ad-hoc" : "gateway",
      }));
    } catch { gatewayAgents = []; }
    finally { gatewayLoading = false; }
  }

  function openCreate() {
    // New-agent creation now goes through the unified Builder flow.
    builderConfig = builderDefaultsFromSettings();
    builderPrompt = "";
    builderAgentType = "persistent";
    builderPersistentName = "";
    builderPersistentSchedule = "";
    builderRunNow = true;
    editingAgent = null;
    showForm = false;
    activeTab = "builder";
  }

  function openEdit(agent: GatewayRow) {
    formConfig = { ...builderDefaultsFromSettings(), ...agent.config };
    formName = agent.name; formSchedule = agent.schedule ?? "";
    formAgentType = agent.agentType;
    editingAgent = agent; showForm = true;
  }

  async function saveAgent() {
    if (!formName.trim()) { toast.warning("Name is required"); return; }
    formSaving = true;
    try {
      const url = editingAgent
        ? `${CORTEX_SERVER_URL}/api/agents/${editingAgent.agentId}`
        : `${CORTEX_SERVER_URL}/api/agents`;
      const res = await fetch(url, {
        method: editingAgent ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          type: formAgentType,
          config: formConfig,
          schedule: formAgentType === "gateway" ? (formSchedule.trim() || null) : null,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      toast.success(editingAgent ? "Agent updated" : "Agent created");
      showForm = false;
      await loadGatewayAgents();
    } catch (e) {
      toast.error("Save failed", String(e));
    } finally { formSaving = false; }
  }

  async function deleteAgent(agent: GatewayRow) {
    deleteConfirmAgent = null;
    const res = await fetch(`${CORTEX_SERVER_URL}/api/agents/${agent.agentId}`, { method: "DELETE" });
    if (res.ok) { toast.success(`Deleted ${agent.name}`); await loadGatewayAgents(); }
    else toast.error("Delete failed");
  }

  async function toggleStatus(agent: GatewayRow) {
    const newStatus = agent.status === "active" ? "paused" : "active";
    await fetch(`${CORTEX_SERVER_URL}/api/agents/${agent.agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    await loadGatewayAgents();
  }

  function extractPromptFromConfig(config: AgentConfig): string {
    const cfg = config as AgentConfig & { prompt?: unknown };
    return typeof cfg.prompt === "string" ? cfg.prompt : "";
  }

  function pickPromptFromPayload(payload: Record<string, unknown>): string {
    const candidates = [payload.prompt, payload.task, payload.input, payload.userPrompt, payload.instruction];
    for (const value of candidates) {
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
    return "";
  }

  async function useConfigInBuilder(agent: GatewayRow) {
    const defaults = builderDefaultsFromSettings();
    const sourceConfig = agent.config as BuilderAgentConfig;
    builderConfig = {
      ...defaults,
      ...sourceConfig,
      memory: { ...defaults.memory, ...sourceConfig.memory },
      guardrails: { ...defaults.guardrails, ...sourceConfig.guardrails },
      persona: { ...defaults.persona, ...sourceConfig.persona },
      retryPolicy: { ...defaults.retryPolicy, ...sourceConfig.retryPolicy },
      metaTools: { ...defaults.metaTools, ...sourceConfig.metaTools },
      fallbacks: {
        ...defaults.fallbacks,
        ...sourceConfig.fallbacks,
        providers: [...(sourceConfig.fallbacks?.providers ?? defaults.fallbacks.providers)],
      },
    };
    builderAgentType = agent.agentType === "gateway" ? "persistent" : "ad-hoc";
    builderPersistentName = agent.name;
    builderPersistentSchedule = agent.agentType === "gateway" ? (agent.schedule ?? "") : "";
    const promptFromConfig = extractPromptFromConfig(agent.config);
    builderPrompt = promptFromConfig;
    activeTab = "builder";
    toast.success("Config loaded into Builder", agent.name);
  }

  // ── Skills / Tools ────────────────────────────────────────────────────
  let skills = $state<SkillRow[]>([]);
  let tools  = $state<ToolRow[]>([]);
  let selectedSkill = $state<SkillRow | null>(null);
  let selectedTool  = $state<ToolRow | null>(null);

  function relativeTime(ts?: number) {
    if (!ts) return "never";
    const d = Date.now() - ts;
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.round(d/60000)}m ago`;
    return `${Math.round(d/3600000)}h ago`;
  }

  onMount(() => {
    settings.init();
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h === "#gateway") activeTab = "gateway";
    else if (h === "#skills") activeTab = "skills";
    else if (h === "#tools")  activeTab = "tools";

    function onTabSwitch(e: Event) {
      const tab = (e as CustomEvent<string>).detail as typeof activeTab;
      if (tab === "builder" || tab === "gateway" || tab === "skills" || tab === "tools") {
        activeTab = tab;
      }
    }
    window.addEventListener("cortex:lab-tab", onTabSwitch);

    void loadGatewayAgents();
    void Promise.all([
      fetch(`${CORTEX_SERVER_URL}/api/skills`).then(r => r.ok ? r.json() : []).then(j => { skills = j; }).catch(() => {}),
      fetch(`${CORTEX_SERVER_URL}/api/tools`).then(r => r.ok ? r.json() : []).then(j => { tools = j; }).catch(() => {}),
    ]);

    return () => window.removeEventListener("cortex:lab-tab", onTabSwitch);
  });
</script>

<svelte:head><title>CORTEX — Lab</title></svelte:head>

<div class="h-full flex flex-col overflow-hidden p-4 gap-3">
  <!-- Tabs -->
  <div class="flex items-center gap-1 border-b border-outline-variant/20 pb-0 flex-shrink-0">
    {#each [
      { id: "builder", label: "Builder", icon: "build" },
      { id: "gateway", label: "Agents", icon: "hub", badge: gatewayAgents.length },
      { id: "skills",  label: "Skills",  icon: "psychology" },
      { id: "tools",   label: "Tools",   icon: "construction" },
    ] as tab}
      <button type="button"
        class="flex items-center gap-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider
               transition-colors border-b-2 -mb-px
               {activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-outline hover:text-primary'}"
        onclick={() => (activeTab = tab.id as typeof activeTab)}>
        <span class="material-symbols-outlined text-sm">{tab.icon}</span>{tab.label}
        {#if (tab as any).badge > 0}
          <span class="text-[8px] font-mono bg-primary/15 text-primary px-1 rounded">{(tab as any).badge}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- ── BUILDER ─────────────────────────────────────────────────────── -->
  {#if activeTab === "builder"}
    <div class="flex-1 overflow-y-auto min-h-0">
      <div class="max-w-2xl mx-auto space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <label class="flex items-center gap-2 cursor-pointer p-2 rounded border border-outline-variant/20 hover:border-primary/40 transition-colors">
            <input
              type="radio"
              name="builder-agent-type"
              checked={builderAgentType === "ad-hoc"}
              onchange={() => (builderAgentType = "ad-hoc")}
              class="accent-primary"
            />
            <span class="font-mono text-[10px] text-on-surface/80">Ad-hoc (saved, on-demand)</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer p-2 rounded border border-outline-variant/20 hover:border-primary/40 transition-colors">
            <input
              type="radio"
              name="builder-agent-type"
              checked={builderAgentType === "persistent"}
              onchange={() => (builderAgentType = "persistent")}
              class="accent-primary"
            />
            <span class="font-mono text-[10px] text-on-surface/80">Persistent (gateway process)</span>
          </label>
        </div>

        <div>
          <label for="builder-prompt" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">Prompt</label>
          <textarea id="builder-prompt" bind:value={builderPrompt}
            placeholder="Describe what you want the agent to do…" rows="3"
            class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-4 py-3
                   text-sm font-mono text-on-surface placeholder:text-outline/40 resize-none focus:border-primary/50 focus:outline-none">
          </textarea>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="builder-persistent-name" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">Name *</label>
            <input
              id="builder-persistent-name"
              bind:value={builderPersistentName}
              placeholder={builderAgentType === "persistent" ? "my-gateway-agent" : "my-ad-hoc-agent"}
              class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
            />
          </div>
          {#if builderAgentType === "persistent"}
            <div>
              <label for="builder-persistent-schedule" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">
                Schedule <span class="text-outline/30 normal-case font-normal">(optional cron)</span>
              </label>
              <input
                id="builder-persistent-schedule"
                bind:value={builderPersistentSchedule}
                placeholder="*/5 * * * *"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
              />
            </div>
          {:else}
            <div class="flex items-end">
              <label class="flex items-center gap-2 text-[10px] font-mono text-outline/70 select-none cursor-pointer">
                <input type="checkbox" bind:checked={builderRunNow} />
                Run immediately after create
              </label>
            </div>
          {/if}
        </div>

        <AgentConfigPanel bind:config={builderConfig} />
        <div class="flex justify-end pt-1">
          {#if builderAgentType === "ad-hoc"}
            <div class="flex items-center gap-2">
            <button type="button" disabled={!builderPersistentName.trim() || builderSaving} onclick={createAgentFromBuilder}
              class="flex items-center gap-2 px-6 py-2.5 rounded-lg border-0 cursor-pointer font-mono
                     text-[11px] uppercase tracking-wider text-white disabled:opacity-40 hover:brightness-110 transition-all"
              style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);box-shadow:0 0 16px rgba(139,92,246,.3);">
              {#if builderSaving}
                <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              {:else}
                <span class="material-symbols-outlined text-sm">save</span>
              {/if}
              Create Ad-hoc Agent
            </button>
            <button type="button" disabled={!builderPrompt.trim() || builderRunning} onclick={runFromBuilder}
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-outline-variant/20 bg-transparent cursor-pointer font-mono
                     text-[10px] uppercase tracking-wider text-outline disabled:opacity-40 hover:text-on-surface transition-all">
              {#if builderRunning}
                <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              {:else}
                <span class="material-symbols-outlined text-sm">send</span>
              {/if}
              Run Unsaved
            </button>
            </div>
          {:else}
            <button type="button" disabled={!builderPersistentName.trim() || builderSaving} onclick={createAgentFromBuilder}
              class="flex items-center gap-2 px-6 py-2.5 rounded-lg border-0 cursor-pointer font-mono
                     text-[11px] uppercase tracking-wider text-white disabled:opacity-40 hover:brightness-110 transition-all"
              style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);box-shadow:0 0 16px rgba(139,92,246,.3);">
              {#if builderSaving}
                <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              {:else}
                <span class="material-symbols-outlined text-sm">save</span>
              {/if}
              Create Gateway Agent
            </button>
          {/if}
        </div>
      </div>
    </div>

  <!-- ── GATEWAY ─────────────────────────────────────────────────────── -->
  {:else if activeTab === "gateway"}
    {#if showForm}
      <div class="flex-1 overflow-y-auto min-h-0">
        <div class="max-w-2xl mx-auto space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="font-headline text-base font-semibold text-on-surface">
              {editingAgent
                ? (formAgentType === "gateway" ? "Edit Gateway Agent" : "Edit Ad-hoc Agent")
                : "New Gateway Agent"}
            </h2>
            <button type="button" onclick={() => (showForm = false)}
              class="material-symbols-outlined text-outline hover:text-primary bg-transparent border-0 cursor-pointer">close</button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="gateway-agent-name" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">Name *</label>
              <input id="gateway-agent-name" bind:value={formName} placeholder="my-gateway-agent"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none" />
            </div>
            {#if formAgentType === "gateway"}
              <div>
                <label for="gateway-agent-schedule" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">
                  Schedule <span class="text-outline/30 normal-case font-normal">(preset or cron, blank = manual)</span>
                </label>
                <!-- Friendly presets -->
                <div class="flex flex-wrap gap-1 mb-1.5">
                  {#each SCHEDULE_PRESETS as preset}
                    <button type="button"
                      onclick={() => (formSchedule = preset.cron)}
                      class="text-[8px] font-mono px-1.5 py-0.5 rounded border cursor-pointer transition-colors
                             {formSchedule === preset.cron ? 'bg-primary/15 border-primary/40 text-primary' : 'border-outline-variant/20 text-outline/50 hover:border-primary/30 hover:text-primary'}">
                      {preset.label}
                    </button>
                  {/each}
                  {#if formSchedule && !SCHEDULE_PRESETS.some(p => p.cron === formSchedule)}
                    <span class="text-[8px] font-mono text-outline/30 self-center">custom:</span>
                  {/if}
                </div>
                <input id="gateway-agent-schedule" bind:value={formSchedule} placeholder="*/5 * * * *  or leave blank for manual"
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none" />
                {#if formSchedule}
                  <p class="text-[9px] font-mono text-secondary/50 mt-1">
                    Agent process will start immediately and fire on this schedule.
                  </p>
                {:else}
                  <p class="text-[9px] font-mono text-outline/30 mt-1">
                    No schedule — use "Trigger Now" to run manually.
                  </p>
                {/if}
              </div>
            {:else}
              <div class="flex flex-col justify-end pb-2">
                <p class="text-[9px] font-mono text-outline/40">
                  Ad-hoc agents run on demand only (Trigger Now or API). No schedule.
                </p>
              </div>
            {/if}
          </div>
          <AgentConfigPanel bind:config={formConfig} />
          <div class="flex justify-end gap-3 pt-1">
            <button type="button" onclick={() => (showForm = false)}
              class="px-4 py-1.5 border border-outline-variant/20 text-outline font-mono text-[10px] uppercase rounded bg-transparent cursor-pointer hover:text-on-surface">
              Cancel</button>
            <button type="button" disabled={formSaving} onclick={saveAgent}
              class="px-6 py-1.5 rounded border-0 cursor-pointer font-mono text-[10px] uppercase text-white disabled:opacity-40 hover:brightness-110 transition-all"
              style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
              {formSaving ? "Saving…" : editingAgent ? "Save Changes" : "Create Agent"}
            </button>
          </div>
        </div>
      </div>
    {:else}
      <div class="flex items-center justify-between flex-shrink-0 mb-1">
        <p class="text-[10px] font-mono text-outline/50">{gatewayAgents.length} agent{gatewayAgents.length !== 1 ? "s" : ""}</p>
        <button type="button" onclick={openCreate}
          class="flex items-center gap-1.5 px-4 py-1.5 rounded border-0 cursor-pointer font-mono text-[10px] uppercase text-white hover:brightness-110 transition-all"
          style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
          <span class="material-symbols-outlined text-sm">add</span> New Agent
        </button>
      </div>
      <div class="flex-1 overflow-y-auto min-h-0 space-y-2">
        {#if gatewayLoading}
          <div class="flex items-center justify-center h-20">
            <span class="material-symbols-outlined text-primary animate-spin">progress_activity</span>
          </div>
        {:else if gatewayAgents.length === 0}
          <div class="text-center py-12">
            <span class="material-symbols-outlined text-3xl text-outline/20 block mb-3">hub</span>
            <p class="font-mono text-xs text-outline/40">No agents yet.</p>
            <p class="font-mono text-[10px] text-outline/30 mt-1">Create gateway or ad-hoc saved agents from Builder.</p>
          </div>
        {:else}
          {#each gatewayAgents as agent (agent.agentId)}
            <div class="border border-outline-variant/15 rounded-lg bg-surface-container-low/40 p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span class="font-mono text-[12px] font-semibold text-on-surface/90">{agent.name}</span>
                    <span class="text-[9px] font-mono px-1.5 py-0.5 rounded border
                                 {agent.agentType==='gateway' ? 'text-primary border-primary/30 bg-primary/8' : 'text-outline/60 border-outline-variant/25 bg-surface-container'}">
                      {agent.agentType === "gateway" ? "persistent" : "ad-hoc"}
                    </span>
                    <span class="text-[9px] font-mono px-1.5 py-0.5 rounded border
                                 {agent.status==='active' ? 'text-secondary border-secondary/30 bg-secondary/8' : agent.status==='paused' ? 'text-tertiary border-tertiary/30 bg-tertiary/8' : 'text-error border-error/30 bg-error/8'}">
                      {agent.status}</span>
                    {#if agent.schedule}
                      <span class="text-[9px] font-mono text-outline/40 bg-surface-container px-1.5 py-0.5 rounded">⏰ {agent.schedule}</span>
                    {/if}
                  </div>
                  <div class="flex items-center gap-2 text-[9px] font-mono text-outline/40 flex-wrap">
                    <span>{agent.config?.provider ?? "?"}/{agent.config?.model || "default"}</span>
                    <span>·</span><span>{agent.config?.strategy ?? "reactive"}</span>
                    <span>·</span><span>{agent.runCount} runs</span>
                    {#if agent.lastRunAt}<span>· last {relativeTime(agent.lastRunAt)}</span>{/if}
                  </div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <!-- Run: gateway (manual fire vs cron) and ad-hoc (on-demand saved config) -->
                  <button type="button" onclick={() => triggerAgent(agent)}
                    disabled={triggeringAgent === agent.agentId || (agent.agentType === "gateway" && !!agent.processRunning)}
                    class="text-[9px] font-mono px-2 py-1 rounded border cursor-pointer bg-transparent transition-colors
                           border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={agent.agentType === "gateway" ? "Run now (ignores schedule)" : "Run now using saved config"}>
                    {triggeringAgent === agent.agentId ? "…" : "▶ Run"}
                  </button>
                  <button type="button" onclick={() => useConfigInBuilder(agent)}
                    class="text-[9px] font-mono px-2 py-1 rounded border cursor-pointer bg-transparent transition-colors
                           border-outline-variant/25 text-outline hover:text-primary hover:border-primary/30"
                    title="Copy this agent config to Builder">
                    Use in Builder
                  </button>
                  {#if agent.agentType === "gateway"}
                    <button type="button" onclick={() => toggleStatus(agent)}
                      class="text-[9px] font-mono px-2 py-1 rounded border cursor-pointer bg-transparent transition-colors
                             {agent.status==='active' ? 'border-tertiary/30 text-tertiary hover:bg-tertiary/10' : 'border-secondary/30 text-secondary hover:bg-secondary/10'}">
                      {agent.status==="active" ? "Pause" : "Activate"}</button>
                  {/if}
                  <button type="button" onclick={() => openEdit(agent)}
                    class="material-symbols-outlined text-sm text-outline hover:text-primary bg-transparent border-0 cursor-pointer p-1"
                    title="Edit agent">edit</button>
                  <button type="button" onclick={() => (deleteConfirmAgent = agent)}
                    class="material-symbols-outlined text-sm text-outline hover:text-error bg-transparent border-0 cursor-pointer p-1"
                    title="Delete agent">delete</button>
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}

  <!-- ── SKILLS ──────────────────────────────────────────────────────── -->
  {:else if activeTab === "skills"}
    <div class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 flex-1 min-h-0 overflow-hidden">
      <div class="space-y-1 overflow-y-auto">
        {#if skills.length === 0}<p class="font-mono text-xs text-outline text-center mt-8">No skills yet.</p>{/if}
        {#each skills as s, i (s.id ?? i)}
          <button type="button" class="w-full text-left p-3 rounded border transition-all {selectedSkill===s ? 'bg-primary/10 border-primary/30' : 'bg-surface-container-low border-outline-variant/10 hover:border-primary/20'}" onclick={() => (selectedSkill=s)}>
            <div class="font-mono text-xs text-on-surface font-medium">{s.name ?? s.id ?? "skill"}</div>
            <div class="font-mono text-[10px] text-outline mt-0.5">{s.description ?? ""}</div>
          </button>
        {/each}
      </div>
      {#if selectedSkill}
        <div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/40 p-4 overflow-y-auto">
          <h3 class="font-headline text-sm font-bold text-primary mb-3">{selectedSkill.name ?? selectedSkill.id}</h3>
          <pre class="font-mono text-[10px] text-on-surface/70 whitespace-pre-wrap leading-relaxed">{selectedSkill.content ?? "No content."}</pre>
        </div>
      {:else}
        <div class="flex items-center justify-center text-outline font-mono text-xs">Select a skill to view content.</div>
      {/if}
    </div>

  <!-- ── TOOLS ───────────────────────────────────────────────────────── -->
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 flex-1 min-h-0 overflow-hidden">
      <div class="space-y-1 overflow-y-auto">
        {#if tools.length === 0}<p class="font-mono text-xs text-outline text-center mt-8">No tools registered.</p>{/if}
        {#each tools as t, i (t.name ?? i)}
          <button type="button" class="w-full text-left p-3 rounded border transition-all {selectedTool===t ? 'bg-primary/10 border-primary/30' : 'bg-surface-container-low border-outline-variant/10 hover:border-primary/20'}" onclick={() => (selectedTool=t)}>
            <div class="font-mono text-xs text-on-surface font-medium">{t.name ?? "tool"}</div>
            <div class="font-mono text-[10px] text-outline mt-0.5">{(t as any).description ?? ""}</div>
          </button>
        {/each}
      </div>
      {#if selectedTool}
        <div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/40 p-4 overflow-y-auto">
          <h3 class="font-headline text-sm font-bold text-primary mb-3">{selectedTool.name}</h3>
          <pre class="font-mono text-[10px] text-on-surface/70 whitespace-pre-wrap">{JSON.stringify(selectedTool.schema ?? selectedTool, null, 2)}</pre>
        </div>
      {:else}
        <div class="flex items-center justify-center text-outline font-mono text-xs">Select a tool to view schema.</div>
      {/if}
    </div>
  {/if}
</div>

{#if deleteConfirmAgent}
  <ConfirmModal
    title="Delete {deleteConfirmAgent.name}"
    message="This permanently deletes this agent and its saved configuration. This cannot be undone."
    confirmLabel="Delete"
    onConfirm={() => deleteAgent(deleteConfirmAgent!)}
    onCancel={() => (deleteConfirmAgent = null)}
  />
{/if}
