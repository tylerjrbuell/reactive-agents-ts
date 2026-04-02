<script lang="ts">
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import { type AgentConfig, defaultConfig } from "$lib/types/agent-config.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { goto } from "$app/navigation";

  type SkillRow  = { id?: string; name?: string; description?: string; content?: string };
  type ToolRow   = { name?: string; description?: string; schema?: unknown };
  type GatewayRow = {
    agentId: string; name: string; config: AgentConfig;
    status: string; runCount: number; lastRunAt?: number; schedule?: string;
  };

  let activeTab = $state<"builder" | "gateway" | "skills" | "tools">("builder");

  // ── Quick Run builder ─────────────────────────────────────────────────
  let builderConfig = $state<AgentConfig>(defaultConfig());
  let builderPrompt = $state("");
  let builderRunning = $state(false);

  async function runFromBuilder() {
    if (!builderPrompt.trim()) return;
    builderRunning = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: builderPrompt.trim(),
          provider: builderConfig.provider,
          model: builderConfig.model || undefined,
          tools: builderConfig.tools,
          strategy: builderConfig.strategy,
          temperature: builderConfig.temperature,
          maxIterations: builderConfig.maxIterations,
          systemPrompt: builderConfig.systemPrompt || undefined,
          agentName: builderConfig.agentName || undefined,
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

  // ── Gateway agents ────────────────────────────────────────────────────
  let gatewayAgents = $state<GatewayRow[]>([]);
  let gatewayLoading = $state(false);
  let showForm = $state(false);
  let editingAgent = $state<GatewayRow | null>(null);
  let deleteConfirmAgent = $state<GatewayRow | null>(null);

  let formConfig   = $state<AgentConfig>(defaultConfig());
  let formName     = $state("");
  let formSchedule = $state("");
  let formSaving   = $state(false);

  async function loadGatewayAgents() {
    gatewayLoading = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/agents`);
      gatewayAgents = res.ok ? (await res.json() as GatewayRow[]) : [];
    } catch { gatewayAgents = []; }
    finally { gatewayLoading = false; }
  }

  function openCreate() {
    formConfig = defaultConfig(); formName = ""; formSchedule = "";
    editingAgent = null; showForm = true;
  }

  function openEdit(agent: GatewayRow) {
    formConfig = { ...defaultConfig(), ...agent.config };
    formName = agent.name; formSchedule = agent.schedule ?? "";
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
        body: JSON.stringify({ name: formName.trim(), config: formConfig, schedule: formSchedule.trim() || null }),
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
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h === "#gateway") activeTab = "gateway";
    else if (h === "#skills") activeTab = "skills";
    else if (h === "#tools")  activeTab = "tools";
    void loadGatewayAgents();
    void Promise.all([
      fetch(`${CORTEX_SERVER_URL}/api/skills`).then(r => r.ok ? r.json() : []).then(j => { skills = j; }).catch(() => {}),
      fetch(`${CORTEX_SERVER_URL}/api/tools`).then(r => r.ok ? r.json() : []).then(j => { tools = j; }).catch(() => {}),
    ]);
  });
</script>

<svelte:head><title>CORTEX — Lab</title></svelte:head>

<div class="h-full flex flex-col overflow-hidden p-4 gap-3">
  <!-- Tabs -->
  <div class="flex items-center gap-1 border-b border-outline-variant/20 pb-0 flex-shrink-0">
    {#each [
      { id: "builder", label: "Builder", icon: "build" },
      { id: "gateway", label: "Gateway", icon: "hub", badge: gatewayAgents.length },
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
        <div>
          <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">Prompt</label>
          <textarea bind:value={builderPrompt}
            placeholder="Describe what you want the agent to do…" rows="3"
            class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-4 py-3
                   text-sm font-mono text-on-surface placeholder:text-outline/40 resize-none focus:border-primary/50 focus:outline-none">
          </textarea>
        </div>
        <AgentConfigPanel bind:config={builderConfig} />
        <div class="flex justify-end pt-1">
          <button type="button" disabled={!builderPrompt.trim() || builderRunning} onclick={runFromBuilder}
            class="flex items-center gap-2 px-6 py-2.5 rounded-lg border-0 cursor-pointer font-mono
                   text-[11px] uppercase tracking-wider text-white disabled:opacity-40 hover:brightness-110 transition-all"
            style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);box-shadow:0 0 16px rgba(139,92,246,.3);">
            {#if builderRunning}
              <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            {:else}
              <span class="material-symbols-outlined text-sm">send</span>
            {/if}
            Run Agent
          </button>
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
              {editingAgent ? "Edit Gateway Agent" : "New Gateway Agent"}
            </h2>
            <button type="button" onclick={() => (showForm = false)}
              class="material-symbols-outlined text-outline hover:text-primary bg-transparent border-0 cursor-pointer">close</button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">Name *</label>
              <input bind:value={formName} placeholder="my-gateway-agent"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none" />
            </div>
            <div>
              <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">
                Schedule <span class="text-outline/30 normal-case font-normal">(cron or blank for manual)</span>
              </label>
              <input bind:value={formSchedule} placeholder="0 9 * * MON"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none" />
            </div>
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
        <p class="text-[10px] font-mono text-outline/50">{gatewayAgents.length} persistent agent{gatewayAgents.length !== 1 ? "s" : ""}</p>
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
            <p class="font-mono text-xs text-outline/40">No gateway agents yet.</p>
            <p class="font-mono text-[10px] text-outline/30 mt-1">Create persistent, named agents with schedules and full config.</p>
          </div>
        {:else}
          {#each gatewayAgents as agent (agent.agentId)}
            <div class="border border-outline-variant/15 rounded-lg bg-surface-container-low/40 p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span class="font-mono text-[12px] font-semibold text-on-surface/90">{agent.name}</span>
                    <span class="text-[9px] font-mono px-1.5 py-0.5 rounded border
                                 {agent.status==='active' ? 'text-secondary border-secondary/30 bg-secondary/8' : agent.status==='paused' ? 'text-tertiary border-tertiary/30 bg-tertiary/8' : 'text-error border-error/30 bg-error/8'}">
                      {agent.status}</span>
                    {#if agent.schedule}
                      <span class="text-[9px] font-mono text-outline/40 bg-surface-container px-1.5 py-0.5 rounded">⏰ {agent.schedule}</span>
                    {/if}
                  </div>
                  <div class="flex items-center gap-2 text-[9px] font-mono text-outline/40 flex-wrap">
                    <span>{agent.config?.provider ?? "?"}/{agent.config?.model || "default"}</span>
                    <span>·</span><span>{agent.config?.strategy ?? "react"}</span>
                    <span>·</span><span>{agent.runCount} runs</span>
                    {#if agent.lastRunAt}<span>· last {relativeTime(agent.lastRunAt)}</span>{/if}
                  </div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <button type="button" onclick={() => toggleStatus(agent)}
                    class="text-[9px] font-mono px-2 py-1 rounded border cursor-pointer bg-transparent transition-colors
                           {agent.status==='active' ? 'border-tertiary/30 text-tertiary hover:bg-tertiary/10' : 'border-secondary/30 text-secondary hover:bg-secondary/10'}">
                    {agent.status==="active" ? "Pause" : "Activate"}</button>
                  <button type="button" onclick={() => openEdit(agent)}
                    class="material-symbols-outlined text-sm text-outline hover:text-primary bg-transparent border-0 cursor-pointer p-1">edit</button>
                  <button type="button" onclick={() => (deleteConfirmAgent = agent)}
                    class="material-symbols-outlined text-sm text-outline hover:text-error bg-transparent border-0 cursor-pointer p-1">delete</button>
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
    message="This permanently deletes the gateway agent and its configuration. This cannot be undone."
    confirmLabel="Delete"
    onConfirm={() => deleteAgent(deleteConfirmAgent!)}
    onCancel={() => (deleteConfirmAgent = null)}
  />
{/if}
