<script lang="ts">
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import PromptManager from "$lib/components/PromptManager.svelte";
  import AgentExportModal from "$lib/components/AgentExportModal.svelte";
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import { settings } from "$lib/stores/settings.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import ParamFillModal from "$lib/components/ParamFillModal.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { goto } from "$app/navigation";
  import ToolWorkshop from "$lib/components/ToolWorkshop.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import BuilderTab from "$lib/components/lab/BuilderTab.svelte";
  import SavedAgentsTab from "$lib/components/lab/SavedAgentsTab.svelte";
  import SkillsTab from "$lib/components/lab/SkillsTab.svelte";
  import { cortexRunsPostBody } from "$lib/cortex-runs-post-body.js";
  import { syncVariables } from "$lib/template/sync-variables.js";
  import { LAB_TABS, isLabTab, labTabFromHash, type LabTab } from "$lib/lab-tabs.js";
  import { builderConfigFromAgent, builderDefaults, prefillFromSnapshot, type BuilderAdHocAction, type BuilderAgentConfig } from "$lib/lab-builder.js";
  import { bulkDeleteConfirmMessage, createGatewayAgentsStore, pruneSelection, type GatewayRow, type SavedAgentsUi } from "$lib/stores/gateway-agents-store.js";
  import { createLabSkillsStore, emptySkillsUi, type SkillRow } from "$lib/stores/lab-skills-store.js";

  /** Base config for Builder / forms: static defaults + Cortex Settings default provider/model. */
  function builderDefaultsFromSettings(): BuilderAgentConfig {
    return builderDefaults(settings.get());
  }

  let activeTab = $state<LabTab>("builder");

  // ── Quick Run builder ─────────────────────────────────────────────────
  let builderConfig = $state<BuilderAgentConfig>(builderDefaultsFromSettings());
  let builderAgentType = $state<"ad-hoc" | "persistent">("ad-hoc");
  let builderPersistentName = $state("");
  let builderPersistentSchedule = $state("");
  let builderRunning = $state(false);
  let builderSaving = $state(false);
  let showParamModal = $state(false);
  let builderAdHocAction = $state<BuilderAdHocAction>("save-run");

  async function executeBuilderAdHocAction() {
    switch (builderAdHocAction) {
      case "run":
        onRunClick();
        break;
      case "save":
        await createAgentFromBuilder(false);
        break;
      case "save-run":
        await createAgentFromBuilder(true);
        break;
    }
  }

  async function launchRun(variableValues?: Record<string, string | number>) {
    // Re-entrancy guard: the modal's Run button is not bound to builderRunning,
    // so a fast double-confirm could otherwise POST /api/runs twice.
    if (builderRunning) return;
    if (!builderConfig.prompt.trim()) return;
    builderRunning = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cortexRunsPostBody(builderConfig.prompt.trim(), builderConfig, variableValues)),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { runId?: string };
      if (data.runId) void goto(`/run/${data.runId}`);
      else toast.info("Agent started — check Beacon");
    } catch (e) {
      toast.error("Run failed", String(e));
    } finally { builderRunning = false; }
  }

  function onRunClick() {
    if ((builderConfig.variables ?? []).length > 0) {
      showParamModal = true;
    } else {
      void launchRun();
    }
  }

  async function createAgentFromBuilder(runNow: boolean) {
    if (!builderPersistentName.trim()) {
      toast.warning("Name is required");
      return;
    }
    if (runNow && builderAgentType === "ad-hoc" && !builderConfig.prompt.trim()) {
      toast.warning("Add a prompt first", "Save & run uses the prompt stored on the agent.");
      return;
    }
    builderSaving = true;
    try {
      const data = await agentsStore.save(null, {
        name: builderPersistentName.trim(),
        type: builderAgentType === "persistent" ? "gateway" : "ad-hoc",
        runNow: builderAgentType === "ad-hoc" ? runNow : false,
        config: { ...builderConfig, prompt: builderConfig.prompt.trim() },
        schedule: builderAgentType === "persistent" ? (builderPersistentSchedule.trim() || null) : null,
      });
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

  // ── Saved agents (gateway + ad-hoc) ───────────────────────────────────
  const agentsStore = createGatewayAgentsStore(CORTEX_SERVER_URL);
  let agentsUi = $state<SavedAgentsUi<BuilderAgentConfig>>({
    showForm: false,
    editingAgent: null,
    formConfig: builderDefaultsFromSettings(),
    formName: "",
    formSchedule: "",
    formAgentType: "gateway",
    formSaving: false,
    triggeringAgent: null,
    selected: new Set<string>(),
  });
  let deleteConfirmAgent = $state<GatewayRow | null>(null);
  let deleteConfirmBulk = $state<GatewayRow[] | null>(null);
  // Agent export modal: { config, name } | null
  let exportTarget = $state<{ config: AgentConfig; name: string } | null>(null);
  // Saved agent whose run is awaiting variable values in the fill-modal.
  let triggerModalAgent = $state<GatewayRow | null>(null);

  async function loadGatewayAgents() {
    const list = await agentsStore.load(builderDefaultsFromSettings());
    agentsUi.selected = list ? pruneSelection(agentsUi.selected, list) : new Set();
  }

  function triggerAgent(agent: GatewayRow) {
    // Derive variables from the config's {{tokens}} (preserving any stored
    // enrichment) rather than trusting the persisted array — agents saved before
    // auto-detect carry tokens in their prompt but an empty `variables` list.
    const vars = syncVariables(agent.config);
    if (vars.length > 0) {
      // Collect values in the fill-modal first so the gateway resolves with them
      // instead of failing on an unresolved required token.
      triggerModalAgent = { ...agent, config: { ...agent.config, variables: vars } };
      return;
    }
    void doTrigger(agent);
  }

  async function doTrigger(agent: GatewayRow, variableValues?: Record<string, string | number>) {
    agentsUi.triggeringAgent = agent.agentId;
    try {
      const { ok, status, data } = await agentsStore.trigger(agent.agentId, variableValues);
      if (ok) {
        toast.success(`${agent.name} triggered`, "Run started");
        if (data.runId) void goto(`/run/${data.runId}`);
        await loadGatewayAgents();
      } else {
        toast.error("Trigger failed", data.error ?? `Server returned ${status}`);
      }
    } catch (e) {
      toast.error("Trigger failed", String(e));
    } finally {
      agentsUi.triggeringAgent = null;
    }
  }

  function openCreate() {
    // New-agent creation now goes through the unified Builder flow.
    builderConfig = builderDefaultsFromSettings();
    builderAgentType = "persistent";
    builderPersistentName = "";
    builderPersistentSchedule = "";
    agentsUi.editingAgent = null;
    agentsUi.showForm = false;
    activeTab = "builder";
  }

  async function deleteAgent(agent: GatewayRow) {
    deleteConfirmAgent = null;
    if (await agentsStore.remove(agent.agentId)) {
      const next = new Set(agentsUi.selected);
      next.delete(agent.agentId);
      agentsUi.selected = next;
      toast.success(`Deleted ${agent.name}`);
      await loadGatewayAgents();
    } else toast.error("Delete failed");
  }

  async function deleteAgentsBulk(agents: GatewayRow[]) {
    deleteConfirmBulk = null;
    if (agents.length === 0) return;
    const failed = await agentsStore.removeMany(agents);
    agentsUi.selected = new Set();
    await loadGatewayAgents();
    if (failed === 0) {
      toast.success(`Deleted ${agents.length} agent${agents.length === 1 ? "" : "s"}`);
    } else {
      toast.error(
        "Some deletes failed",
        `${failed} of ${agents.length} could not be removed. Refresh the list and try again.`,
      );
    }
  }

  function useConfigInBuilder(agent: GatewayRow) {
    builderConfig = builderConfigFromAgent(builderDefaultsFromSettings(), agent.config as BuilderAgentConfig);
    builderAgentType = agent.agentType === "gateway" ? "persistent" : "ad-hoc";
    builderPersistentName = agent.name;
    builderPersistentSchedule = agent.agentType === "gateway" ? (agent.schedule ?? "") : "";
    activeTab = "builder";
    toast.success("Config loaded into Builder", agent.name);
  }

  // ── Skills ────────────────────────────────────────────────────────────
  const skillsStore = createLabSkillsStore(CORTEX_SERVER_URL);
  let skillsUi = $state(emptySkillsUi());
  let deleteConfirmSkill = $state<SkillRow | null>(null);

  async function deleteSkill(skill: SkillRow) {
    deleteConfirmSkill = null;
    if (!skill.id) {
      toast.warning("Cannot delete skill without id");
      return;
    }

    try {
      const r = await skillsStore.remove(skill.id);
      if (r.ok) {
        toast.success(`Deleted ${skill.name ?? "skill"}`);
        // Reload skills list
        await skillsStore.reloadDb();
      } else {
        toast.error("Delete failed", r.error);
      }
    } catch (e) {
      toast.error("Delete failed", String(e));
    }
  }

  function appendPathsToBuilderLivingSkills(paths: string[]) {
    const add = paths.map((p) => p.trim()).filter((p) => p.length > 0);
    if (add.length === 0) return;
    const next = new Set([...(builderConfig.skills?.paths ?? []), ...add]);
    builderConfig = { ...builderConfig, skills: { ...builderConfig.skills, paths: [...next] } };
    activeTab = "builder";
    toast.success("Living skills updated", `${add.length} path(s) — expand Agent config → Living skills`);
  }

  onMount(() => {
    settings.init();
    const fromHash = labTabFromHash(typeof window !== "undefined" ? window.location.hash : "");
    if (fromHash) activeTab = fromHash;

    function onTabSwitch(e: Event) {
      const tab = (e as CustomEvent<string>).detail;
      if (isLabTab(tab)) activeTab = tab;
    }
    window.addEventListener("cortex:lab-tab", onTabSwitch);

    void loadGatewayAgents();
    void skillsStore.loadInitial();

    // Edit & Rerun: ?fromRun=<id> prefills the builder from that run's stored
    // launch snapshot, merged OVER the current defaults so a snapshot that
    // predates a new config field keeps that field's default.
    const fromRun = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("fromRun") : null;
    if (fromRun) {
      activeTab = "builder";
      void fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(fromRun)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((run: { launchParams?: Record<string, unknown> } | null) => {
          if (run?.launchParams) builderConfig = prefillFromSnapshot(builderConfig, run.launchParams);
        })
        .catch(() => {});
    }

    return () => window.removeEventListener("cortex:lab-tab", onTabSwitch);
  });
</script>

<svelte:head><title>CORTEX — Lab</title></svelte:head>

<CortexDeskShell>
<div class="relative z-10 flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4 sm:p-6">
  <header class="flex flex-shrink-0 items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="font-display text-2xl font-light tracking-tight text-slate-900 dark:text-on-surface">
        Agent <span class="font-semibold text-primary">Lab</span>
      </h1>
      <p class="mt-1 max-w-3xl font-mono text-[10px] leading-relaxed text-slate-600 dark:text-on-surface-variant/90">
        Build, persist, and operate Cortex agents with one control surface for config, skills, and tool wiring.
      </p>
    </div>
    <a href="/runs" class="flex items-center gap-1 font-mono text-[11px] text-cyan-700 no-underline transition-colors hover:text-primary dark:text-secondary">
      <span class="material-symbols-outlined text-sm">timeline</span> Trace
    </a>
  </header>

  <div class="grid flex-shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
    <div
      class="gradient-border rounded-lg px-3 py-2 font-mono text-[10px] shadow-sm dark:shadow-[0_0_24px_-12px_rgba(139,92,246,0.35)]"
    >
      <div class="text-slate-500 dark:text-on-surface-variant/80">Saved agents</div>
      <div class="mt-0.5 text-lg font-semibold tabular-nums text-violet-700 dark:text-primary">{$agentsStore.agents.length}</div>
    </div>
    <div class="gradient-border rounded-lg px-3 py-2 font-mono text-[10px] shadow-sm dark:shadow-[0_0_20px_-10px_rgba(6,182,212,0.2)]">
      <div class="text-slate-500 dark:text-on-surface-variant/80">Active tab</div>
      <div class="mt-0.5 font-semibold uppercase tracking-wide text-slate-800 dark:text-on-surface">{activeTab}</div>
    </div>
    <div class="gradient-border rounded-lg px-3 py-2 font-mono text-[10px] shadow-sm">
      <div class="text-slate-500 dark:text-on-surface-variant/80">Builder mode</div>
      <div class="mt-0.5 font-semibold text-slate-800 dark:text-on-surface">
        {builderAgentType === "persistent" ? "persistent" : "ad-hoc"}
      </div>
    </div>
    <div class="gradient-border rounded-lg px-3 py-2 font-mono text-[10px] shadow-sm">
      <div class="text-slate-500 dark:text-on-surface-variant/80">Skill roots</div>
      <div class="mt-0.5 text-lg font-semibold tabular-nums text-slate-800 dark:text-on-surface">{$skillsStore.discoveredPaths.length}</div>
    </div>
  </div>

  <div
    class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--cortex-border)] bg-white/80 p-3 shadow-[0_10px_40px_-20px_rgba(15,23,42,0.12)] backdrop-blur-[6px] dark:bg-surface-container-low/55 dark:shadow-[0_12px_48px_-20px_rgba(0,0,0,0.65),0_0_0_1px_rgba(139,92,246,0.22),0_0_60px_-30px_rgba(6,182,212,0.12)]"
  >
  <!-- Tabs -->
  <div
    class="flex flex-shrink-0 items-center gap-2 border-b border-violet-200/80 pb-2 dark:border-primary/25 dark:shadow-[0_1px_0_rgba(6,182,212,0.08)]"
  >
    {#each LAB_TABS as tab}
      {@const badge = tab.id === "gateway" ? $agentsStore.agents.length : 0}
      <button type="button"
        class="flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors duration-150
               {activeTab === tab.id
          ? 'border-primary/40 bg-violet-100/95 text-violet-900 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.2)] dark:border-primary/45 dark:bg-primary/[0.18] dark:text-primary dark:shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35),0_0_20px_-8px_rgba(139,92,246,0.25)]'
          : 'border-slate-200/90 text-slate-600 hover:border-primary/30 hover:text-violet-800 dark:border-white/[0.08] dark:bg-surface-container/40 dark:text-on-surface-variant dark:hover:border-primary/35 dark:hover:bg-primary/[0.08] dark:hover:text-on-surface'}"
        onclick={() => (activeTab = tab.id)}>
        <span class="material-symbols-outlined text-sm opacity-90">{tab.icon}</span>{tab.label}
        {#if badge > 0}
          <span
            class="rounded px-1.5 py-px font-mono text-[8px] font-semibold tabular-nums shadow-sm {tab.id === 'gateway'
              ? 'bg-cyan-700 text-white ring-1 ring-cyan-900/25 dark:bg-secondary dark:text-on-secondary dark:ring-1 dark:ring-cyan-200/35'
              : 'bg-violet-600 text-white ring-1 ring-violet-900/20 dark:bg-primary dark:text-on-primary dark:shadow-[0_0_12px_rgba(139,92,246,0.35)]'}"
            >{badge}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- ── BUILDER ─────────────────────────────────────────────────────── -->
  {#if activeTab === "builder"}
    <BuilderTab
      bind:config={builderConfig}
      bind:agentType={builderAgentType}
      bind:name={builderPersistentName}
      bind:schedule={builderPersistentSchedule}
      bind:adHocAction={builderAdHocAction}
      running={builderRunning}
      saving={builderSaving}
      onExecute={executeBuilderAdHocAction}
      onCreatePersistent={() => createAgentFromBuilder(false)}
      onExport={() => (exportTarget = { config: builderConfig, name: builderPersistentName.trim() || "agent" })}
    />

  <!-- ── GATEWAY ─────────────────────────────────────────────────────── -->
  {:else if activeTab === "gateway"}
    <SavedAgentsTab
      store={agentsStore}
      bind:ui={agentsUi}
      defaults={builderDefaultsFromSettings}
      onReload={loadGatewayAgents}
      onNewAgent={openCreate}
      onTrigger={triggerAgent}
      onUseInBuilder={useConfigInBuilder}
      onExport={(target) => (exportTarget = target)}
      onDelete={(agent) => (deleteConfirmAgent = agent)}
      onDeleteMany={(agents) => (deleteConfirmBulk = agents)}
    />

  <!-- ── SKILLS (workshop layout: catalog | document | meta) ─────────── -->
  {:else if activeTab === "skills"}
    <SkillsTab
      store={skillsStore}
      bind:ui={skillsUi}
      builderSkillPaths={builderConfig.skills?.paths ?? []}
      onAddPaths={appendPathsToBuilderLivingSkills}
      onDelete={(skill) => (deleteConfirmSkill = skill)}
    />

  <!-- ── PROMPTS (reusable prompt library manager) ─────────────────────── -->
  {:else if activeTab === "prompts"}
    <div class="min-h-0 flex-1 overflow-hidden px-4 pb-4 pt-4 sm:px-6">
      <PromptManager />
    </div>

  <!-- ── TOOLS (unified catalog + create tool: custom + MCP) ───────────── -->
  {:else}
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
      <ToolWorkshop serverUrl={CORTEX_SERVER_URL} />
    </div>
  {/if}
</div>
</div>
</CortexDeskShell>

{#if exportTarget}
  <AgentExportModal
    config={exportTarget.config}
    name={exportTarget.name}
    onClose={() => (exportTarget = null)}
  />
{/if}

{#if deleteConfirmAgent}
  <ConfirmModal
    title="Delete {deleteConfirmAgent.name}"
    message="This permanently deletes this agent and its saved configuration. This cannot be undone."
    confirmLabel="Delete"
    onConfirm={() => deleteAgent(deleteConfirmAgent!)}
    onCancel={() => (deleteConfirmAgent = null)}
  />
{/if}

{#if deleteConfirmBulk && deleteConfirmBulk.length > 0}
  <ConfirmModal
    title="Delete {deleteConfirmBulk.length} agent{deleteConfirmBulk.length === 1 ? '' : 's'}?"
    message={bulkDeleteConfirmMessage(deleteConfirmBulk)}
    confirmLabel="Delete all"
    onConfirm={() => void deleteAgentsBulk(deleteConfirmBulk!)}
    onCancel={() => (deleteConfirmBulk = null)}
  />
{/if}

{#if deleteConfirmSkill}
  <ConfirmModal
    title="Delete {deleteConfirmSkill.name ?? 'Skill'}"
    message="This permanently deletes this skill from the database. This cannot be undone."
    confirmLabel="Delete"
    onConfirm={() => deleteSkill(deleteConfirmSkill!)}
    onCancel={() => (deleteConfirmSkill = null)}
  />
{/if}

<ParamFillModal
  open={showParamModal}
  variables={builderConfig.variables ?? []}
  previewPayload={{
    prompt: builderConfig.prompt,
    systemPrompt: builderConfig.systemPrompt,
    taskContext: builderConfig.taskContext,
  }}
  onConfirm={(values) => { showParamModal = false; void launchRun(values); }}
  onCancel={() => (showParamModal = false)}
/>

<ParamFillModal
  open={triggerModalAgent !== null}
  variables={triggerModalAgent?.config.variables ?? []}
  previewPayload={{
    prompt: triggerModalAgent?.config.prompt,
    systemPrompt: triggerModalAgent?.config.systemPrompt,
    taskContext: triggerModalAgent?.config.taskContext,
  }}
  onConfirm={(values) => {
    const agent = triggerModalAgent;
    triggerModalAgent = null;
    if (agent) void doTrigger(agent, values);
  }}
  onCancel={() => (triggerModalAgent = null)}
/>
